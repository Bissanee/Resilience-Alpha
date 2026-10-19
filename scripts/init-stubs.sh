#!/usr/bin/env bash
# Crée des services « stub » (répondent sur /health et /metrics) pour que `docker compose up` marche dès le départ.
# Ne touche jamais un dossier qui contient déjà un Dockerfile : chaque responsable remplace son stub par le vrai service.
set -euo pipefail
cd "$(dirname "$0")/.."

for svc in front auth api-paiement remediation dashboard detector rag; do
  dir="services/$svc"
  mkdir -p "$dir"
  if [ -f "$dir/Dockerfile" ]; then
    echo "skip $svc (Dockerfile déjà présent)"
    continue
  fi

  cat > "$dir/server.py" << 'PY'
import json, os
from http.server import BaseHTTPRequestHandler, HTTPServer

SERVICE = os.environ.get("SERVICE", "stub")
PORT = int(os.environ.get("PORT", "8000"))


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            body = json.dumps({"status": "ok", "service": SERVICE, "stub": True}).encode()
            ctype = "application/json"
        elif self.path == "/metrics":
            body = ('# TYPE stub_up gauge\nstub_up{service="%s"} 1\n' % SERVICE).encode()
            ctype = "text/plain; version=0.0.4"
        else:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        print(json.dumps({"level": "info", "service": SERVICE, "event": "http", "msg": fmt % args}), flush=True)


HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
PY

  cat > "$dir/Dockerfile" << 'DOCKER'
FROM python:3.12-alpine
WORKDIR /app
COPY server.py .
USER nobody
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD python -c "import os,urllib.request;urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ['PORT'])"
CMD ["python", "server.py"]
DOCKER

  echo "stub créé : $dir"
done