#!/usr/bin/env bash
set -euo pipefail

# Self-cleanup: delete this script when the process exits (success or failure).
# Also sweep stale install-restart-*.sh leftovers from previous deploys that
# may have skipped cleanup (older than 1 day). Keeps /tmp from accumulating.
__SELF_PATH="${BASH_SOURCE[0]:-$0}"
cleanup_self() {
  rm -f "$__SELF_PATH" 2>/dev/null || true
  find /tmp -maxdepth 1 -type f -name 'install-restart-*.sh' -mtime +1 \
    -delete 2>/dev/null || true
}
trap cleanup_self EXIT
cd "$DEPLOY_PATH"
[ -f "$SERVER_ENTRY" ] || { echo "ERROR: SSR entry missing: $SERVER_ENTRY"; exit 1; }
[ -f deploy-version.json ] || { echo "ERROR: deploy-version.json missing"; exit 1; }
[ -f manifest.json ] || { echo "ERROR: manifest.json missing — bundle integrity unknown"; exit 1; }
[ -f SHA256SUMS ] || { echo "ERROR: SHA256SUMS missing — bundle integrity unknown"; exit 1; }

has_ssr_entry() {
  local candidate="$1"
  [ -f "$candidate/dist/server/index.js" ] || [ -f "$candidate/dist/server/index.mjs" ]
}

# ===== Integrity-failure rollback =====
# If the freshly rsynced bundle is corrupt/incomplete, the FILES on disk
# at $DEPLOY_PATH are already broken (PM2 still has the old in-memory
# code, but any restart now would crash). Restore LAST_GOOD onto disk
# BEFORE we even touch PM2, so the next restart serves a known-good build.
# Diagnostic: print which required files are present/missing inside a snapshot.
diagnose_snapshot() {
  local candidate="$1" label="$2"
  echo "  ↳ ${label} diagnostic for: ${candidate:-<empty>}" >&2
  if [ -z "$candidate" ] || [ ! -d "$candidate" ]; then
    echo "      ✗ directory missing" >&2
    return
  fi
  for f in dist/server/index.js dist/server/index.mjs scripts/tanstack-node-server.mjs ecosystem.config.cjs; do
    if [ -f "$candidate/$f" ]; then echo "      ✓ $f" >&2
    else echo "      ✗ $f (missing)" >&2; fi
  done
  if [ -d "$candidate/node_modules" ]; then echo "      ✓ node_modules/" >&2
  else echo "      ✗ node_modules/ (missing)" >&2; fi
}

# Strict check — used for LAST_GOOD and good-* (smoke-test verified
# snapshots which MUST be fully runnable as-is).
is_valid_ssr_snapshot() {
  local candidate="$1"
  [ -n "$candidate" ] \
    && [ -d "$candidate" ] \
    && has_ssr_entry "$candidate" \
    && [ -f "$candidate/scripts/tanstack-node-server.mjs" ] \
    && [ -f "$candidate/ecosystem.config.cjs" ] \
    && [ -d "$candidate/node_modules" ]
}

# Looser check — used for PREV_SNAPSHOT only. PREV_SNAPSHOT captures
# whatever was on disk before this deploy, which may pre-date some
# newer files (e.g. scripts/tanstack-node-server.mjs added in a
# later commit). We require the bare minimum needed for PM2 to
# restart the previous build: SSR entry + ecosystem + node_modules.
# scripts/tanstack-node-server.mjs is preferred but not required —
# the previous build may have used a different runner.
is_runnable_prev_snapshot() {
  local candidate="$1"
  [ -n "$candidate" ] \
    && [ -d "$candidate" ] \
    && has_ssr_entry "$candidate" \
    && [ -f "$candidate/ecosystem.config.cjs" ] \
    && [ -d "$candidate/node_modules" ]
}

