"""Détecteur d'anomalies sur les métriques Prometheus, avec Isolation Forest."""
import json, math, os, re, threading, time, urllib.error, urllib.parse, urllib.request
from collections import deque
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import numpy as np
from sklearn.ensemble import IsolationForest

SERVICE=os.getenv("SERVICE","detector"); PORT=int(os.getenv("PORT","5100"))
PROMETHEUS_URL=os.getenv("PROMETHEUS_URL","http://prometheus:9090").rstrip("/")
REMEDIATION_URL=os.getenv("REMEDIATION_URL","http://remediation:5000").rstrip("/")
REMEDIATION_TOKEN=os.getenv("REMEDIATION_TOKEN","")
LOKI_URL=os.getenv("LOKI_URL","http://loki:3100").rstrip("/")
INTERVAL=max(5,int(os.getenv("DETECTOR_INTERVAL_SECONDS","10")))
MIN_SAMPLES=max(20,int(os.getenv("MIN_TRAINING_SAMPLES","30")))
ALERT_THRESHOLD=min(.99,max(.5,float(os.getenv("DETECTOR_ALERT_THRESHOLD",".78"))))
COOLDOWN=max(30,int(os.getenv("DETECTOR_ALERT_COOLDOWN_SECONDS","120")))
FEATURES=("request_rate","error_rate","auth_fail_rate","api_p95","auth_p95","cpu_rate","distinct_source_ips","waf_suspicious_rate")
lock=threading.RLock(); history=deque(maxlen=600); model=None
latest={"status":"warming_up","score":0.0,"label":"baseline en cours","features":{k:0.0 for k in FEATURES},"samples":0,"model_ready":False,"last_update":None,"last_alert":None,"source_ip":None}
last_alert_at=0.0; last_alert_fingerprint=None

def log(event,**fields):
 print(json.dumps({"ts":datetime.now(timezone.utc).isoformat(),"service":SERVICE,"event":event,**fields},ensure_ascii=False),flush=True)

def prometheus_query(expr):
 url=PROMETHEUS_URL+"/api/v1/query?"+urllib.parse.urlencode({"query":expr})
 req=urllib.request.Request(url,headers={"Accept":"application/json"})
 with urllib.request.urlopen(req,timeout=3) as response: payload=json.loads(response.read(1_000_000).decode())
 if payload.get("status")!="success": raise RuntimeError("Prometheus query failed")
 total=0.0
 for item in payload.get("data",{}).get("result",[]):
  try: total+=float(item["value"][1])
  except (KeyError,TypeError,ValueError,IndexError): pass
 return total if math.isfinite(total) else 0.0

def collect_loki_features():
 now_ns=str(int(time.time()*1_000_000_000))
 start_ns=str(int((time.time()-60)*1_000_000_000))
 params=urllib.parse.urlencode({"query":'{project="resilience-alpha", service="waf"}',"start":start_ns,"end":now_ns,"limit":"500","direction":"backward"})
 req=urllib.request.Request(LOKI_URL+"/loki/api/v1/query_range?"+params,headers={"Accept":"application/json"})
 try:
  with urllib.request.urlopen(req,timeout=3) as response: payload=json.loads(response.read(2_000_000).decode())
  ips={}; suspicious={}; suspicious_count=0
  for stream in payload.get("data",{}).get("result",[]):
   for _,line in stream.get("values",[]):
    try: item=json.loads(line)
    except (TypeError,ValueError): continue
    ip=item.get("source_ip")
    try: status=int(item.get("status",0))
    except (TypeError,ValueError): status=0
    if isinstance(ip,str) and len(ip)<=45:
     ips[ip]=ips.get(ip,0)+1
     if status in (403,429):
      suspicious[ip]=suspicious.get(ip,0)+1
      suspicious_count+=1
  source_ip=max(suspicious,key=suspicious.get) if suspicious and max(suspicious.values())>=3 else None
  if source_ip and (not re.fullmatch(r"(?:[0-9]{1,3}\.){3}[0-9]{1,3}",source_ip) or any(int(part)>255 for part in source_ip.split("."))): source_ip=None
  attack_type="unknown"
  for stream in payload.get("data",{}).get("result",[]):
   for _,line in stream.get("values",[]):
    try: item=json.loads(line)
    except (TypeError,ValueError): continue
    uri=urllib.parse.unquote(str(item.get("uri",""))).lower()
    if any(token in uri for token in ("union select","or 1=1","information_schema")):
     attack_type="sqli"
     break
   if attack_type=="sqli": break
  return {"distinct_source_ips":float(len(ips)),"waf_suspicious_rate":float(suspicious_count)/60.0,"source_ip":source_ip,"attack_type":attack_type}
 except (OSError,ValueError,urllib.error.URLError) as exc:
  log("loki_query_failed",error=str(exc)[:160])
  return {"distinct_source_ips":0.0,"waf_suspicious_rate":0.0,"source_ip":None}

