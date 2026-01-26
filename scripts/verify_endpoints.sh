#!/usr/bin/env bash
set -euo pipefail
TRUST_ROOT="${1:-https://www.onetoo.eu}"
SEARCH_BASE="${2:-https://search.onetoo.eu}"
ACCEPTED="${TRUST_ROOT}/public/dumps/contrib-accepted.json"
curl -s -o /dev/null -w "accepted-set: %{http_code}\n" "$ACCEPTED"
curl -s -o /dev/null -w "openapi.json: %{http_code}\n" "$SEARCH_BASE/openapi.json"
curl -s -o /dev/null -w "search sample: %{http_code}\n" "$SEARCH_BASE/search/v1?q=hgp&limit=10"
echo "OK"


# Well-known
curl -fsS "$BASE/.well-known/index.json" >/dev/null && echo "OK .well-known/index.json"
curl -fsS "$BASE/.well-known/ai-trust-hub.json" >/dev/null && echo "OK .well-known/ai-trust-hub.json"
curl -fsS "$BASE/.well-known/llms.txt" >/dev/null && echo "OK .well-known/llms.txt"
curl -fsS "$BASE/portal/notary.html" >/dev/null && echo "OK notary"
curl -fsS "$BASE/portal/merchant.html" >/dev/null && echo "OK merchant"
curl -fsS "$BASE/portal/room.html" >/dev/null && echo "OK room"