# Build a verdict line for one snapshot candidate.
# Args: <marker-label> <path> <mode: strict|loose>
# Prints: "<verdict>  <marker>  <path>  [<reason>]"
verdict_snapshot() {
  local label="$1" path="$2" mode="$3"
  if [ -z "$path" ]; then
    echo "  ✗ REJECT  ${label}  <empty>   (marker file empty)" >&2
    return 1
  fi
  if [ ! -d "$path" ]; then
    echo "  ✗ REJECT  ${label}  ${path}   (directory missing)" >&2
    return 1
  fi
  local missing=""
  has_ssr_entry "$path"                          || missing="${missing}dist/server/index.js|index.mjs "
  [ -f "$path/ecosystem.config.cjs" ]             || missing="${missing}ecosystem.config.cjs "
  [ -d "$path/node_modules" ]                     || missing="${missing}node_modules/ "
  if [ "$mode" = "strict" ]; then
    [ -f "$path/scripts/tanstack-node-server.mjs" ] || missing="${missing}scripts/tanstack-node-server.mjs "
  fi
  if [ -n "$missing" ]; then
    echo "  ✗ REJECT  ${label}  ${path}   (missing: ${missing% })" >&2
    return 1
  fi
  echo "  ✓ ACCEPT  ${label}  ${path}   (${mode} check passed)" >&2
  return 0
}

choose_integrity_snapshot() {
  # Echoes "<kind>|<path>" on success; non-zero on failure.
  # Always prints a full inventory of every snapshot it inspected,
  # with an accept/reject verdict + reason for each.
  local candidate first_pick="" first_kind=""
  echo "" >&2
  echo "=== Snapshot inventory (BACKUPS_DIR=$BACKUPS_DIR) ===" >&2

  # 1) LAST_GOOD — strict.
  if [ -f "$BACKUPS_DIR/LAST_GOOD" ]; then
    candidate=$(cat "$BACKUPS_DIR/LAST_GOOD" 2>/dev/null || true)
    if verdict_snapshot "LAST_GOOD     " "$candidate" "strict"; then
      [ -z "$first_pick" ] && { first_pick="$candidate"; first_kind="last_good"; }
    fi
  else
    echo "  • SKIP    LAST_GOOD       (marker file does not exist)" >&2
  fi

  # 2) PREV_SNAPSHOT — loose.
  if [ -f "$BACKUPS_DIR/PREV_SNAPSHOT" ]; then
    candidate=$(cat "$BACKUPS_DIR/PREV_SNAPSHOT" 2>/dev/null || true)
    if verdict_snapshot "PREV_SNAPSHOT " "$candidate" "loose"; then
      [ -z "$first_pick" ] && { first_pick="$candidate"; first_kind="prev_snapshot"; }
    fi
  else
    echo "  • SKIP    PREV_SNAPSHOT   (marker file does not exist)" >&2
  fi

  # 3) good-* — strict, newest first. We intentionally do NOT scan
  #    generic [0-9]* snapshots — those are raw pre-deploy captures
  #    from possibly-broken earlier deploys.
  local good_count=0
  while IFS= read -r candidate; do
    [ -z "$candidate" ] && continue
    good_count=$((good_count + 1))
    local label
    label=$(printf "good-#%-2d     " "$good_count")
    if verdict_snapshot "$label" "$candidate" "strict"; then
      [ -z "$first_pick" ] && { first_pick="$candidate"; first_kind="latest_good"; }
    fi
  done < <(ls -1dt "$BACKUPS_DIR"/good-* 2>/dev/null || true)
  if [ "$good_count" -eq 0 ]; then
    echo "  • SKIP    good-*          (no smoke-verified snapshots exist yet)" >&2
  fi

  echo "=== End snapshot inventory ===" >&2
  echo "" >&2

  if [ -n "$first_pick" ]; then
    echo "→ Selected: kind=${first_kind}  path=${first_pick}" >&2
    echo "${first_kind}|${first_pick}"
    return 0
  fi
  return 1
}

