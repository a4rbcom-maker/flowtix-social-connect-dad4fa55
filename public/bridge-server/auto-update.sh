#!/usr/bin/env bash
# Bridge Auto-Update Script with health check + rollback.
# Run via cron every hour:
#   0 * * * * /path/to/bridge-server/auto-update.sh >> /var/log/bridge-update.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"

echo "[$(date)] Checking for updates..."

git fetch origin main --quiet

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "[$(date)] Already up-to-date. Skipping."
  exit 0
fi

echo "[$(date)] New version detected: $LOCAL → $REMOTE"
echo "[$(date)] Pulling changes..."

mkdir -p sessions backups logs
SESSION_COUNT="$(find sessions -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')"
if [ "${SESSION_COUNT:-0}" -gt 0 ]; then
  BACKUP_FILE="backups/sessions-$(date -u +%Y%m%dT%H%M%SZ).tgz"
  tar -czf "$BACKUP_FILE" sessions
  find backups -name 'sessions-*.tgz' -type f -mtime +14 -delete
  echo "[$(date)] Backed up $SESSION_COUNT WhatsApp session(s) to $BACKUP_FILE"
fi

git pull origin main --quiet

rollback() {
  echo "[$(date)] ❌ Update failed health check. Rolling back to $LOCAL"
  git reset --hard "$LOCAL" --quiet
  docker compose up -d --build --remove-orphans
  echo "[$(date)] Rollback triggered. Recent bridge logs:"
  docker logs wa-bridge --tail 80 || true
}

health_check() {
  for i in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:3000/health >/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}

CHANGED=$(git diff --name-only "$LOCAL" "$REMOTE")
echo "[$(date)] Changed files: $CHANGED"

if echo "$CHANGED" | grep -qE "(Dockerfile|package\.json|package-lock\.json)"; then
  echo "[$(date)] Dependencies changed → full rebuild"
  docker compose up -d --build --remove-orphans
else
  echo "[$(date)] Code-only change → graceful recreate"
  docker compose up -d --build --remove-orphans
fi

if ! health_check; then
  rollback
  exit 1
fi

echo "[$(date)] ✅ Update complete."
chmod +x bridge-watchdog.sh || true
( crontab -l 2>/dev/null | grep -v 'bridge-watchdog.sh' ; echo "*/2 * * * * cd $(pwd) && ./bridge-watchdog.sh >> logs/bridge-watchdog.log 2>&1" ) | crontab -

if [ -n "${ADMIN_NOTIFY_URL:-}" ]; then
  curl -s -X POST "$ADMIN_NOTIFY_URL" \
    -H "Content-Type: application/json" \
    -d "{\"event\":\"bridge_updated\",\"commit\":\"$REMOTE\"}" || true
fi