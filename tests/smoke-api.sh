#!/bin/sh
# Test de fumée de auth + api-paiement. Usage : bash tests/smoke-api.sh
# Variables : AUTH_URL (4001), API_URL (4000), DASHBOARD_URL (8088)
# Lit USER_PASSWORD et MONITOR_PASSWORD depuis .env.
set -u
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && . ./.env; set +a
AUTH_URL="${AUTH_URL:-http://localhost:4001}"
API_URL="${API_URL:-http://localhost:4000}"
DASHBOARD_URL="${DASHBOARD_URL:-http://localhost:8088}"
FAIL=0
RUN="$(date +%s)$$"

check() { # nom, attendu, obtenu
  if [ "$2" = "$3" ]; then echo "  OK   $1"; else echo "  FAIL $1 (attendu $2, obtenu $3)"; FAIL=1; fi
}
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
token_of() { sed -E 's/.*"token":"([^"]+)".*/\1/'; }

echo "== Santé"
check "auth /health" 200 "$(code "$AUTH_URL/health")"
check "api /health"  200 "$(code "$API_URL/health")"
check "dashboard /health" 200 "$(code "$DASHBOARD_URL/health")"
check "dashboard /api/overview" 200 "$(code "$DASHBOARD_URL/api/overview")"

echo "== Authentification"
check "login invalide" 401 "$(code -X POST "$AUTH_URL/auth/login" -H 'Content-Type: application/json' -d '{"username":"alice","password":"mauvais"}')"
ALICE=$(curl -s -X POST "$AUTH_URL/auth/login" -H 'Content-Type: application/json' -d "{\"username\":\"alice\",\"password\":\"$USER_PASSWORD\"}" | token_of)
BOB=$(curl -s -X POST "$AUTH_URL/auth/login" -H 'Content-Type: application/json' -d "{\"username\":\"bob\",\"password\":\"$USER_PASSWORD\"}" | token_of)
MON=$(curl -s -X POST "$AUTH_URL/auth/login" -H 'Content-Type: application/json' -d "{\"username\":\"monitor\",\"password\":\"$MONITOR_PASSWORD\"}" | token_of)
check "verify alice" 200 "$(code "$AUTH_URL/auth/verify" -H "Authorization: Bearer $ALICE")"
check "verify sans jeton" 401 "$(code "$AUTH_URL/auth/verify")"

echo "== Transactions"
tx() { # jeton, from, to, montant, clé
  curl -s -o /dev/null -w '%{http_code}' -X POST "$API_URL/transactions" -H "Authorization: Bearer $1" -H 'Content-Type: application/json' \
    -d "{\"from_account\":\"$2\",\"to_account\":\"$3\",\"amount\":$4,\"currency\":\"EUR\",\"idempotency_key\":\"$5\"}"
}
check "sans jeton" 401 "$(code -X POST "$API_URL/transactions" -H 'Content-Type: application/json' -d '{}')"
check "paiement alice -> bob" 201 "$(tx "$ALICE" ACC-001 ACC-002 10 "smoke-$RUN-1")"
check "même clé = doublon" 409 "$(tx "$ALICE" ACC-001 ACC-002 10 "smoke-$RUN-1")"
check "solde insuffisant" 402 "$(tx "$ALICE" ACC-001 ACC-002 999999 "smoke-$RUN-2")"
check "débit d'un compte d'autrui" 403 "$(tx "$ALICE" ACC-002 ACC-001 5 "smoke-$RUN-3")"
check "compte inconnu" 404 "$(tx "$ALICE" ACC-001 ACC-999 5 "smoke-$RUN-4")"
check "montant négatif" 400 "$(tx "$ALICE" ACC-001 ACC-002 -5 "smoke-$RUN-5")"
check "paiement monitor" 201 "$(tx "$MON" ACC-MON-1 ACC-MON-2 1 "smoke-$RUN-6")"

echo "== Soldes et intégrité"
check "liste de ses comptes" 200 "$(code "$API_URL/accounts" -H "Authorization: Bearer $ALICE")"
check "solde de son compte" 200 "$(code "$API_URL/accounts/ACC-001/balance" -H "Authorization: Bearer $ALICE")"
check "solde du compte d'autrui" 404 "$(code "$API_URL/accounts/ACC-002/balance" -H "Authorization: Bearer $ALICE")"
INTEG=$(curl -s "$API_URL/integrity" -H "Authorization: Bearer $MON")
echo "  integrity : $INTEG"
case "$INTEG" in *'"consistent":true'*) echo "  OK   intégrité";; *) echo "  FAIL intégrité"; FAIL=1;; esac

echo
[ "$FAIL" = 0 ] && echo "TOUS LES TESTS PASSENT" || echo "ECHEC : voir les lignes FAIL"
exit "$FAIL"