def collect_features():
 queries={
  "request_rate":'sum(rate(http_requests_total{service=~"api-paiement|auth|front"}[1m]))',
  "error_rate":'sum(rate(http_requests_total{service=~"api-paiement|auth|front",status=~"5.."}[1m]))',
  "auth_fail_rate":'sum(rate(http_requests_total{service="auth",status=~"401|403"}[1m]))',
  "api_p95":'histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{service="api-paiement"}[5m])))',
  "auth_p95":'histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{service="auth"}[5m])))',
  "cpu_rate":'sum(rate(container_cpu_usage_seconds_total[1m]))'}
 result={}
 for name,query in queries.items():
  try: result[name]=max(0.0,prometheus_query(query))
  except (OSError,ValueError,RuntimeError,urllib.error.URLError) as exc:
   log("metric_query_failed",metric=name,error=str(exc)[:160]); result[name]=0.0
 loki_features=collect_loki_features()
 result.update({k:v for k,v in loki_features.items() if k not in ("source_ip","attack_type")})
 result["source_ip"]=loki_features.get("source_ip")
 result["attack_type"]=loki_features.get("attack_type","unknown")
 return result
def classify(features):
 if features.get("attack_type")=="sqli": return "sqli","api-paiement"
 if features["auth_fail_rate"]>=0.5: return "bruteforce","auth"
 if features["request_rate"]>=10 or features["error_rate"]>=2 or features["waf_suspicious_rate"]>=0.2: return "dos","api-paiement"
 return "unknown","api-paiement"

def notify_remediation(kind,service,score,features):
 global last_alert_at,last_alert_fingerprint
 now=time.time(); fingerprint=(kind,service)
 if now-last_alert_at<COOLDOWN: return {"sent":False,"reason":"cooldown"}
 payload={"incident_id":"if-"+datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")+"-"+str(int(now*1000)%1000000),
  "type":kind,"service":service,"score":round(float(score),4),"source_ip":features.get("source_ip"),
  "features":{k:round(float(v),6) for k,v in features.items() if k in FEATURES},"ts":datetime.now(timezone.utc).isoformat()}
 headers={"Content-Type":"application/json","Accept":"application/json"}
 if REMEDIATION_TOKEN: headers["Authorization"]="Bearer "+REMEDIATION_TOKEN
 req=urllib.request.Request(REMEDIATION_URL+"/incidents",data=json.dumps(payload).encode(),headers=headers,method="POST")
 try:
  with urllib.request.urlopen(req,timeout=4) as response:
   result=json.loads(response.read(100000).decode()); last_alert_at=now; last_alert_fingerprint=fingerprint
   log("remediation_alert_sent",incident_id=payload["incident_id"],status=response.status,type=kind,service=service)
   return {"sent":True,"http_status":response.status,"result":result}
 except (OSError,ValueError,urllib.error.URLError) as exc:
  log("remediation_alert_failed",type=kind,service=service,error=str(exc)[:200]); return {"sent":False,"reason":str(exc)[:200]}

