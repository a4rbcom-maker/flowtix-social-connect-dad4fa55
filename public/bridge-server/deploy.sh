#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

mkdir -p sessions backups logs
chmod 700 sessions || true

EXPECTED_VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' package.json | head -n 1)"

SESSION_COUNT="$(find sessions -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')"
if [ "${SESSION_COUNT:-0}" -gt 0 ]; then
  BACKUP_FILE="backups/sessions-$(date -u +%Y%m%dT%H%M%SZ).tgz"
  tar -czf "$BACKUP_FILE" sessions
  find backups -name 'sessions-*.tgz' -type f -mtime +14 -delete
  echo "Backed up $SESSION_COUNT WhatsApp session(s) to $BACKUP_FILE"
else
  echo "No persisted WhatsApp sessions found yet."
fi

# Do not force-remove the running container. `compose up` recreates only when
# needed and gives Baileys time to flush auth credentials before restart.
docker compose up -d --build --remove-orphans

echo "Waiting for Bridge health..."
for i in $(seq 1 60); do
  HEALTH_JSON="$(curl -fsS http://127.0.0.1:3000/health 2>/dev/null || true)"
  if [ -n "$HEALTH_JSON" ]; then
    LIVE_VERSION="$(printf '%s' "$HEALTH_JSON" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
    if [ "$LIVE_VERSION" = "$EXPECTED_VERSION" ]; then
      echo "Bridge is healthy (v$LIVE_VERSION)"
      chmod +x bridge-watchdog.sh || true
      CRON_LINE="*/2 * * * * cd $(pwd) && ./bridge-watchdog.sh >> logs/bridge-watchdog.log 2>&1"
      ( crontab -l 2>/dev/null | grep -v 'bridge-watchdog.sh' ; echo "$CRON_LINE" ) | crontab -
      echo "Bridge watchdog cron installed (every 2 minutes)."
      docker ps --filter name=wa-bridge
      exit 0
    fi
    echo "Bridge version mismatch: expected v$EXPECTED_VERSION, got v${LIVE_VERSION:-unknown}"
  fi
  sleep 2
done

echo "Bridge did not become healthy. Last logs:"
docker logs wa-bridge --tail 120
exit 1