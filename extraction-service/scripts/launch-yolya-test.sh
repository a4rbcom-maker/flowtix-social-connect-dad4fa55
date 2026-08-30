#!/usr/bin/env bash
# Launch a live ig_followers test job on @yolya_qa via PRODUCTION API
cd /d/Projects/FlowTix/extraction-service || exit 1
API_KEY=$(grep '^API_KEY=' .env | cut -d= -f2- | tr -d '\r')
API="https://api.flowtixtools.com"

curl -s --max-time 30 -X POST "$API/extract" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "ig_followers",
    "source_url": "https://www.instagram.com/yolya_qa/",
    "session_id": "cdbc902a-ead4-4db5-a85a-45d0cfeec817",
    "max_results": 100000,
    "skip_duplicates": true
  }'
echo
