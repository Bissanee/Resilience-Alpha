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
