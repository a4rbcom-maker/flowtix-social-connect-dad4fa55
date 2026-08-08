#!/bin/bash
set -euo pipefail

DEPLOY_DIR="/www/wwwroot/api.flowtixtools.com"

echo "=== FlowTix Extraction Service — VPS Setup ==="

if [ ! -d "$DEPLOY_DIR" ]; then
  echo "Creating directory: $DEPLOY_DIR"
  mkdir -p "$DEPLOY_DIR/logs"
fi

cd "$DEPLOY_DIR"

if [ ! -f ".env" ]; then
  echo "ERROR: .env file not found at $DEPLOY_DIR/.env"
  echo "Create it with:"
  echo "  nano $DEPLOY_DIR/.env"
  exit 1
fi

if ! command -v node &> /dev/null; then
  echo "ERROR: Node.js not found. Install Node.js 20 first."
  exit 1
fi

NODE_VERSION=$(node -v | cut -d'.' -f1 | tr -d 'v')
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "ERROR: Node.js $NODE_VERSION is too old. Need v18+."
  exit 1
fi

echo "Node.js: $(node -v)"

if ! command -v pm2 &> /dev/null; then
  echo "Installing PM2..."
  npm install -g pm2
fi

if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm ci --omit=dev 2>/dev/null || npm install --omit=dev
fi

echo "Building TypeScript..."
npm run build

echo "Installing Playwright Chromium..."
npx playwright install chromium
npx playwright install-deps chromium 2>/dev/null || echo "WARNING: Could not install system deps automatically. Run: sudo npx playwright install-deps chromium"

echo "Starting/restarting PM2 process..."
pm2 delete flowtix-extraction 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save

echo ""
echo "=== Done! ==="
echo "Service running on port 3100 via PM2"
echo "Check status: pm2 status"
echo "Check logs:   pm2 logs flowtix-extraction"
echo ""
echo "NEXT: Configure Nginx reverse proxy for api.flowtixtools.com → 127.0.0.1:3100"