integrity_rollback() {
  local reason="$1"
  echo ""
  echo "=== Triggering integrity rollback (reason: ${reason}) ==="
  if [ -z "${BACKUPS_DIR:-}" ] || [ ! -d "${BACKUPS_DIR:-}" ]; then
    echo "::error::BACKUPS_DIR unavailable (${BACKUPS_DIR:-<unset>}) — cannot auto-restore."
    echo "INTEGRITY_ROLLBACK_RESULT=no_backups_dir"
    return 1
  fi
  local picked kind src
  picked=$(choose_integrity_snapshot || true)
  if [ -z "$picked" ]; then
    echo "::error::No trusted SSR snapshot available in $BACKUPS_DIR — cannot auto-restore."
    echo "  (trusted sources: LAST_GOOD, PREV_SNAPSHOT, good-* — untrusted [0-9]* snapshots are ignored)"
    echo "INTEGRITY_ROLLBACK_RESULT=no_valid_snapshot"
    return 1
  fi
  kind="${picked%%|*}"
  src="${picked#*|}"
  case "$kind" in
    last_good)
      echo "→ Restoring from LAST_GOOD (smoke-test verified): $src" ;;
    prev_snapshot)
      echo "→ LAST_GOOD missing/invalid — restoring from PREV_SNAPSHOT (the build that was running before this deploy)"
      echo "  source: $src" ;;
    latest_good)
      echo "→ LAST_GOOD/PREV_SNAPSHOT unusable — restoring from most recent smoke-verified good-* snapshot: $src" ;;
  esac
  if [ "${INTEGRITY_ROLLBACK_DRY_RUN:-0}" = "1" ]; then
    echo "🧪 DRY-RUN — skipping rsync. Would have restored:"
    echo "   source : $src"
    echo "   target : $DEPLOY_PATH"
    echo "   excludes: .env .user.ini .htaccess var/ .well-known/"
    echo "INTEGRITY_ROLLBACK_RESULT=dry_run"
    echo "INTEGRITY_ROLLBACK_KIND=$kind"
    echo "INTEGRITY_ROLLBACK_SRC=$src"
    return 0
  fi
  rsync -a --delete \
    --exclude='.env' \
    --exclude='.user.ini' \
    --exclude='.htaccess' \
    --exclude='var/' \
    --exclude='.well-known/' \
    "$src/" "$DEPLOY_PATH/"
  echo "✓ Snapshot restored to disk."

  # Reload PM2 onto the restored bundle so on-disk files and the running
  # process match. Without this, PM2 keeps serving the prior in-memory
  # build while the disk has a different (older) one — any future restart
  # or crash would suddenly switch versions unexpectedly. Best-effort:
  # if PM2 isn't available or reload fails, we still report restored.
  if command -v pm2 >/dev/null 2>&1 && [ -n "${APP_NAME:-}" ]; then
    echo "→ Reloading PM2 on restored bundle so process matches disk…"
    if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
      pm2 reload ecosystem.config.cjs --only "$APP_NAME" --update-env 2>/dev/null \
        || pm2 restart "$APP_NAME" --update-env 2>/dev/null \
        || echo "  (warning) PM2 reload failed — previous in-memory process still serving."
    else
      pm2 start ecosystem.config.cjs --only "$APP_NAME" --update-env 2>/dev/null \
        || echo "  (warning) PM2 start failed — no process currently serving."
    fi
    pm2 save >/dev/null 2>&1 || true
    echo "✓ PM2 reloaded onto restored snapshot."
  else
    echo "  (info) PM2 or APP_NAME unavailable — process not reloaded."
  fi

  echo "INTEGRITY_ROLLBACK_RESULT=restored"
  echo "INTEGRITY_ROLLBACK_KIND=$kind"
  echo "INTEGRITY_ROLLBACK_SRC=$src"
  return 0
}