def evaluate_once():
 global model,latest
 features=collect_features(); row=np.asarray([features[k] for k in FEATURES],dtype=float)
 with lock:
  history.append(row); ready=len(history)>=MIN_SAMPLES; score=0.0; is_anomaly=False; label="baseline en cours"
  if ready:
   matrix=np.asarray(list(history)[:-1],dtype=float)
   if model is None or len(history)%10==0:
    model=IsolationForest(n_estimators=150,contamination=.08,random_state=42); model.fit(matrix)
   prediction=int(model.predict(row.reshape(1,-1))[0]); raw_score=float(-model.score_samples(row.reshape(1,-1))[0])
   baseline_scores=-model.score_samples(matrix)
   score=float((np.sum(baseline_scores<=raw_score)+1)/(len(baseline_scores)+1))
   hard_signal=features["auth_fail_rate"]>=.5 or features["request_rate"]>=10 or features["error_rate"]>=2 or features["waf_suspicious_rate"]>=.2
   is_anomaly=(prediction==-1 and score>=ALERT_THRESHOLD) or hard_signal
   label="anomalie" if is_anomaly else "normal"
  latest={"status":"anomaly" if is_anomaly else ("normal" if ready else "warming_up"),"score":round(score,4),
   "label":label,"samples":len(history),"model_ready":ready,
   "last_update":datetime.now(timezone.utc).isoformat(),"last_alert":latest.get("last_alert"),"source_ip":features.get("source_ip"),"attack_type":features.get("attack_type","unknown"),"features":{k:features[k] for k in FEATURES}}
 if is_anomaly:
  kind,target=classify(features)
  if kind!="unknown":
   alert=notify_remediation(kind,target,score,features)
   with lock: latest["last_alert"]={"type":kind,"service":target,**alert,"ts":datetime.now(timezone.utc).isoformat()}
  log("anomaly_detected",score=round(score,4),type=kind,service=target,features=features)
 return dict(latest)

def polling_loop():
 while True:
  try: evaluate_once()
  except Exception as exc: log("evaluation_failed",error=str(exc)[:240])
  time.sleep(INTERVAL)

def metric_text():
 with lock: data=dict(latest)
 lines=["# HELP resilience_detector_score Isolation Forest anomaly score (0..1).","# TYPE resilience_detector_score gauge",
  f'resilience_detector_score{{service="{SERVICE}"}} {data.get("score",0)}',
  "# HELP resilience_detector_model_ready Whether enough samples exist to evaluate anomalies.","# TYPE resilience_detector_model_ready gauge",
  f'resilience_detector_model_ready{{service="{SERVICE}"}} {1 if data.get("model_ready") else 0}',
  "# HELP resilience_detector_samples Number of retained metric snapshots.","# TYPE resilience_detector_samples gauge",
  f'resilience_detector_samples{{service="{SERVICE}"}} {data.get("samples",0)}']
 for name,value in data.get("features",{}).items():
  if not isinstance(value,(int,float)): continue
  lines += [f"# HELP resilience_detector_feature_{name} Latest Prometheus-derived feature.",f"# TYPE resilience_detector_feature_{name} gauge",f'resilience_detector_feature_{name}{{service="{SERVICE}"}} {value}']
 return "\n".join(lines)+"\n"

class Handler(BaseHTTPRequestHandler):
 def send_json(self,status,body):
  raw=json.dumps(body,ensure_ascii=False).encode(); self.send_response(status); self.send_header("Content-Type","application/json; charset=utf-8"); self.send_header("Content-Length",str(len(raw))); self.end_headers(); self.wfile.write(raw)
 def do_GET(self):
  if self.path=="/health":
   with lock: ready=latest.get("model_ready",False); samples=latest.get("samples",0)
   self.send_json(200,{"status":"ok","service":SERVICE,"model_ready":ready,"samples":samples})
  elif self.path in ("/score","/anomaly","/metrics/score"):
   with lock: self.send_json(200,dict(latest))
  elif self.path=="/model":
   with lock: self.send_json(200,{"model":"IsolationForest","features":list(FEATURES),"min_training_samples":MIN_SAMPLES,"history_size":len(history),"model_ready":model is not None})
  elif self.path=="/metrics":
   raw=metric_text().encode(); self.send_response(200); self.send_header("Content-Type","text/plain; version=0.0.4; charset=utf-8"); self.send_header("Content-Length",str(len(raw))); self.end_headers(); self.wfile.write(raw)
  else: self.send_json(404,{"error":"not_found"})
 def log_message(self,fmt,*args): log("http_request",message=fmt%args)

if __name__=="__main__":
 threading.Thread(target=polling_loop,daemon=True,name="prometheus-poller").start()
 ThreadingHTTPServer(("0.0.0.0",PORT),Handler).serve_forever()
