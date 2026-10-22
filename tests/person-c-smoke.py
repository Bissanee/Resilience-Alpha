#!/usr/bin/env python3
"""Smoke tests for the Person C detector, RAG service, and dashboard integration."""
import json
import subprocess
import sys
import urllib.request


def check(condition, message):
    if not condition:
        raise AssertionError(message)
    print(f"[OK] {message}")


def compose_json(service, port, path):
    code = (
        "import json,urllib.request; "
        f"print(json.dumps(json.load(urllib.request.urlopen('http://127.0.0.1:{port}{path}', timeout=5))))"
    )
    result = subprocess.run(
        ["docker", "compose", "exec", "-T", service, "python", "-c", code],
        check=True, capture_output=True, text=True, timeout=15,
    )
    return json.loads(result.stdout.strip())


def main():
    print("=== Personne C : smoke tests détecteur / RAG ===")
    detector = compose_json("detector", 5100, "/score")
    check(isinstance(detector.get("score"), (int, float)), "Le détecteur expose un score numérique.")
    check("request_rate" in detector.get("features", {}), "Les caractéristiques Prometheus sont exposées.")
    check("distinct_source_ips" in detector.get("features", {}), "Les caractéristiques WAF/Loki sont exposées.")

    model = compose_json("detector", 5100, "/model")
    check(model.get("model") == "IsolationForest", "Le modèle déclaré est IsolationForest.")
    check(model.get("min_training_samples", 0) >= 20, "Le modèle attend un historique avant de décider.")

    rag = compose_json("rag", 5200, "/health")
    check(rag.get("status") == "ok", "Le RAG a indexé les documents locaux.")
    check(rag.get("indexed_chunks", 0) > 0, "Le RAG expose des passages indexés.")
    check(rag.get("langchain_available") is True, "Le retrieval LangChain est disponible.")

    with urllib.request.urlopen("http://127.0.0.1:8088/api/overview", timeout=5) as response:
        overview = json.load(response)
    names = {item.get("service") for item in overview.get("services", [])}
    check("detector" in names, "Le dashboard supervise le détecteur.")
    check("rag" in names, "Le dashboard supervise le RAG.")
    print("Tous les contrôles Personne C ont réussi.")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[FAIL] {exc}", file=sys.stderr)
        sys.exit(1)