# Dry-run hook: force integrity_rollback to run without breaking the
# bundle. Triggers immediately after the function is defined and
# exits the install step before PM2 is touched.
if [ "${INTEGRITY_ROLLBACK_DRY_RUN:-0}" = "1" ]; then
  echo ""
  echo "🧪 INTEGRITY_ROLLBACK_DRY_RUN=1 — forcing integrity_rollback path"
  integrity_rollback "dry-run-forced" || true
  echo "🧪 Dry-run finished. Exiting install step before PM2 is touched."
  exit 1
fi

echo "=== Verifying bundle against manifest ==="
# Three independent counts must agree before we touch PM2:
#   1. manifest.json .total_files   (what CI declared it shipped)
#   2. SHA256SUMS line count        (what CI actually checksummed)
#   3. find on the VPS              (what arrived after rsync)
MANIFEST_TOTAL=$(sed -n 's/.*"total_files":[[:space:]]*\([0-9][0-9]*\).*/\1/p' manifest.json | head -n 1)
MANIFEST_TOTAL=${MANIFEST_TOTAL:-0}
MANIFEST_PATHS=$(grep -c '"path"' manifest.json || echo 0)
SUMS_FILES=$(wc -l < SHA256SUMS)
echo "  manifest.total_files = ${MANIFEST_TOTAL}"
echo "  manifest path entries = ${MANIFEST_PATHS}"
echo "  SHA256SUMS lines     = ${SUMS_FILES}"

if [ "$MANIFEST_TOTAL" != "$SUMS_FILES" ] || [ "$MANIFEST_PATHS" != "$SUMS_FILES" ]; then
  echo "ERROR: manifest is internally inconsistent — refusing to restart PM2"
  integrity_rollback "manifest-inconsistent" || true
  exit 1
fi

if ! sha256sum --quiet -c SHA256SUMS; then
  echo "ERROR: checksum verification failed — bundle is corrupted or incomplete"
  echo "PM2 restart BLOCKED — current process kept alive on the previous build"
  integrity_rollback "checksum-failed" || true
  exit 1
fi

# === CI vs VPS file-list diff ===
# CI's authoritative list is the sorted left column of SHA256SUMS.
# We build the VPS list the same way and diff them.
# Any non-zero diff fails the deployment — rsync --delete must produce
# a byte-exact tree, so a single missing or extra file is a real problem.
EXPECTED_LIST=$(mktemp)
ACTUAL_LIST=$(mktemp)
# Strip exactly 64 hex chars + 2 spaces (sha256sum's format) to preserve
# the "./path" prefix verbatim. The old `awk '{$1=""; sub(/^  /,"")}'`
# produced " ./path" (one leading space) because awk rebuilds with
# single-space OFS, causing 100% disjoint diff vs find's `./%P` output.
sed 's/^[0-9a-f]\{64\}  //' SHA256SUMS | LC_ALL=C sort > "$EXPECTED_LIST"
# Match the shipped bundle while intentionally ignoring server-local
# files that rsync preserves via --exclude (env/secrets, panel files,
# ACME challenges, logs, and app runtime state under var/). Those files
# are expected to exist only on the VPS and must not be treated as bundle drift.
find . -type f \
  ! -name 'manifest.json' \
  ! -name 'SHA256SUMS' \
  ! -name '.env' \
  ! -name '.user.ini' \
  ! -name '.htaccess' \
  ! -name '*.log' \
  ! -path './var/*' \
  ! -path './.well-known/*' \
  -printf './%P\n' \
  | LC_ALL=C sort > "$ACTUAL_LIST"

EXPECTED_COUNT=$(wc -l < "$EXPECTED_LIST")
ACTUAL_COUNT=$(wc -l < "$ACTUAL_LIST")
MISSING=$(comm -23 "$EXPECTED_LIST" "$ACTUAL_LIST")   # in CI, not on VPS
EXTRA=$(comm -13 "$EXPECTED_LIST" "$ACTUAL_LIST")     # on VPS, not in CI
MISSING_COUNT=$([ -z "$MISSING" ] && echo 0 || echo "$MISSING" | wc -l)
EXTRA_COUNT=$([ -z "$EXTRA" ] && echo 0 || echo "$EXTRA" | wc -l)

