#!/bin/sh
# Tests du moteur de remédiation. À lancer depuis la racine du dépôt, stack démarrée (docker compose up -d).
#   sh tests/remediation-test.sh fake        fausse alerte « dos », service sain
#   sh tests/remediation-test.sh unknown     type inconnu : aucune action automatique (ESCALATED attendu)
#   sh tests/remediation-test.sh outage      arrête api-paiement, envoie l'alerte, mesure la reprise
#   sh tests/remediation-test.sh repeat 5    répète « outage » N fois et affiche un tableau (pour le dossier)
# Les IP utilisées (192.168.137.2xx) sont fictives : choisir une plage différente de celle du PC Attaquant.
set -u
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a
PROJECT="${COMPOSE_PROJECT_NAME:-resilience-alpha}"
NET="${PROJECT}_app-net"
REM="http://remediation:5000"
MODE="${1:-outage}"
STAMP="$(date +%s)$$"

call() { # arguments passés à curl, depuis un conteneur du réseau interne
  if [ -n "${REMEDIATION_TOKEN:-}" ]; then
    docker run --rm --network "$NET" curlimages/curl -s -H "Authorization: Bearer $REMEDIATION_TOKEN" "$@"
  else
    docker run --rm --network "$NET" curlimages/curl -s "$@"
  fi
}
send() { # id type service ip
  call -X POST "$REM/incidents" -H 'Content-Type: application/json' \
    -d "{\"incident_id\":\"$1\",\"type\":\"$2\",\"service\":\"$3\",\"score\":0.95,\"source_ip\":\"$4\",\"features\":{\"req_rate\":850}}"
}
field() { grep -o "\"$1\":\"*[A-Za-z0-9_]*" | head -1 | sed 's/.*://; s/"//g'; }
wait_final() { # id -> imprime l'état final
  i=0
  while [ "$i" -lt 60 ]; do
    s="$(call "$REM/incidents/$1" | field state)"
    case "$s" in RESOLVED|FAILED|ESCALATED) echo "$s"; return;; esac
    i=$((i + 1)); sleep 2
  done
  echo TIMEOUT
}

run_fake() {
  id="INC-fake-$STAMP"
  echo "== Fausse alerte dos (service sain)"
  send "$id" dos api-paiement 192.168.137.250; echo
  s="$(wait_final "$id")"; echo "état final : $s"
  call "$REM/incidents/$id" | grep -o '"msg":"[^"]*"' | sed 's/"msg"://'
  [ "$s" = RESOLVED ]
}

run_unknown() {
  id="INC-unknown-$STAMP"
  echo "== Type inconnu : aucune action attendue"
  send "$id" unknown auth 192.168.137.251; echo
  s="$(wait_final "$id")"; echo "état final : $s"
  [ "$s" = ESCALATED ]
}

run_outage() { # numéro d'essai
  n="$1"; id="INC-outage-$STAMP-$n"
  echo "== Essai $n : arrêt de api-paiement"
  docker compose stop api-paiement >/dev/null 2>&1
  t0="$(date +%s)"
  send "$id" dos api-paiement "192.168.137.$((200 + n))"; echo
  s="$(wait_final "$id")"
  t1="$(date +%s)"
  ms="$(call "$REM/incidents/$id" | field duration_ms)"
  echo "   état final : $s | durée mesurée par le moteur : ${ms:-?} ms | durée totale : $((t1 - t0)) s"
  RESULTS="$RESULTS
| $n | $s | ${ms:-?} | $((t1 - t0)) |"
  [ "$s" = RESOLVED ]
}

RC=0
case "$MODE" in
  fake) run_fake || RC=1 ;;
  unknown) run_unknown || RC=1 ;;
  outage) RESULTS=""; run_outage 1 || RC=1 ;;
  repeat)
    COUNT="${2:-5}"; RESULTS=""; k=1
    while [ "$k" -le "$COUNT" ]; do run_outage "$k" || RC=1; k=$((k + 1)); sleep 2; done
    echo
    echo "| Essai | État final | Durée moteur (ms) | Durée totale (s) |"
    echo "|---|---|---|---|$RESULTS"
    ;;
  *) echo "mode inconnu : $MODE"; RC=2 ;;
esac

echo
[ "$RC" = 0 ] && echo "TEST OK" || echo "TEST EN ÉCHEC"
exit "$RC"
