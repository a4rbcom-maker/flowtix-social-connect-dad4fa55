#!/usr/bin/env bash
# Find the IG sessions table name + status of the test session
cd /d/Projects/FlowTix/extraction-service || exit 1
SB_URL=$(grep '^SUPABASE_URL=' .env | cut -d= -f2- | tr -d '\r')
SB_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env | cut -d= -f2- | tr -d '\r')

echo "---tables like %session%---"
curl -s "$SB_URL/rest/v1/rpc/to_jsonb" -X POST -H "apikey: $SB_KEY" -H "Authorization: Bearer $SB_KEY" >/dev/null 2>&1
curl -s "$SB_URL/rest/v1/?select=*da" -H "apikey: $SB_KEY" -H "Authorization: Bearer $SB_KEY" 2>/dev/null | python -c "
import sys,re
try:
    d=json.load(sys.stdin)
    paths=[p['path'] for p in d.get('paths',[])]
    for p in paths:
        if 'session' in p.lower(): print(p)
except Exception as e:
    print('schema probe failed:', e)
" 2>/dev/null || true
echo "---grep codebase for table name---"
grep -rho 'from("ig_[a-z_]*session[a-z_]*")' src 2>/dev/null | sort -u
