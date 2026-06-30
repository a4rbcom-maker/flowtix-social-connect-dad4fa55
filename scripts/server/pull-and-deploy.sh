#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Manual pull & deploy from GitHub directly on the VPS.
#
# Use this when GitHub Actions is broken and you need to ship an update fast.
# It clones/pulls the repo into a side directory, builds, then rsyncs the
# build artifacts into the live deploy path and reloads PM2.
#
# Usage on the VPS:
#   bash scripts/server/pull-and-deploy.sh
#
# Optional environment variables (override defaults):
#   REPO_URL     Git repo URL          (default: https://github.com/a4rbcom-maker/flowtix-social-connect.git)
#   BRANCH       Git branch to pull    (default: main)
#   WORK_DIR     Local checkout dir    (default: $HOME/flowtix-source)
#   DEPLOY_PATH  Live web root         (default: /www/wwwroot/flowtixtools.com)
#   APP_NAME     PM2 app name          (default: flowtixtools-web)
#   APP_PORT     SSR listen port       (default: 3100)
# ─────────────────────────────────────────────────────────────────────────────
set -Eeuo pipefail

REPO_URL="${REPO_URL:-https://github.com/a4rbcom-maker/flowtix-social-connect.git}"
BRANCH="${BRANCH:-main}"
WORK_DIR="${WORK_DIR:-$HOME/flowtix-source}"
DEPLOY_PATH="${DEPLOY_PATH:-/www/wwwroot/flowtixtools.com}"
APP_NAME="${APP_NAME:-flowtixtools-web}"
APP_PORT="${APP_PORT:-3100}"

log() { printf '\n=== %s ===\n' "$*"; }

# ─── 1. Get / refresh source ────────────────────────────────────────────────
if [ ! -d "$WORK_DIR/.git" ]; then
  log "Cloning $REPO_URL into $WORK_DIR"
  git clone --depth 50 --branch "$BRANCH" "$REPO_URL" "$WORK_DIR"
else
  log "Pulling latest $BRANCH into $WORK_DIR"
  cd "$WORK_DIR"
  git fetch --depth 50 origin "$BRANCH"
  git reset --hard "origin/$BRANCH"
fi

cd "$WORK_DIR"
SHA=$(git rev-parse HEAD)
SHORT_SHA="${SHA:0:7}"
log "Building commit $SHORT_SHA"

# ─── 2. Pick a package manager ──────────────────────────────────────────────
if command -v bun >/dev/null 2>&1; then
  PM="bun"
elif command -v npm >/dev/null 2>&1; then
  PM="npm"
else
  echo "ERROR: neither bun nor npm is installed on this server." >&2
  exit 1
fi

# ─── 3. Install + build ─────────────────────────────────────────────────────
if [ "$PM" = "bun" ]; then
  bun install --frozen-lockfile
  bun run build
  # Re-install production-only deps for shipping
  rm -rf node_modules
  bun install --production --frozen-lockfile
else
  npm ci
  npm run build
  rm -rf node_modules
  npm ci --omit=dev
fi

# ─── 4. Locate the SSR entry the build produced ─────────────────────────────
if [ ! -d dist ] && [ -d .output ]; then
  log "Normalizing Nitro output from .output to dist"
  mkdir -p dist
  [ -d .output/server ] && cp -r .output/server dist/server
  [ -d .output/public ] && cp -r .output/public dist/client
  [ -f .output/nitro.json ] && cp .output/nitro.json dist/nitro.json
  [ -f .output/package.json ] && cp .output/package.json dist/package.json
fi

SERVER_ENTRY=""
for c in dist/server/server.js dist/server/server.mjs dist/server/index.js dist/server/index.mjs; do
  [ -f "$c" ] && { SERVER_ENTRY="$c"; break; }
done
if [ -z "$SERVER_ENTRY" ]; then
  echo "ERROR: SSR entry missing in dist/server/" >&2
  find dist -maxdepth 3 -type f | head -40
  exit 1
fi
log "SSR entry: $SERVER_ENTRY"

