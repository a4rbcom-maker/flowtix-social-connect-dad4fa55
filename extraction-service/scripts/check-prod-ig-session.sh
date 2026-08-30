#!/usr/bin/env bash
# IG session status for the test session (correct table: ig_sessions)
cd /d/Projects/FlowTix/extraction-service || exit 1
SB_URL=$(grep '^SUPABASE_URL=' .env | cut -d= -f2- | tr -d '\r')
SB_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env | cut -d= -f2- | tr -d '\r')

echo "---ig_sessions cdbc902a---"
curl -s "$SB_URL/rest/v1/ig_sessions?id=eq.cdbc902a-ead4-4db5-a85a-45d0cfeec817&select=id,status,ig_username,updated_at" \
  -H "apikey: $SB_KEY" -H "Authorization: Bearer $SB_KEY"
echo
echo "---any connected ig sessions---"
curl -s "$SB_URL/rest/v1/ig_sessions?status=eq.connected&select=id,ig_username,updated_at&limit=5" \
  -H "apikey: $SB_KEY" -H "Authorization: Bearer $SB_KEY"
echo
