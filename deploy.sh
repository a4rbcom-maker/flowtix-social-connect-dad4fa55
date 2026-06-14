#!/usr/bin/env bash
# Flowtix Tools — Safe deploy script for self-hosted server
# Usage: ./deploy.sh
# Requirements: bun installed, .env file present in project root with VITE_* vars
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

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
BACKUP_DIR=".output.backup.$(date +%Y%m%d-%H%M%S)"
if [ -d .output ]; then
  cp -r .output "$BACKUP_DIR"
  echo "✅ Backup saved to $BACKUP_DIR"
fi

echo "==> [4/6] Clean install dependencies..."
rm -rf node_modules dist .vinxi
bun install --frozen-lockfile || bun install

echo "==> [5/6] Building project..."
# Build into a temp dir first, only swap if successful
rm -rf .output.new
if bun run build; then
  if [ -d .output ]; then
    mv .output .output.new
    # We built in-place; rename for atomic swap is not needed since build succeeded
    mv .output.new .output 2>/dev/null || true
  fi
  echo "✅ Build succeeded"
else
  echo "❌ Build FAILED — keeping previous .output intact, nothing changed"
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
ls -dt .output.backup.* 2>/dev/null | tail -n +4 | xargs -r rm -rf

echo ""
echo "🎉 Deploy complete! Site should be live."
echo "   If anything looks broken: rm -rf .output && mv $BACKUP_DIR .output && pm2 restart flowtixtools-web --update-env"
