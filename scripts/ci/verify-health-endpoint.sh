#!/usr/bin/env bash
# Verify /api/public/health responds 200 to both GET and HEAD.
# Usage: verify-health-endpoint.sh <base_url>
set -euo pipefail

BASE_URL="${1:-}"
if [[ -z "$BASE_URL" ]]; then
  echo "::error::base URL is required (e.g. https://flowtix-social-connect.lovable.app)"
  exit 2
fi

URL="${BASE_URL%/}/api/public/health"
FAIL=0

echo "→ Checking GET  $URL"
GET_CODE=$(curl -fsS -o /tmp/health-get.json -w "%{http_code}" "$URL" || true)
echo "   status: $GET_CODE"
if [[ "$GET_CODE" != "200" ]]; then
  echo "::error::GET $URL returned $GET_CODE"
  FAIL=1
else
  head -c 200 /tmp/health-get.json; echo
fi

echo "→ Checking HEAD $URL"
HEAD_CODE=$(curl -fsSI -o /tmp/health-head.txt -w "%{http_code}" -X HEAD "$URL" || true)
echo "   status: $HEAD_CODE"
if [[ "$HEAD_CODE" != "200" ]]; then
  echo "::error::HEAD $URL returned $HEAD_CODE"
  FAIL=1
fi

# Also confirm static check: handler exists in source
if ! grep -q "HEAD: async" src/routes/api/public/health.ts; then
  echo "::error::HEAD handler missing in src/routes/api/public/health.ts"
  FAIL=1
fi

if [[ "$FAIL" -ne 0 ]]; then
  exit 1
fi
echo "✓ Health endpoint responds 200 to GET and HEAD"
