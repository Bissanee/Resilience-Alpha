"""RAG documentaire pour Resilience-Alpha : retrieval BM25 LangChain et génération Ollama."""
import json, os, re, threading, time, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SERVICE=os.getenv("SERVICE","rag"); PORT=int(os.getenv("PORT","5200"))
DOCS_DIR=Path(os.getenv("RAG_DOCS_DIR","/docs")); OLLAMA_URL=os.getenv("OLLAMA_URL","http://ollama:11434").rstrip("/")
OLLAMA_MODEL=os.getenv("OLLAMA_MODEL","llama3.2:3b"); TOP_K=max(1,min(8,int(os.getenv("RAG_TOP_K","4"))))
MAX_QUERY_LENGTH=2000; lock=threading.RLock(); retriever=None; documents=[]; last_index_error=None
request_count=0; error_count=0
try:
 from langchain_core.documents import Document
 from langchain_community.retrievers import BM25Retriever
 from langchain_text_splitters import RecursiveCharacterTextSplitter
 LANGCHAIN_AVAILABLE=True
except ImportError:
 LANGCHAIN_AVAILABLE=False; Document=BM25Retriever=RecursiveCharacterTextSplitter=None
try:
 from langchain_ollama import ChatOllama
except ImportError:
 ChatOllama=None

def log(event,**fields):
 print(json.dumps({"ts":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"service":SERVICE,"event":event,**fields},ensure_ascii=False),flush=True)
def load_documents():
 loaded=[]
 for path in DOCS_DIR.rglob("*"):
  if not path.is_file() or path.suffix.lower() not in {".md",".txt",".rst",".yaml",".yml"}: continue
  try: text=path.read_text(encoding="utf-8",errors="replace")
  except OSError as exc: log("document_read_failed",path=str(path),error=str(exc)[:120]); continue
  if text.strip(): loaded.append((path.relative_to(DOCS_DIR).as_posix(),text))
 return loaded
def rebuild_index():
 global retriever,documents,last_index_error
 try:
  source_docs=load_documents()
  if not source_docs: raise RuntimeError("aucun document textuel trouvé dans /docs")
  if LANGCHAIN_AVAILABLE:
   splitter=RecursiveCharacterTextSplitter(chunk_size=1100,chunk_overlap=150); chunks=[]
   for source,content in source_docs:
    for chunk in splitter.split_text(content): chunks.append(Document(page_content=chunk,metadata={"source":source}))
   new_retriever=BM25Retriever.from_documents(chunks); new_retriever.k=TOP_K; new_docs=chunks
  else: new_retriever=None; new_docs=[{"page_content":content,"metadata":{"source":source}} for source,content in source_docs]
  with lock: retriever,documents,last_index_error=new_retriever,new_docs,None
  log("index_ready",source_documents=len(source_docs),chunks=len(new_docs),langchain=LANGCHAIN_AVAILABLE)
 except Exception as exc:
  with lock: last_index_error=str(exc)[:240]
  log("index_failed",error=str(exc)[:240])
def fallback_retrieve(query):
 terms=set(re.findall(r"[a-zA-ZÀ-ÿ0-9_-]{3,}",query.lower())); scored=[]
 with lock: current=list(documents)
 for doc in current:
  content=doc.page_content if hasattr(doc,"page_content") else doc["page_content"]
  metadata=doc.metadata if hasattr(doc,"metadata") else doc["metadata"]
  score=sum(content.lower().count(term) for term in terms)
  if score: scored.append((score,content,metadata.get("source","unknown")))
 scored.sort(reverse=True)
 return [{"content":content,"source":source,"score":score} for score,content,source in scored[:TOP_K]]
def retrieve(query):
 with lock: current=retriever
 if current is not None: return [{"content":d.page_content,"source":d.metadata.get("source","unknown")} for d in current.invoke(query)]
 return fallback_retrieve(query)
def ask_ollama(query,contexts):
 context="\n\n".join(f"[Source: {d['source']}]\n{d['content']}" for d in contexts)
 prompt=("Tu es un assistant de cyber-résilience pour un laboratoire académique. Réponds en français uniquement à partir du contexte. "
 "Distingue les faits des recommandations. Si l'information manque, dis-le explicitement. N'invente ni règle réglementaire ni capacité technique.\n\n"
 f"CONTEXTE:\n{context[:12000]}\n\nQUESTION:\n{query}\n\nRÉPONSE:")
 if ChatOllama is not None:
  response=ChatOllama(model=OLLAMA_MODEL,base_url=OLLAMA_URL,temperature=0.1).invoke(prompt)
  answer=response.content.strip() if isinstance(response.content,str) else str(response.content).strip()
 else:
  body=json.dumps({"model":OLLAMA_MODEL,"prompt":prompt,"stream":False,"options":{"temperature":.1}}).encode()
  req=urllib.request.Request(OLLAMA_URL+"/api/generate",data=body,headers={"Content-Type":"application/json"},method="POST")
  with urllib.request.urlopen(req,timeout=45) as response: payload=json.loads(response.read(2_000_000).decode())
  answer=payload.get("response","").strip()
 if not answer: raise RuntimeError("Ollama n'a pas retourné de réponse")
 return answer
