import json
import os
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

SERVICE = os.environ.get("SERVICE", "dashboard")
PORT = int(os.environ.get("PORT", "8088"))
REMEDIATION_URL = os.environ.get("REMEDIATION_URL", "http://remediation:5000").rstrip("/")
DETECTOR_URL = os.environ.get("DETECTOR_URL", "http://detector:5100").rstrip("/")
GRAFANA_URL = os.environ.get("GRAFANA_URL", "http://127.0.0.1:3000")
TIMEOUT = float(os.environ.get("UPSTREAM_TIMEOUT", "2.5"))
SERVICE_URLS = {
    "api-paiement": os.environ.get("API_URL", "http://api-paiement:4000"),
    "auth": os.environ.get("AUTH_URL", "http://auth:4001"),
    "front": os.environ.get("FRONT_URL", "http://front:3000"),
    "remediation": REMEDIATION_URL,
    "detector": DETECTOR_URL,
}


def request_json(url, method="GET", timeout=TIMEOUT):
    req = urllib.request.Request(url, method=method, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read(1_000_000)
            try:
                body = json.loads(raw.decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                body = {"detail": raw.decode("utf-8", "replace")[:300]}
            return response.status, body
    except urllib.error.HTTPError as exc:
        raw = exc.read(200_000)
        try:
            body = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            body = {"error": raw.decode("utf-8", "replace")[:300]}
        return exc.code, body
    except Exception as exc:
        return 0, {"error": str(exc)[:240]}


def overview():
    services = []
    for name, base in SERVICE_URLS.items():
        status, body = request_json(base + "/health")
        detail = ""
        if isinstance(body, dict):
            detail = body.get("status", body.get("service", body.get("error", "")))
        services.append({"service": name, "ok": status == 200, "http_status": status, "detail": detail})
    anomaly = None
    anomaly_detail = "Endpoint de score non exposé par le détecteur"
    for path in ("/score", "/anomaly", "/metrics/score"):
        status, body = request_json(DETECTOR_URL + path)
        if status == 200 and isinstance(body, dict):
            for key in ("score", "anomaly_score", "last_score", "last_anomaly_score"):
                if isinstance(body.get(key), (int, float)):
                    anomaly = body[key]
                    anomaly_detail = body.get("label", body.get("status", "score disponible"))
                    break
        if anomaly is not None:
            break
    return {"services": services, "anomaly_score": anomaly, "anomaly_detail": anomaly_detail,
            "grafana_url": GRAFANA_URL, "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}


HTML = r"""<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Resilience-Alpha · Supervision</title>
<style>
:root{color-scheme:dark;--bg:#0b1220;--panel:#121d30;--line:#26364e;--text:#e7eef9;--muted:#9eb0c9;--green:#45d483;--red:#ff6b78;--amber:#f5c15d;--blue:#79b8ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,-apple-system,sans-serif}header{padding:22px max(20px,calc((100vw - 1300px)/2));border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}h1{font-size:22px;margin:0}h2{font-size:16px;margin:0 0 14px}p{margin:5px 0;color:var(--muted)}main{max-width:1300px;margin:auto;padding:22px 20px 40px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:12px}.panel,.tile{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px}.tile{min-height:110px}.tile strong{display:block;font-size:17px;margin:8px 0 2px}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--muted);margin-right:7px}.ok .dot{background:var(--green)}.bad .dot{background:var(--red)}.btn,a.btn{display:inline-block;border:1px solid #45658b;border-radius:8px;padding:8px 12px;color:var(--text);background:#1b2c45;text-decoration:none;cursor:pointer;font:inherit}.btn:hover,a.btn:hover{background:#263e60}.muted{color:var(--muted)}.pill{border:1px solid var(--line);border-radius:99px;padding:3px 8px;font-size:12px}.state{font-weight:700;color:var(--blue)}.incident{border-top:1px solid var(--line);padding:12px 0}.incident-head{display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap}.actions{margin:8px 0 0;padding-left:18px;color:var(--muted)}.actions li{margin:3px 0}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:9px 7px;border-bottom:1px solid var(--line)}th{color:var(--muted);font-weight:500}.scroll{overflow:auto}.empty{color:var(--muted);padding:16px 0}.good{color:var(--green)}.badtext{color:var(--red)}.score{font-size:27px;font-weight:700;margin:8px 0}.section{margin-top:18px}.split{display:grid;grid-template-columns:2fr 1fr;gap:14px}@media(max-width:760px){.split{grid-template-columns:1fr}main{padding:14px}}
</style></head><body>
<header><div><h1>Resilience-Alpha <span class="muted">/ Supervision</span></h1><p>État de la plateforme · actualisation automatique toutes les 2 secondes</p></div><div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn" id="grafana" href="#" target="_blank" rel="noopener">Ouvrir Grafana ↗</a><button class="btn" id="probe">Lancer un paiement de contrôle</button></div></header>
<main><section><h2>État des services</h2><div id="services" class="grid"><div class="tile">Chargement…</div></div></section>
<section class="section split"><div class="panel"><h2>Incidents et remédiation</h2><p>Progression : DETECTED → DECIDED → ACTING → VERIFYING → RESOLVED / FAILED / ESCALATED</p><div id="incidents" class="empty">Chargement des incidents…</div></div>
<div style="display:grid;gap:14px;align-content:start"><div class="panel"><h2>Paiement de contrôle</h2><div id="probeState" class="score">Non testé</div><p id="probeDetail">Le contrôle est exécuté à la demande ou à la fin d'une remédiation.</p><p id="probeTs"></p></div><div class="panel"><h2>Détecteur d’anomalies</h2><div id="score" class="score">—</div><p id="scoreDetail">En attente du détecteur…</p><p class="muted">Score indisponible si le détecteur n’expose aucun endpoint de score.</p></div></div></section>
<section class="section panel"><h2>Adresses IP bloquées</h2><p>Liste lue par le proxy du dashboard depuis le moteur de remédiation.</p><div id="blocked" class="empty">Chargement…</div></section>
<section class="section panel"><h2>Événements en temps réel</h2><div id="events" class="empty">Connexion au flux d’événements…</div></section>
<p class="muted" style="margin-top:18px">Le dashboard ne reçoit aucun secret de compte technique. Les appels internes passent par son serveur proxy.</p></main>
<script>
var $=function(id){return document.getElementById(id)};
var lastProbeTs=null;
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
async function get(path){var r=await fetch(path,{cache:'no-store'});var d=await r.json().catch(function(){return {error:'Réponse non JSON'}});if(!r.ok)throw Error(d.error||d.detail||('HTTP '+r.status));return d}
function renderServices(items){$('services').innerHTML=items.map(function(x){return '<div class="tile '+(x.ok?'ok':'bad')+'"><span class="dot"></span>'+esc(x.service)+'<strong class="'+(x.ok?'good':'badtext')+'">'+(x.ok?'OPÉRATIONNEL':'INDISPONIBLE')+'</strong><span class="muted">'+(x.http_status===0?'injoignable':'HTTP '+x.http_status)+'</span></div>'}).join('')}
function renderIncidents(items){if(!items.length){$('incidents').innerHTML='<div class="empty">Aucun incident reçu pour le moment.</div>';return}
$('incidents').innerHTML=items.slice().reverse().map(function(i){var actions=(i.actions||[]).map(function(a){return '<li><b>'+esc(a.action)+'</b> · '+(a.ok?'OK':'ÉCHEC')+' · '+esc(a.detail||'')+(a.ms!=null?' ('+esc(a.ms)+' ms)':'')+'</li>'}).join('');var duration=i.started_at&&i.finished_at?Math.max(0,(i.finished_at-i.started_at)/1000).toFixed(1)+' s':'en cours';return '<div class="incident"><div class="incident-head"><b>'+esc(i.incident_id)+' · '+esc(i.type)+' / '+esc(i.service)+'</b><span class="pill state">'+esc(i.state)+'</span></div><p>Score : '+esc(i.score)+' · IP source : '+esc(i.source_ip||'—')+' · Durée : '+esc(duration)+'</p><p>'+esc(i.updated_at||i.created_at||'')+'</p>'+(actions?'<ul class="actions">'+actions+'</ul>':'')+(i.message?'<p>'+esc(i.message)+'</p>':'')+'</div>'}).join('')}
async function refresh(){try{var o=await get('/api/overview');renderServices(o.services||[]);$('grafana').href=o.grafana_url||'#';$('score').textContent=o.anomaly_score==null?'—':Number(o.anomaly_score).toFixed(4);$('scoreDetail').textContent=o.anomaly_detail||'Score indisponible'}catch(e){$('services').innerHTML='<div class="tile bad">Erreur de supervision : '+esc(e.message)+'</div>'}
try{var d=await get('/api/incidents');renderIncidents(Array.isArray(d)?d:(d.incidents||[]))}catch(e){$('incidents').textContent='Incidents indisponibles : '+e.message}
try{var b=await get('/api/blocked');var ips=b.ips||[];$('blocked').innerHTML=ips.length?'<p>'+ips.length+' adresse(s) bloquée(s)</p><div class="scroll"><table><thead><tr><th>Adresse IP</th><th>Décision</th></tr></thead><tbody>'+ips.map(function(ip){return '<tr><td>'+esc(ip)+'</td><td class="badtext">DENY</td></tr>'}).join('')+'</tbody></table></div>':'<div class="empty">Aucune adresse IP bloquée.</div>'}catch(e){$('blocked').textContent='Liste indisponible : '+e.message}
try{var p=await get('/api/probe/status');if(p.ts&&p.ts!==lastProbeTs){lastProbeTs=p.ts;$('probeState').textContent=p.ok===true?'RÉUSSI':p.ok===false?'ÉCHEC':'Non testé';$('probeState').className='score '+(p.ok===true?'good':p.ok===false?'badtext':'');$('probeDetail').textContent=p.detail||'';$('probeTs').textContent=p.ts||''}}catch(e){}}
$('probe').addEventListener('click',async function(){var b=$('probe');b.disabled=true;b.textContent='Paiement en cours…';try{var p=await get('/api/probe');lastProbeTs=p.ts;$('probeState').textContent=p.ok?'RÉUSSI':'ÉCHEC';$('probeState').className='score '+(p.ok?'good':'badtext');$('probeDetail').textContent=p.detail||'';$('probeTs').textContent=p.ts||'';await refresh()}catch(e){$('probeState').textContent='ÉCHEC';$('probeDetail').textContent=e.message}finally{b.disabled=false;b.textContent='Lancer un paiement de contrôle'}});
var events=new EventSource('/api/events');function handleEvent(e){try{var d=JSON.parse(e.data);$('events').innerHTML='<p><b>'+esc(d.state||d.event||e.type||'Événement')+'</b> · '+esc(d.incident_id||'')+' · '+esc(d.message||d.detail||'')+'</p>'+$('events').innerHTML.replace('Connexion au flux d’événements…','').slice(0,5000);refresh()}catch(_){}}events.onmessage=handleEvent;['state','incident','update','event'].forEach(function(name){events.addEventListener(name,handleEvent)});
events.onerror=function(){$('events').textContent='Flux temps réel : reconnexion automatique…'};refresh();setInterval(refresh,2000);
</script></body></html>"""


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, body):
        raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def proxy_json(self, path, method="GET"):
        status, body = request_json(REMEDIATION_URL + path, method=method)
        self.send_json(status if status else 502, body)

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ("/", "/index.html"):
            raw = HTML.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
        elif path == "/health":
            self.send_json(200, {"status": "ok", "service": SERVICE})
        elif path == "/metrics":
            body = b'# HELP dashboard_up Dashboard HTTP server is running\n# TYPE dashboard_up gauge\ndashboard_up 1\n'
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; version=0.0.4")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif path == "/api/overview":
            self.send_json(200, overview())
        elif path == "/api/incidents":
            self.proxy_json("/incidents")
        elif path == "/api/events":
            self.proxy_events()
        elif path == "/api/probe":
            self.proxy_json("/probe")
        elif path == "/api/probe/status":
            status, body = request_json(REMEDIATION_URL + "/probe-status")
            self.send_json(status if status else 502, body)
        elif path == "/api/blocked":
            self.proxy_json("/blocked-ips")
        else:
            self.send_json(404, {"error": "not_found"})

    def proxy_events(self):
        try:
            req = urllib.request.Request(REMEDIATION_URL + "/events", headers={"Accept": "text/event-stream"})
            upstream = urllib.request.urlopen(req, timeout=5)
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            while True:
                chunk = upstream.read1(1024)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            try:
                self.send_json(502, {"error": "event_stream_unavailable"})
            except Exception:
                pass

    def log_message(self, fmt, *args):
        print(json.dumps({"level": "info", "service": SERVICE, "event": "http", "msg": fmt % args}), flush=True)


ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
