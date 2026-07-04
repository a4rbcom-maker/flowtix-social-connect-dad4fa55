#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

mkdir -p logs sessions

HEALTH_JSON="$(curl -fsS --max-time 8 http://127.0.0.1:3000/health 2>/dev/null || true)"
if [ -n "$HEALTH_JSON" ]; then
  STATUS="$(printf '%s' "$HEALTH_JSON" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{process.stdout.write(JSON.parse(d).status||'')}catch{}})" 2>/dev/null || true)"
  if [ "$STATUS" = "ok" ]; then
    exit 0
  fi
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Bridge health failed. Restarting container without touching sessions..."
docker compose up -d --remove-orphans
docker logs wa-bridge --tail 80 || true