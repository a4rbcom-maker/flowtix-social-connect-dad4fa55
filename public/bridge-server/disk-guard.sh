#!/usr/bin/env bash
# Disk guard: keeps the VPS from filling up and breaking WhatsApp auth writes.
# Run every hour via cron:
#   0 * * * * cd /path/to/bridge-server && ./disk-guard.sh >> logs/disk-guard.log 2>&1
set -euo pipefail

cd "$(dirname "$0")"
mkdir -p logs

THRESHOLD_WARN=80
THRESHOLD_CRIT=90

USE=$(df -P / | awk 'NR==2 {gsub("%",""); print $5}')
TS="[$(date -u +%Y-%m-%dT%H:%M:%SZ)]"

echo "$TS root disk at ${USE}%"

if [ "$USE" -lt "$THRESHOLD_WARN" ]; then
  exit 0
fi

echo "$TS ${USE}% >= ${THRESHOLD_WARN}% — running cleanup"

sudo journalctl --vacuum-size=200M || true
docker system prune -af --filter "until=168h" || true
docker builder prune -af --filter "until=168h" || true
find /var/lib/docker/containers -name '*-json.log' -size +50M -print \
  -exec sudo truncate -s 0 {} \; 2>/dev/null || true
find backups -name 'sessions-*.tgz' -type f -mtime +14 -delete 2>/dev/null || true

USE_AFTER=$(df -P / | awk 'NR==2 {gsub("%",""); print $5}')
echo "$TS cleanup done — disk now ${USE_AFTER}%"

if [ "$USE_AFTER" -ge "$THRESHOLD_CRIT" ]; then
  echo "$TS CRITICAL: still at ${USE_AFTER}% after cleanup — manual intervention required" >&2
  exit 2
fi