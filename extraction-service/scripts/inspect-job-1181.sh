#!/usr/bin/env bash
# Verify the LIVE production job via prod API (service-side log proof is on the VPS)
cd /d/Projects/FlowTix/extraction-service || exit 1
API_KEY=$(grep '^API_KEY=' .env | cut -d= -f2- | tr -d '\r')
SB_URL=$(grep '^SUPABASE_URL=' .env | cut -d= -f2- | tr -d '\r')
SB_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env | cut -d= -f2- | tr -d '\r')
API="https://api.flowtixtools.com"
JOB="1181e3c2-8093-45a1-ab2a-7b151938e382"

echo "--- job full progress (stop_reason + sessions) ---"
curl -s "$SB_URL/rest/v1/extraction_jobs?id=eq.$JOB&select=status,result_count,progress,started_at,completed_at" \
  -H "apikey: $SB_KEY" -H "Authorization: Bearer $SB_KEY" | python -m json.tool

echo "--- stored rows for this job ---"
curl -s -I "$SB_URL/rest/v1/extraction_results?job_id=eq.$JOB&select=fb_id" \
  -H "apikey: $SB_KEY" -H "Authorization: Bearer $SB_KEY" | grep -i "content-range"

echo "--- stored usernames sample (last 15 by created_at) ---"
curl -s "$SB_URL/rest/v1/extraction_results?job_id=eq.$JOB&select=fb_id,created_at&order=created_at.desc&limit=15" \
  -H "apikey: $SB_KEY" -H "Authorization: Bearer $SB_KEY"
