#!/usr/bin/env bash
# Flowtix VPS Worker — one-shot redeploy script.
# Usage:  bash redeploy.sh            (from anywhere)
#         ./redeploy.sh               (after chmod +x)
#
# What it does:
#   1) cd into the worker directory (the folder containing this script)
#   2) git fetch + reset to origin/<branch>  (default: main)
#   3) npm install --omit=dev             (or `npm ci` if package-lock.json exists)
#   4) pm2 restart <PM2_NAME>             (default: flowtix-bot-worker)
#   5) pm2 save                           so the process survives reboot
#   6) tails the last 20 log lines so you see it come up
#
# Environment overrides:
#   BRANCH=main            git branch to deploy
#   PM2_NAME=flowtix-bot-worker
#   SKIP_INSTALL=1         skip npm install
#   SKIP_GIT=1             skip git pull (useful for local hot-fixes)

set -euo pipefail

# --- config ---
BRANCH="${BRANCH:-main}"
PM2_NAME="${PM2_NAME:-flowtix-bot-worker}"

# --- move to the script's own directory ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

log() { printf '\033[1;36m[redeploy]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[redeploy]\033[0m %s\n' "$*" >&2; }

log "Working directory: $SCRIPT_DIR"
log "Branch:            $BRANCH"
log "PM2 process:       $PM2_NAME"

# --- 1) git pull ---
if [[ "${SKIP_GIT:-0}" != "1" ]]; then
  if [[ -d .git ]] || git rev-parse --git-dir >/dev/null 2>&1; then
    log "git fetch --all --prune"
    git fetch --all --prune
    log "git reset --hard origin/$BRANCH"
    git reset --hard "origin/$BRANCH"
    log "HEAD is now: $(git log -1 --pretty=format:'%h %s (%an, %ar)')"
  else
    err "Not a git repository — skipping git pull."
  fi
else
  log "SKIP_GIT=1 → skipping git pull"
fi

# --- 2) npm install ---
if [[ "${SKIP_INSTALL:-0}" != "1" ]]; then
  if [[ -f package-lock.json ]]; then
    log "npm ci --omit=dev"
    npm ci --omit=dev
  else
    log "npm install --omit=dev"
    npm install --omit=dev
  fi
else
  log "SKIP_INSTALL=1 → skipping npm install"
fi

# --- 3) pm2 restart ---
if ! command -v pm2 >/dev/null 2>&1; then
  err "pm2 is not installed. Install with: npm i -g pm2"
  exit 1
fi

if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  log "pm2 restart $PM2_NAME --update-env"
  pm2 restart "$PM2_NAME" --update-env
else
  log "pm2 process '$PM2_NAME' not found — starting fresh from worker.js"
  pm2 start worker.js --name "$PM2_NAME" --time
fi

pm2 save >/dev/null 2>&1 || true

# --- 4) show a small log tail so you can confirm boot ---
log "---- pm2 status ----"
pm2 status "$PM2_NAME" || true
log "---- last 20 log lines ----"
pm2 logs "$PM2_NAME" --lines 20 --nostream || true

log "Done. ✅"
