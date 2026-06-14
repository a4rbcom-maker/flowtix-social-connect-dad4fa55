#!/usr/bin/env bash
# Flowtix Tools — Safe deploy script for self-hosted server
# Usage: ./deploy.sh
# Requirements: node/npm or bun installed, .env file present in project root with VITE_* vars
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if command -v bun >/dev/null 2>&1; then
  PKG_MANAGER="bun"
elif command -v npm >/dev/null 2>&1; then
  PKG_MANAGER="npm"
else
  echo "❌ Neither bun nor npm is installed. Install Node.js/npm or Bun, then re-run."
  exit 1
fi

install_dependencies() {
  if [ "$PKG_MANAGER" = "bun" ]; then
    bun install --frozen-lockfile || bun install
  else
    npm install
  fi
}

build_project() {
  if [ "$PKG_MANAGER" = "bun" ]; then
    bun run build
  else
    npm run build
  fi
}

echo "==> [1/6] Checking .env file..."
if [ ! -f .env ]; then
  echo "❌ .env file missing! Create it with VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY / VITE_SUPABASE_PROJECT_ID"
  exit 1
fi
for var in VITE_SUPABASE_URL VITE_SUPABASE_PUBLISHABLE_KEY VITE_SUPABASE_PROJECT_ID; do
  if ! grep -q "^${var}=" .env; then
    echo "❌ Missing $var in .env"
    exit 1
  fi
done
echo "✅ .env OK"

echo "==> [2/6] Pulling latest from GitHub..."
git fetch --all --prune
git reset --hard origin/main 2>/dev/null || git reset --hard origin/master

echo "==> [3/6] Backing up current build (rollback safety)..."
BACKUP_DIR="dist.backup.$(date +%Y%m%d-%H%M%S)"
if [ -d dist ]; then
  cp -r dist "$BACKUP_DIR"
  echo "✅ Backup saved to $BACKUP_DIR"
fi

echo "==> [4/6] Clean install dependencies..."
rm -rf node_modules dist .vinxi
echo "Using package manager: $PKG_MANAGER"
install_dependencies

echo "==> [5/6] Building project..."
if build_project; then
  echo "✅ Build succeeded"
else
  [ -d "$BACKUP_DIR" ] && { rm -rf dist && mv "$BACKUP_DIR" dist; }
  echo "❌ Build FAILED — previous dist restored, nothing changed"
  exit 1
fi

echo "==> [6/6] Restarting server (pm2)..."
if command -v pm2 >/dev/null 2>&1; then
  pm2 delete flowtixtools-web 2>/dev/null || true
  pm2 start ecosystem.config.cjs --only flowtixtools-web --update-env
  pm2 save
else
  echo "⚠️  pm2 not found — restart your server process manually:"
  echo "    PORT=3001 node scripts/tanstack-node-server.mjs"
fi

# Optional: purge Cloudflare cache (uncomment + fill in)
# curl -X POST "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/purge_cache" \
#   -H "Authorization: Bearer $CF_API_TOKEN" \
#   -H "Content-Type: application/json" \
#   --data '{"purge_everything":true}'

# Keep only last 3 backups
ls -dt dist.backup.* 2>/dev/null | tail -n +4 | xargs -r rm -rf

echo ""
echo "🎉 Deploy complete! Site should be live."
echo "   If anything looks broken: rm -rf dist && mv $BACKUP_DIR dist && pm2 restart flowtixtools-web --update-env"