# ─── 5. Write a deploy-version.json so health endpoints report this build ───
DEPLOYED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cat > deploy-version.json <<JSON
{
  "sha": "${SHA}",
  "short_sha": "${SHORT_SHA}",
  "run_id": "manual-$(date +%s)",
  "repo": "a4rbcom-maker/flowtix-social-connect",
  "deployed_at": "${DEPLOYED_AT}",
  "mode": "ssr",
  "status": "ok",
  "source": "manual-pull"
}
JSON

# ─── 6. Sync to live deploy path (preserve server-local files) ──────────────
log "Syncing build into $DEPLOY_PATH"
RSYNC_FLAGS=(-a --delete
  --exclude='.env'
  --exclude='.user.ini'
  --exclude='.htaccess'
  --exclude='var/'
  --exclude='.well-known/'
  --exclude='.deploy/'
  --exclude='vps-worker/'
  --exclude='.git/'
  --exclude='*.log'
)

# Ship only what the runtime needs: dist, node_modules, scripts, package files,
# ecosystem config, and the deploy-version marker.
TMP_BUNDLE=$(mktemp -d)
trap 'rm -rf "$TMP_BUNDLE"' EXIT
cp -r dist "$TMP_BUNDLE/dist"
cp -r node_modules "$TMP_BUNDLE/node_modules"
cp -r scripts "$TMP_BUNDLE/scripts"
cp package.json "$TMP_BUNDLE/package.json"
[ -f bun.lockb ]      && cp bun.lockb "$TMP_BUNDLE/bun.lockb"      || true
[ -f package-lock.json ] && cp package-lock.json "$TMP_BUNDLE/package-lock.json" || true
cp ecosystem.config.cjs "$TMP_BUNDLE/ecosystem.config.cjs"
cp deploy-version.json  "$TMP_BUNDLE/deploy-version.json"

if rsync "${RSYNC_FLAGS[@]}" "$TMP_BUNDLE/" "$DEPLOY_PATH/" 2>/tmp/rsync.err; then
  echo "✓ Synced (user rsync)."
elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
  cat /tmp/rsync.err
  echo "→ retrying with sudo…"
  sudo rsync "${RSYNC_FLAGS[@]}" "$TMP_BUNDLE/" "$DEPLOY_PATH/"
  echo "✓ Synced (sudo rsync)."
else
  cat /tmp/rsync.err
  echo "ERROR: rsync failed and sudo is unavailable." >&2
  exit 1
fi

# ─── 7. Reload PM2 ──────────────────────────────────────────────────────────
cd "$DEPLOY_PATH"
log "Reloading PM2 app $APP_NAME"
export APP_NAME APP_PORT DEPLOY_PATH SERVER_ENTRY
export NODE_ENV=production
export DEPLOY_SHA="$SHA" DEPLOYED_AT="$DEPLOYED_AT"

if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs --only "$APP_NAME" --update-env \
    || pm2 restart "$APP_NAME" --update-env
else
  pm2 start ecosystem.config.cjs --only "$APP_NAME" --update-env
fi
pm2 save || true

# ─── 8. Local health probe ──────────────────────────────────────────────────
log "Health probe on 127.0.0.1:${APP_PORT}"
OK=0
for i in $(seq 1 30); do
  BODY=$(curl -fsS --max-time 5 "http://127.0.0.1:${APP_PORT}/api/public/health" || true)
  if echo "$BODY" | grep -q "$SHORT_SHA"; then
    echo "✓ Healthy — serving $SHORT_SHA"
    OK=1
    break
  fi
  sleep 2
done

if [ "$OK" != "1" ]; then
  echo "::warning:: Native health endpoint did not report $SHORT_SHA. Check 'pm2 logs $APP_NAME'." >&2
  pm2 logs "$APP_NAME" --lines 60 --nostream || true
  exit 1
fi

echo
echo "════════════════════════════════════════════════════════════════"
echo "  ✓ Manual deploy complete — $SHORT_SHA is live"
echo "════════════════════════════════════════════════════════════════"
