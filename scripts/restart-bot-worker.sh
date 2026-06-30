#!/usr/bin/env bash
# Restart flowtix-bot-worker from its real PM2 cwd — no hardcoded paths.
#
# Usage:
#   ./scripts/restart-bot-worker.sh              # git pull + npm install + restart
#   ./scripts/restart-bot-worker.sh --no-pull    # skip git pull
#   ./scripts/restart-bot-worker.sh --no-install # skip npm install
#   PROC=other-name ./scripts/restart-bot-worker.sh
set -euo pipefail

PROC="${PROC:-flowtix-bot-worker}"
DO_PULL=1
DO_INSTALL=1
for arg in "$@"; do
  case "$arg" in
    --no-pull)    DO_PULL=0 ;;
    --no-install) DO_INSTALL=0 ;;
    -h|--help)
      sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "Unknown arg: $arg" >&2; exit 1 ;;
  esac
done

command -v pm2 >/dev/null || { echo "pm2 not found in PATH" >&2; exit 1; }

if ! pm2 jlist | grep -q "\"name\":\"$PROC\""; then
  echo "PM2 process '$PROC' not found. Available:" >&2
  pm2 ls
  exit 1
fi

# Pull cwd straight from PM2 (jq if available, else node, else python).
CWD="$(
  pm2 jlist | (
    if command -v jq >/dev/null; then
      jq -r --arg n "$PROC" '.[] | select(.name==$n) | .pm2_env.pm_cwd'
    elif command -v node >/dev/null; then
      node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s).find(x=>x.name===process.argv[1]);process.stdout.write(p&&p.pm2_env&&p.pm2_env.pm_cwd||'')})" "$PROC"
    else
      python3 -c "import sys,json;d=json.load(sys.stdin);p=[x for x in d if x['name']=='$PROC'];print(p[0]['pm2_env']['pm_cwd'] if p else '')"
    fi
  )
)"

if [ -z "$CWD" ] || [ ! -d "$CWD" ]; then
  echo "Could not resolve cwd for '$PROC' (got: '$CWD')" >&2
  exit 1
fi

echo "==> cwd: $CWD"
cd "$CWD"

# Repo root may be a parent of the worker dir — walk up to find .git.
REPO="$CWD"
while [ "$REPO" != "/" ] && [ ! -d "$REPO/.git" ]; do REPO="$(dirname "$REPO")"; done

if [ "$DO_PULL" = 1 ] && [ -d "$REPO/.git" ]; then
  echo "==> git pull ($REPO)"
  git -C "$REPO" pull --ff-only
fi

if [ "$DO_INSTALL" = 1 ] && [ -f "$CWD/package.json" ]; then
  echo "==> npm install"
  npm install --omit=dev --no-audit --no-fund
fi

echo "==> pm2 restart $PROC"
pm2 restart "$PROC" --update-env
pm2 save >/dev/null 2>&1 || true
echo "==> done"