echo "=== CI ↔ VPS file-list diff ==="
echo "  manifest expects: ${MANIFEST_TOTAL} files"
echo "  CI shipped      : ${EXPECTED_COUNT} files"
echo "  VPS now has     : ${ACTUAL_COUNT} files"
echo "  Missing on VPS (in CI but not on VPS): ${MISSING_COUNT}"
echo "  Extra on VPS (on VPS but not in CI):   ${EXTRA_COUNT}"

# Diagnostics use `awk 'NR<=30'` instead of `head -n 30` to avoid
# SIGPIPE (exit 141) under `set -euo pipefail` — awk reads stdin to
# EOF so the upstream `printf`/`grep` never gets EPIPE.
set +o pipefail
if [ "$MISSING_COUNT" -gt 0 ]; then
  echo "--- Missing files (first 30, all paths) ---"
  printf '%s\n' "$MISSING" | awk 'NR<=30'
  MISSING_NM=$(printf '%s\n' "$MISSING" | grep -c '^\./node_modules/' 2>/dev/null || echo 0)
  MISSING_APP=$(printf '%s\n' "$MISSING" | grep -vc '^\./node_modules/' 2>/dev/null || echo 0)
  MISSING_NM=${MISSING_NM:-0}
  MISSING_APP=${MISSING_APP:-0}
  echo "  missing inside node_modules: ${MISSING_NM}"
  echo "  missing outside node_modules: ${MISSING_APP}"
  if [ "${MISSING_APP}" -gt 0 ]; then
    echo "--- Missing app files (first 30, excluding node_modules) ---"
    printf '%s\n' "$MISSING" | grep -v '^\./node_modules/' | awk 'NR<=30'
  fi
fi
if [ "$EXTRA_COUNT" -gt 0 ]; then
  echo "--- Extra files (first 30, all paths) ---"
  printf '%s\n' "$EXTRA" | awk 'NR<=30'
  EXTRA_NM=$(printf '%s\n' "$EXTRA" | grep -c '^\./node_modules/' 2>/dev/null || echo 0)
  EXTRA_APP=$(printf '%s\n' "$EXTRA" | grep -vc '^\./node_modules/' 2>/dev/null || echo 0)
  EXTRA_NM=${EXTRA_NM:-0}
  EXTRA_APP=${EXTRA_APP:-0}
  echo "  extra inside node_modules: ${EXTRA_NM}"
  echo "  extra outside node_modules: ${EXTRA_APP}"
  if [ "${EXTRA_APP}" -gt 0 ]; then
    echo "--- Extra app files (first 30, excluding node_modules) ---"
    printf '%s\n' "$EXTRA" | grep -v '^\./node_modules/' | awk 'NR<=30'
  fi
  echo "Hint: 'extra' files usually mean rsync --delete couldn't remove them (permissions) or a stale prior deploy left leftovers."
fi
set -o pipefail

# Hard gate: VPS file count MUST equal manifest count exactly after
# ignoring the same server-local files rsync intentionally preserves.
# Any remaining mismatch means transfer truncation, permissions
# blocking deletes, or stale leftovers from a previous broken deploy.
# We will NOT restart PM2 in that state — the old process keeps running.
DRIFT=$((MISSING_COUNT + EXTRA_COUNT))
if [ "$ACTUAL_COUNT" != "$MANIFEST_TOTAL" ] || [ "$DRIFT" -gt 0 ]; then
  echo "ERROR: VPS file count (${ACTUAL_COUNT}) != manifest (${MANIFEST_TOTAL})"
  echo "ERROR: ${DRIFT} differing path(s) between CI bundle and VPS"
  echo "PM2 restart BLOCKED — current process kept alive on the previous build"
  rm -f "$EXPECTED_LIST" "$ACTUAL_LIST"
  integrity_rollback "file-list-drift" || true
  exit 1
