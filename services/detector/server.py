"""Isolation Forest detector for synthetic service metrics.

POST /detect with JSON metrics. Anomalies are sent to remediation when configured.
"""
import json
import math
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
from sklearn.ensemble import IsolationForest

SERVICE = os.getenv("SERVICE", "detector")
PORT = int(os.getenv("PORT", "5100"))
REMEDIATION_URL = os.getenv("REMEDIATION_URL", "").rstrip("/")
REMEDIATION_TOKEN = os.getenv("REMEDIATION_TOKEN", "")
ALERT_THRESHOLD = float(os.getenv("DETECTOR_ALERT_THRESHOLD", "0.78"))
COOLDOWN_SECONDS = int(os.getenv("DETECTOR_ALERT_COOLDOWN_SECONDS", "120"))
FEATURES = ("requests_per_second", "error_rate", "latency_ms", "cpu_percent", "unique_ips")
last_alert = {}
rng = np.random.default_rng(42)

# Synthetic baseline: normal service operation. Replace/retrain with real metrics later.
normal = np.column_stack([
    rng.normal(20, 7, 600).clip(0, 60),
    rng.normal(0.015, 0.012, 600).clip(0, 0.08),
    rng.normal(120, 35, 600).clip(20, 300),
    rng.normal(35, 12, 600).clip(2, 75),
    rng.normal(8, 3, 600).clip(1, 20),
])
model = IsolationForest(n_estimators=100, contamination=0.04, random_state=42)
model.fit(normal)


def send_incident(incident):
    if not REMEDIATION_URL:
        return {"sent": False, "reason": "REMEDIATION_URL is not configured"}
    body = json.dumps(incident).encode()
    headers = {"Content-Type": "application/json"}
    if REMEDIATION_TOKEN:
        headers["Authorization"] = "Bearer " + REMEDIATION_TOKEN
        headers["X-Remediation-Token"] = REMEDIATION_TOKEN
    request = urllib.request.Request(
        REMEDIATION_URL + "/incidents", data=body, headers=headers, method="POST"
    )
    try:
        with urllib.request.urlopen(request, timeout=3) as response:
            return {"sent": True, "status": response.status,
                    "response": response.read(1000).decode("utf-8", "replace")}
    except (urllib.error.URLError, TimeoutError) as exc:
        return {"sent": False, "error": str(exc)}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)

    def reply(self, status, data):
        raw = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        if self.path == "/health":
            return self.reply(200, {"status": "ok", "service": SERVICE,
                                    "model": "IsolationForest", "features": list(FEATURES)})
        if self.path == "/metrics":
            return self.reply(200, {"detector_up": 1, "detector_model_trained": 1})
        return self.reply(404, {"error": "not_found"})

    def do_POST(self):
        if self.path not in ("/detect", "/predict"):
            return self.reply(404, {"error": "not_found"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 2 or length > 65536:
                return self.reply(400, {"error": "invalid_body_size"})
            payload = json.loads(self.rfile.read(length))
            values = payload.get("features", payload)
            vector = np.array([[float(values.get(name, 0)) for name in FEATURES]])
            if not np.isfinite(vector).all():
                return self.reply(400, {"error": "features_must_be_finite"})
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            return self.reply(400, {"error": "invalid_json_or_features", "detail": str(exc)})

        decision = float(model.decision_function(vector)[0])
        score = round(1.0 / (1.0 + math.exp(max(-50, min(50, 12.0 * decision)))), 4)
        is_anomaly = score >= ALERT_THRESHOLD
        result = {"type": "dos" if is_anomaly else "metric_anomaly",
                  "service": str(payload.get("service", "api-paiement")),
                  "score": score, "source_ip": payload.get("source_ip"),
                  "features": dict(zip(FEATURES, vector[0].tolist())),
                  "ts": datetime.now(timezone.utc).isoformat(),
                  "anomaly": is_anomaly, "model": "IsolationForest"}
        if is_anomaly:
            key = result["service"] + ":" + str(result["source_ip"] or "unknown")
            now = time.time()
            if now - last_alert.get(key, 0) >= COOLDOWN_SECONDS:
                incident = {"incident_id": "if-" + str(int(now * 1000)),
                            "type": result["type"], "service": result["service"],
                            "score": result["score"], "source_ip": result["source_ip"],
                            "features": result["features"], "ts": result["ts"]}
                result["remediation"] = send_incident(incident)
                last_alert[key] = now
            else:
                result["remediation"] = {"sent": False, "reason": "cooldown"}
        return self.reply(200, result)


if __name__ == "__main__":
    print("Starting detector on port %s; threshold=%s" % (PORT, ALERT_THRESHOLD), flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
