#!/usr/bin/env bash
# Poll job 9dec79ee progress until it settles (max ~35 min)
cd /d/Projects/FlowTix/extraction-service || exit 1
SB_URL=$(grep '^SUPABASE_URL=' .env | cut -d= -f2- | tr -d '\r')
SB_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env | cut -d= -f2- | tr -d '\r')
JOB="1181e3c2-8093-45a1-ab2a-7b151938e382"

for i in $(seq 1 70); do
  ROW=$(curl -s "$SB_URL/rest/v1/extraction_jobs?id=eq.$JOB&select=status,result_count,progress,updated_at,error" \
    -H "apikey: $SB_KEY" -H "Authorization: Bearer $SB_KEY")
  STATUS=$(echo "$ROW" | python -c "import json,sys; d=json.load(sys.stdin); print(d[0]['status'] if d else 'gone')")
  RC=$(echo "$ROW" | python -c "import json,sys; d=json.load(sys.stdin); print(d[0]['result_count'] if d else 0)")
  PHASE=$(echo "$ROW" | python -c "
import json,sys
d=json.load(sys.stdin)
p=(d[0].get('progress') or {}) if d else {}
print(p.get('phase','?'), p.get('extracted',0), '/', p.get('total','?'), 'cov:', p.get('coverage_rate'), 'rate/min:', p.get('rate_per_min'), 'stop:', p.get('stop_reason'))
")
  echo "[$i] status=$STATUS stored=$RC | phase=$PHASE"
  case "$STATUS" in
    completed|failed|canceled) break;;
  esac
  sleep 30
done
echo "FINAL:"
curl -s "$SB_URL/rest/v1/extraction_jobs?id=eq.$JOB&select=status,result_count,progress,error,started_at,completed_at" \
  -H "apikey: $SB_KEY" -H "Authorization: Bearer $SB_KEY"