fi
rm -f "$EXPECTED_LIST" "$ACTUAL_LIST"
echo "✓ VPS file count matches manifest exactly: ${ACTUAL_COUNT} files"
echo "✓ Every shipped file passed SHA-256 verification"
echo "→ Proceeding to PM2 restart"

# node_modules is shipped from CI — server runs zero installs.
[ -d node_modules ] || { echo "ERROR: node_modules missing on server (CI ship failed)"; exit 1; }
command -v pm2 >/dev/null 2>&1 || { echo "ERROR: pm2 is not installed on the server"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "ERROR: node is not installed on the server"; exit 1; }
[ -f scripts/tanstack-node-server.mjs ] || { echo "ERROR: Node SSR runner missing: scripts/tanstack-node-server.mjs"; exit 1; }
[ -f ecosystem.config.cjs ] || { echo "ERROR: PM2 ecosystem missing: ecosystem.config.cjs"; exit 1; }
echo "Node version on server: $(node --version)"

# Helper: check if port is bound. Returns 0 if bound, 1 if free.
port_is_bound() {
  local p="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :${p}" 2>/dev/null | grep -q ":${p}" && return 0
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"${p}" -sTCP:LISTEN -t >/dev/null 2>&1 && return 0
  fi
  if command -v netstat >/dev/null 2>&1; then
    netstat -ltn 2>/dev/null | grep -q ":${p} " && return 0
  fi
  return 1
}

print_port_diagnostics() {
  echo "=== Port ${APP_PORT} diagnostics ==="
  (command -v ss >/dev/null 2>&1 && ss -ltnp "sport = :${APP_PORT}") || true
  (command -v lsof >/dev/null 2>&1 && lsof -iTCP:"${APP_PORT}" -sTCP:LISTEN) || true
  pm2 list || true
}

port_pids() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"${APP_PORT}" -sTCP:LISTEN 2>/dev/null || true
    return 0
  fi
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp "sport = :${APP_PORT}" 2>/dev/null | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' || true
    return 0
  fi
}

wait_for_port_free() {
  local p="$1"
  for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    if ! port_is_bound "$p"; then
      return 0
    fi
    echo "Waiting for port ${p} to be released (attempt $attempt)…"
    sleep 1
  done
  return 1
}

# Clean up legacy fork-mode apps under different names. Do NOT touch the
# current $APP_NAME — we want to RELOAD it gracefully, not delete it.
for pm2_app in flowtix flowtixtools flowtixtools-ssr flowtixtools-srvx; do
  if [ "$pm2_app" != "$APP_NAME" ] && pm2 describe "$pm2_app" >/dev/null 2>&1; then
    echo "Removing stale legacy PM2 app: $pm2_app"
    pm2 delete "$pm2_app" || true
  fi
done

# Load secrets from .env into env vars PM2 will inherit on (re)start/reload.
if [ -f .env ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ""|\#*) continue ;; esac
    key="${line%%=*}"
    value="${line#*=}"
    case "$key" in
      SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY|SUPABASE_SERVICE_ROLE_KEY|VITE_SUPABASE_URL|VITE_SUPABASE_PUBLISHABLE_KEY|BOT_ENCRYPTION_KEY|BOT_WORKER_SECRET|FLOWTIX_ALERT_WEBHOOK_URL|ALERT_WEBHOOK_URL|SSR_ALERT_WEBHOOK_URL|ALERT_THROTTLE_MS)
        value="${value%\"}"; value="${value#\"}"
        value="${value%\'}"; value="${value#\'}"
        export "$key=$value"
        ;;
    esac
  done < .env
