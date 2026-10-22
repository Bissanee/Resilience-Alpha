"""Lightweight documentation RAG backed by the Ollama HTTP API.

No LangChain or vector database is needed for the first local demo: documents are
ranked by lexical overlap and the best snippets are passed to Ollama.
"""
import json
import os
import re
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SERVICE = os.getenv("SERVICE", "rag")
PORT = int(os.getenv("PORT", "5200"))
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://ollama:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:3b")
DOCS_DIR = Path(os.getenv("RAG_DOCS_DIR", "/docs"))
TOP_K = max(1, min(8, int(os.getenv("RAG_TOP_K", "4"))))
MAX_CHARS = 4500
WORD_RE = re.compile(r"[a-zA-ZÀ-ÿ0-9_-]{3,}", re.UNICODE)


def load_documents():
    docs = []
    if DOCS_DIR.exists():
        for path in DOCS_DIR.rglob("*"):
            if path.is_file() and path.suffix.lower() in {".md", ".txt", ".rst"}:
                try:
                    content = path.read_text(encoding="utf-8", errors="replace")[:20000]
                    if content.strip():
                        docs.append((str(path.relative_to(DOCS_DIR)), content))
                except OSError:
                    continue
    return docs


def retrieve(question):
    query_terms = set(w.lower() for w in WORD_RE.findall(question))
    ranked = []
    for name, content in load_documents():
        chunks = [c.strip() for c in re.split(r"\n\s*\n", content) if c.strip()]
        for chunk in chunks:
            terms = set(w.lower() for w in WORD_RE.findall(chunk))
            overlap = len(query_terms & terms)
            if overlap:
                ranked.append((overlap / max(1, len(query_terms)), name, chunk[:1800]))
    ranked.sort(key=lambda item: item[0], reverse=True)
    return [{"source": name, "text": chunk, "relevance": round(score, 3)}
            for score, name, chunk in ranked[:TOP_K]]


def ask_ollama(question, contexts):
    context = "\n\n".join("[Source: %s]\n%s" % (x["source"], x["text"]) for x in contexts)
    prompt = (
        "Tu es l'assistant documentaire du projet Resilience-Alpha. "
        "Réponds en français, uniquement à partir des extraits ci-dessous. "
        "Si les extraits ne suffisent pas, dis-le clairement. N'invente pas de faits.\n\n"
        "DOCUMENTS:\n" + (context or "(Aucun passage pertinent trouvé.)") +
        "\n\nQUESTION: " + question + "\nRÉPONSE:"
    )
    body = json.dumps({"model": OLLAMA_MODEL, "prompt": prompt, "stream": False,
                       "keep_alive": 0,
                       "options": {"num_ctx": 1024, "num_predict": 120, "temperature": 0.1}}).encode()
    req = urllib.request.Request(OLLAMA_URL + "/api/generate", data=body,
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=180) as response:
        data = json.loads(response.read().decode())
    return data.get("response", "").strip()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)

    def reply(self, status, data):
        raw = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path == "/health":
            docs = load_documents()
            return self.reply(200, {"status": "ok", "service": SERVICE,
                                    "ollama_model": OLLAMA_MODEL, "documents": len(docs)})
        if self.path == "/metrics":
            return self.reply(200, {"rag_up": 1, "rag_documents": len(load_documents())})
        return self.reply(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/ask":
            return self.reply(404, {"error": "not_found"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 2 or length > 16384:
                return self.reply(400, {"error": "invalid_body_size"})
            payload = json.loads(self.rfile.read(length))
            question = str(payload.get("question", payload.get("query", ""))).strip()
            if not question or len(question) > 2000:
                return self.reply(400, {"error": "question_required_or_too_long"})
        except (ValueError, json.JSONDecodeError) as exc:
            return self.reply(400, {"error": "invalid_json", "detail": str(exc)})
        contexts = retrieve(question)
        try:
            answer = ask_ollama(question, contexts)
            return self.reply(200, {"answer": answer, "model": OLLAMA_MODEL,
                                    "sources": sorted({c["source"] for c in contexts}),
                                    "retrieved_chunks": len(contexts)})
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            return self.reply(502, {"error": "ollama_unavailable_or_timeout",
                                    "detail": str(exc), "sources": sorted({c["source"] for c in contexts})})


if __name__ == "__main__":
    print("Starting RAG on port %s; model=%s; docs=%s" % (PORT, OLLAMA_MODEL, DOCS_DIR), flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
