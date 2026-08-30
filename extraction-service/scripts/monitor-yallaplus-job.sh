#!/usr/bin/env bash
# Monitor job c3b1b136 — @yalla.plus (known working account)
cd /d/Projects/FlowTix/extraction-service || exit 1
SB_URL=$(grep '^SUPABASE_URL=' .env | cut -d= -f2- | tr -d '\r')
SB_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env | cut -d= -f2- | tr -d '\r')
JOB="c3b1b136-5aa7-4373-94c3-ba223c5cf6e5"

for i in $(seq 1 70); do
  ROW=$(curl -s "$SB_URL/rest/v1/extraction_jobs?id=eq.$JOB&select=status,result_count,progress,updated_at,error" \
    -H "apikey: $SB_KEY" -H "Authorization: Bearer $SB_KEY")
  STATUS=$(echo "$ROW" | python -c "import json,sys; d=json.load(sys.stdin); print(d[0]['status'] if d else 'gone')")
  RC=$(echo "$ROW" | python -c "import json,sys; d=json.load(sys.stdin); print(d[0]['result_count'] if d else 0)")
  PHASE=$(echo "$ROW" | python -c "
import json,sys
d=json.load(sys.stdin)
p=(d[0].get('progress') or {}) if d else {}
print(p.get('phase','?'), 'stored:', p.get('extracted',0), '/', p.get('total','?'), 'cov:', p.get('coverage_rate'), 'rate/min:', p.get('rate_per_min'), 'stop:', p.get('stop_reason'))
")
  echo "[$i] status=$STATUS rc=$RC | phase=$PHASE"
  case "$STATUS" in
    completed|failed|canceled) break;;
  esac
  sleep 30
done
echo "FINAL:"
curl -s "$SB_URL/rest/v1/extraction_jobs?id=eq.$JOB&select=status,result_count,progress,error,started_at,completed_at" \
  -H "apikey: $SB_KEY" -H "Authorization: Bearer $SB_KEY"