fi
export SUPABASE_URL="${SUPABASE_URL:-${VITE_SUPABASE_URL:-}}"
export SUPABASE_PUBLISHABLE_KEY="${SUPABASE_PUBLISHABLE_KEY:-${VITE_SUPABASE_PUBLISHABLE_KEY:-}}"
export APP_NAME APP_PORT DEPLOY_PATH
export NODE_ENV=production
export DEPLOY_SHA DEPLOY_RUN_ID DEPLOY_REPOSITORY DEPLOYED_AT

# === Zero-downtime release ===
# If the app already runs under PM2 with cluster mode → graceful `reload`.
# Workers restart one at a time; the other keeps serving on the same port,
# so existing clients see no 502s, no dropped connections.
# Otherwise (first deploy, or it died) → fresh `start`.
APP_IS_RUNNING=0
APP_IS_CLUSTER=0
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  APP_IS_RUNNING=1
  if pm2 jlist 2>/dev/null | grep -A2 "\"name\":\"${APP_NAME}\"" | grep -q '"exec_mode":"cluster_mode"'; then
    APP_IS_CLUSTER=1
  fi
fi

if [ "$APP_IS_RUNNING" = "1" ] && [ "$APP_IS_CLUSTER" = "1" ]; then
  echo "→ Graceful reload (cluster mode, no downtime)…"
  pm2 reload ecosystem.config.cjs --only "$APP_NAME" --update-env
else
  if [ "$APP_IS_RUNNING" = "1" ]; then
    echo "→ App running in fork mode — one-time migration to cluster (brief restart)."
    pm2 delete "$APP_NAME" || true
    wait_for_port_free "${APP_PORT}" || {
      echo "ERROR: Port ${APP_PORT} still bound after delete."; print_port_diagnostics; exit 1;
    }
  fi
  echo "→ Fresh start in cluster mode…"
  pm2 start ecosystem.config.cjs --only "$APP_NAME" --update-env
fi
pm2 save

# Confirm the Node SSR app bound the port after reload/start.
BOUND=0
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  sleep 1
  if port_is_bound "${APP_PORT}"; then
    BOUND=1; break
  fi
  echo "Waiting for port ${APP_PORT} (attempt $attempt)…"
done
if [ "$BOUND" -ne 1 ]; then
  echo "ERROR: Node SSR app did not bind to port ${APP_PORT}."
  print_port_diagnostics
  pm2 describe "$APP_NAME" || true
  pm2 logs "$APP_NAME" --lines 120 --nostream || true
  integrity_rollback "port-not-bound" || true
  exit 1
fi
echo "✓ App is listening on ${APP_PORT}."

# === Health gate ===
# The NEW workers are now serving. Probe local health before declaring success.
# If health fails repeatedly, restore LAST_GOOD onto disk and reload again so
# clients return to a known-good build instead of being stuck on a broken one.
echo "→ Local health gate (http://127.0.0.1:${APP_PORT}/api/public/health)…"
HEALTH_OK=0
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  CODE=$(curl -fsS -o /tmp/health.out -w '%{http_code}' --max-time 5 \
    "http://127.0.0.1:${APP_PORT}/api/public/health" || echo "000")
  if [ "$CODE" = "200" ]; then HEALTH_OK=1; break; fi
  echo "  health attempt $attempt → HTTP $CODE"
  sleep 2
done

if [ "$HEALTH_OK" -ne 1 ]; then
  echo "ERROR: Health endpoint did not return 200 after reload."
  cat /tmp/health.out 2>/dev/null || true
  pm2 logs "$APP_NAME" --lines 120 --nostream || true
  echo "→ Auto-rollback: restoring LAST_GOOD and reloading…"
  if integrity_rollback "post-reload-health-failed"; then
    pm2 reload ecosystem.config.cjs --only "$APP_NAME" --update-env || \
      pm2 start ecosystem.config.cjs --only "$APP_NAME" --update-env
    pm2 save
  fi
  exit 1
fi
echo "✓ Health gate passed — new build is live for all clients."