def handle_question(query):
 global request_count,error_count
 query=query.strip()
 if not query: raise ValueError("le champ query est obligatoire")
 if len(query)>MAX_QUERY_LENGTH: raise ValueError(f"question limitée à {MAX_QUERY_LENGTH} caractères")
 request_count+=1; contexts=retrieve(query)
 if not contexts: return {"answer":"Aucun passage pertinent trouvé dans les documents locaux. Ajoutez les sources dans docs/ puis relancez l'indexation.","mode":"retrieval_only","sources":[],"model":OLLAMA_MODEL}
 try: answer=ask_ollama(query,contexts); mode="langchain-bm25+ollama" if LANGCHAIN_AVAILABLE else "keyword+ollama"
 except Exception as exc:
  error_count+=1; answer="Ollama indisponible : aucun texte généré par LLM. Extraits retrouvés :\n\n"+"\n\n".join(f"[{d['source']}]\n{d['content'][:1200]}" for d in contexts)
  mode="retrieval_only"; log("ollama_unavailable",error=str(exc)[:200])
 return {"answer":answer,"mode":mode,"model":OLLAMA_MODEL,"sources":[{"path":d["source"],"excerpt":d["content"][:350]} for d in contexts],"retrieved_chunks":len(contexts)}
class Handler(BaseHTTPRequestHandler):
 def send_json(self,status,body):
  raw=json.dumps(body,ensure_ascii=False).encode(); self.send_response(status); self.send_header("Content-Type","application/json; charset=utf-8"); self.send_header("Content-Length",str(len(raw))); self.end_headers(); self.wfile.write(raw)
 def do_GET(self):
  if self.path=="/health":
   with lock: body={"status":"ok" if documents else "degraded","service":SERVICE,"indexed_chunks":len(documents),"langchain_available":LANGCHAIN_AVAILABLE,"langchain_ollama_available":ChatOllama is not None,"ollama_configured":bool(OLLAMA_URL),"index_error":last_index_error}
   self.send_json(200,body)
  elif self.path=="/documents":
   with lock: docs=list(documents)
   self.send_json(200,{"count":len(docs),"documents":[{"source":d.metadata.get("source","unknown")} if hasattr(d,"metadata") else {"source":d["metadata"].get("source","unknown")} for d in docs]})
  elif self.path=="/metrics":
   raw=(f"# HELP rag_requests_total Total RAG questions\n# TYPE rag_requests_total counter\nrag_requests_total{{service=\"{SERVICE}\"}} {request_count}\n# HELP rag_errors_total RAG errors\n# TYPE rag_errors_total counter\nrag_errors_total{{service=\"{SERVICE}\"}} {error_count}\n").encode()
   self.send_response(200); self.send_header("Content-Type","text/plain; version=0.0.4"); self.send_header("Content-Length",str(len(raw))); self.end_headers(); self.wfile.write(raw)
  else: self.send_json(404,{"error":"not_found"})
 def do_POST(self):
  if self.path=="/reindex":
   rebuild_index()
   with lock: self.send_json(200 if documents else 503,{"indexed_chunks":len(documents),"error":last_index_error})
   return
  if self.path!="/ask": self.send_json(404,{"error":"not_found"}); return
  try:
   size=int(self.headers.get("Content-Length","0"))
   if size<=0 or size>16384: self.send_json(413,{"error":"invalid_body_size"}); return
   payload=json.loads(self.rfile.read(size).decode())
   if not isinstance(payload,dict) or not isinstance(payload.get("query"),str): self.send_json(400,{"error":"query_required"}); return
   self.send_json(200,handle_question(payload["query"]))
  except ValueError as exc: self.send_json(400,{"error":str(exc)})
  except Exception as exc: log("request_failed",error=str(exc)[:240]); self.send_json(500,{"error":"internal_error"})
 def log_message(self,fmt,*args): log("http_request",message=fmt%args)
if __name__=="__main__":
 rebuild_index()
 ThreadingHTTPServer(("0.0.0.0",PORT),Handler).serve_forever()
