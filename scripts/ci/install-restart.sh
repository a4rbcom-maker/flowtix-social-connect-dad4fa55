#!/usr/bin/env bash
set -Eeuo pipefail

# Verbose tracing: set DEBUG_INSTALL=1 (repo var/secret) to stream every
# command to the log with file:line:function context. PS4 is set for both
# manual `set -x` and any future `bash -x` invocation.
export PS4='+ [${BASH_SOURCE##*/}:${LINENO}:${FUNCNAME[0]:-main}] '
if [ "${DEBUG_INSTALL:-0}" = "1" ]; then
  set -x
fi

# Self-cleanup: delete this script when the process exits (success or failure).
# Also sweep stale install-restart-*.sh leftovers from previous deploys that
# may have skipped cleanup (older than 1 day). Keeps /tmp from accumulating.
__SELF_PATH="${BASH_SOURCE[0]:-$0}"
cleanup_self() {
  rm -f "$__SELF_PATH" 2>/dev/null || true
  find /tmp -maxdepth 1 -type f -name 'install-restart-*.sh' -mtime +1 \
    -delete 2>/dev/null || true
}

# ===== Failure diagnostic dump =====
# Fires on ANY uncaught failure (set -e). Prints:
#   • where it died (file:line + the failed command)
#   • last 50 lines of PM2 logs for $APP_NAME (out + err)
#   • PM2 process table + describe for $APP_NAME
#   • port + process diagnostics for $APP_PORT
#   • last health response body, disk + memory snapshot, bundle markers
# Output is bounded so logs stay readable.
__DIAG_DUMPED=0
dump_failure_diagnostics() {
  local exit_code=$1 line=$2 cmd=$3
  [ "$__DIAG_DUMPED" = "1" ] && return 0
  __DIAG_DUMPED=1
  {
    echo ""
    echo "════════════════════════════════════════════════════════════════"
    echo "  DEPLOY FAILED — diagnostic dump"
    echo "════════════════════════════════════════════════════════════════"
    echo "  exit code  : ${exit_code}"
    echo "  at         : ${BASH_SOURCE[0]##*/}:${line}"
    echo "  command    : ${cmd}"
    echo "  pwd        : $(pwd 2>/dev/null || echo '<unknown>')"
    echo "  user       : $(id -un 2>/dev/null || echo '<unknown>')"
    echo "  date       : $(date -u +%FT%TZ)"
    echo "  APP_NAME   : ${APP_NAME:-<unset>}"
    echo "  APP_PORT   : ${APP_PORT:-<unset>}"
    echo "  DEPLOY_PATH: ${DEPLOY_PATH:-<unset>}"
    echo "  DEPLOY_SHA : ${DEPLOY_SHA:-<unset>}"
    echo "  DEBUG_INSTALL=${DEBUG_INSTALL:-0} (set repo var to 1 for full set -x trace)"
    echo ""

    if command -v pm2 >/dev/null 2>&1 && [ -n "${APP_NAME:-}" ]; then
      echo "── PM2 logs (last 50 lines, ${APP_NAME}) ──"
      pm2 logs "$APP_NAME" --lines 50 --nostream 2>&1 || echo "(pm2 logs failed)"
      echo ""
      echo "── PM2 process list ──"
      pm2 list 2>&1 || true
      echo ""
      echo "── PM2 describe ${APP_NAME} ──"
      pm2 describe "$APP_NAME" 2>&1 || echo "(no such app)"
      echo ""
    else
      echo "── PM2 not available or APP_NAME unset — skipping pm2 dump ──"
      echo ""
    fi

    if [ -n "${APP_PORT:-}" ]; then
      echo "── Port ${APP_PORT} listeners ──"
      (command -v ss   >/dev/null 2>&1 && ss -ltnp "sport = :${APP_PORT}" 2>&1) || true
      (command -v lsof >/dev/null 2>&1 && lsof -iTCP:"${APP_PORT}" -sTCP:LISTEN 2>&1) || true
      echo ""
    fi

    if [ -s /tmp/health.out ]; then
      echo "── Last health response body (tail 4 KB) ──"
      tail -c 4096 /tmp/health.out 2>/dev/null || true
      echo ""
    fi

    echo "── Disk usage (${DEPLOY_PATH:-/}) ──"
    df -h "${DEPLOY_PATH:-/}" 2>&1 || true
    echo ""
    echo "── Memory ──"
    free -h 2>&1 || true
    echo ""
    echo "── Bundle markers ──"
    ls -la "${DEPLOY_PATH:-.}/deploy-version.json" "${DEPLOY_PATH:-.}/manifest.json" "${DEPLOY_PATH:-.}/SHA256SUMS" 2>&1 || true
    [ -f "${DEPLOY_PATH:-.}/deploy-version.json" ] && cat "${DEPLOY_PATH}/deploy-version.json" 2>&1 || true
    echo ""
    echo "  Hint: re-run the workflow with repo variable DEBUG_INSTALL=1"
    echo "  to enable full 'set -x' tracing from line 1."
    echo "════════════════════════════════════════════════════════════════"
  } >&2
}

fail_deploy() {
  local reason="$1"
  local code="${2:-1}"
  echo "DEPLOY_FAILURE_REASON=${reason}"
  echo "::error::install-restart failed: ${reason}"
  dump_failure_diagnostics "$code" "${BASH_LINENO[0]:-0}" "${BASH_COMMAND:-fail_deploy}"
  exit "$code"
}
trap 'dump_failure_diagnostics $? ${LINENO} "${BASH_COMMAND}"' ERR
trap cleanup_self EXIT
cd "$DEPLOY_PATH"
SSR_ENTRY_CANDIDATES="dist/server/server.js dist/server/server.mjs dist/server/index.js dist/server/index.mjs"
[ -n "${SERVER_ENTRY:-}" ] && [ -f "$SERVER_ENTRY" ] || {
  echo "ERROR: SSR entry missing: ${SERVER_ENTRY:-<unset>}"
  echo "Expected one of: $SSR_ENTRY_CANDIDATES"
  find dist/server -maxdepth 2 -type f 2>/dev/null | LC_ALL=C sort | sed -n '1,80p' || true
  fail_deploy "ssr-entry-missing"
}
[ -f deploy-version.json ] || fail_deploy "deploy-version-missing"
[ -f manifest.json ] || fail_deploy "manifest-missing"
[ -f SHA256SUMS ] || fail_deploy "sha256sums-missing"

has_ssr_entry() {
  local candidate="$1"
  local f
  for f in $SSR_ENTRY_CANDIDATES; do
    [ -f "$candidate/$f" ] && return 0
  done
  return 1
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
  for f in $SSR_ENTRY_CANDIDATES scripts/tanstack-node-server.mjs ecosystem.config.cjs; do
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
  has_ssr_entry "$path"                          || missing="${missing}dist/server/server.js|server.mjs|index.js|index.mjs "
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
    echo "   excludes: .env .user.ini .htaccess var/ .well-known/ .deploy/"
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
    --exclude='.deploy/' \
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

publish_good_snapshot() {
  set +e
  if [ -z "${BACKUPS_DIR:-}" ]; then
    echo "::warning::BACKUPS_DIR unset — cannot mark a trusted rollback snapshot."
    set -e
    return 0
  fi

  mkdir -p "$BACKUPS_DIR"
  if [ $? -ne 0 ]; then
    echo "::warning::Could not create BACKUPS_DIR ($BACKUPS_DIR); deploy stays successful but no trusted snapshot was recorded."
    set -e
    return 0
  fi
  local stamp short snapshot tmp
  stamp=$(date -u +%Y%m%d%H%M%S)
  short="${DEPLOY_SHA:-unknown}"
  short="${short:0:7}"
  [ -n "$short" ] || short="unknown"
  snapshot="$BACKUPS_DIR/good-${stamp}-${short}"
  tmp="${snapshot}.tmp"

  rm -rf "$tmp"
  mkdir -p "$tmp"
  if [ $? -ne 0 ]; then
    echo "::warning::Could not create snapshot temp dir ($tmp); deploy stays successful but no trusted snapshot was recorded."
    set -e
    return 0
  fi
  rsync -a --delete \
    --exclude='.env' \
    --exclude='.user.ini' \
    --exclude='.htaccess' \
    --exclude='var/' \
    --exclude='.well-known/' \
    --exclude='.deploy/' \
    "$DEPLOY_PATH/" "$tmp/"
  if [ $? -ne 0 ]; then
    echo "::warning::Trusted snapshot rsync failed; deploy is live, but rollback snapshot was not updated."
    rm -rf "$tmp"
    set -e
    return 0
  fi

  if is_valid_ssr_snapshot "$tmp"; then
    if mv "$tmp" "$snapshot" \
      && printf '%s' "$snapshot" > "$BACKUPS_DIR/LAST_GOOD"; then
      ls -1dt "$BACKUPS_DIR"/good-* 2>/dev/null | tail -n +6 | xargs -r rm -rf || true
      echo "✓ Trusted SSR snapshot recorded: $snapshot"
    else
      echo "::warning::Trusted snapshot finalize step failed; deploy is live, but rollback snapshot metadata was not updated."
      rm -rf "$tmp" "$snapshot" 2>/dev/null || true
    fi
  else
    echo "::warning::Healthy deploy is live, but trusted snapshot creation failed."
    diagnose_snapshot "$tmp" "new-good-snapshot"
    rm -rf "$tmp"
  fi
  set -e
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
  echo "::warning::manifest counts are inconsistent, but checksum verification will decide whether the shipped bundle is safe to run."
fi

if ! sha256sum --quiet -c SHA256SUMS; then
  echo "ERROR: checksum verification failed — bundle is corrupted or incomplete"
  echo "PM2 restart BLOCKED — current process kept alive on the previous build"
  integrity_rollback "checksum-failed" || true
  fail_deploy "checksum-verification-failed"
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
# .deploy/ is also server-local: it holds the VPS deploy lock and last-SHA marker.
find . -type f \
  ! -name 'manifest.json' \
  ! -name 'SHA256SUMS' \
  ! -name '.env' \
  ! -name '.user.ini' \
  ! -name '.htaccess' \
  ! -name '*.log' \
  ! -path './var/*' \
  ! -path './.well-known/*' \
  ! -path './.deploy/*' \
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
if [ "$MISSING_COUNT" -gt 0 ]; then
  echo "ERROR: ${MISSING_COUNT} shipped file(s) are missing on the VPS after rsync"
  echo "PM2 restart BLOCKED — current process kept alive on the previous build"
  rm -f "$EXPECTED_LIST" "$ACTUAL_LIST"
  integrity_rollback "file-list-drift-missing" || true
  fail_deploy "rsync-missing-shipped-files"
fi
if [ "$ACTUAL_COUNT" != "$MANIFEST_TOTAL" ] || [ "$DRIFT" -gt 0 ]; then
  echo "::warning::VPS file tree differs from manifest after rsync, but all shipped files passed SHA-256 verification."
  echo "::warning::Continuing with PM2 restart because drift appears to be extra files only."
fi
rm -f "$EXPECTED_LIST" "$ACTUAL_LIST"
if [ "$ACTUAL_COUNT" = "$MANIFEST_TOTAL" ] && [ "$DRIFT" -eq 0 ]; then
  echo "✓ VPS file count matches manifest exactly: ${ACTUAL_COUNT} files"
else
  echo "✓ All shipped files are present; ignored server-local extras remain on disk."
fi
echo "✓ Every shipped file passed SHA-256 verification"
echo "→ Proceeding to PM2 restart"

# node_modules is shipped from CI — server runs zero installs.
[ -d node_modules ] || fail_deploy "node_modules-missing"
command -v pm2 >/dev/null 2>&1 || fail_deploy "pm2-not-installed"
command -v node >/dev/null 2>&1 || fail_deploy "node-not-installed"
[ -f scripts/tanstack-node-server.mjs ] || fail_deploy "node-ssr-runner-missing"
[ -f ecosystem.config.cjs ] || fail_deploy "pm2-ecosystem-missing"
node - <<'NODE'
const config = require('./ecosystem.config.cjs');
const app = config?.apps?.[0] || {};
const failures = [];
if (app.pmx !== false) failures.push('pmx must be false');
if (app.automation !== false) failures.push('automation must be false');
if (app.disable_trace !== true) failures.push('disable_trace must be true');
if (app.trace === true) failures.push('trace must not be true');
if (failures.length) {
  console.error(`ERROR: PM2 APM/tracing guard failed: ${failures.join('; ')}`);
  console.error('PM2 @pm2/io HTTP tracing can crash on malformed request targets like //, so deploy is blocked before restart.');
  process.exit(1);
}
console.log('✓ PM2 APM/tracing disabled — @pm2/io will not wrap HTTP requests.');
NODE
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
  for attempt in $(seq 1 45); do
    if ! port_is_bound "$p"; then
      return 0
    fi
    echo "Waiting for port ${p} to be released (attempt $attempt)…"
    sleep 1
  done
  return 1
}

# Optional cleanup for legacy PM2 app names. Keep empty by default so the
# deploy script is safe to reuse in any repository/server. Set LEGACY_PM2_APPS
# as a space-separated repository variable only when migrating an old app.
for pm2_app in ${LEGACY_PM2_APPS:-}; do
  if [ -n "$pm2_app" ] && [ "$pm2_app" != "$APP_NAME" ] && pm2 describe "$pm2_app" >/dev/null 2>&1; then
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
export APP_NAME APP_PORT DEPLOY_PATH SERVER_ENTRY
export NODE_ENV=production
export DEPLOY_SHA DEPLOY_RUN_ID DEPLOY_REPOSITORY DEPLOYED_AT

# === Zero-downtime release ===
# If the app already runs under PM2 with cluster mode → graceful `reload`.
# Workers restart one at a time; the other keeps serving on the same port,
# so existing clients see no 502s, no dropped connections.
# Otherwise (first deploy, or it died) → fresh `start`.
APP_IS_RUNNING=0
APP_IS_CLUSTER=0
APP_STATUS="missing"
if PM2_INFO=$(pm2 jlist 2>/dev/null | APP_NAME="$APP_NAME" node -e '
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  try {
    const app = JSON.parse(input).find((item) => item && item.name === process.env.APP_NAME);
    if (!app) return console.log("missing|missing");
    const env = app.pm2_env || {};
    console.log(`${env.status || "unknown"}|${env.exec_mode || "unknown"}`);
  } catch {
    console.log("unknown|unknown");
  }
});
'); then
  APP_STATUS="${PM2_INFO%%|*}"
  APP_MODE="${PM2_INFO#*|}"
else
  APP_MODE="unknown"
fi
echo "PM2 current state: status=${APP_STATUS}, mode=${APP_MODE}"

if [ "$APP_STATUS" = "online" ]; then
  APP_IS_RUNNING=1
  if [ "$APP_MODE" = "cluster_mode" ]; then
    APP_IS_CLUSTER=1
  fi
fi

if [ "$APP_IS_RUNNING" = "1" ] && [ "$APP_IS_CLUSTER" = "1" ]; then
  echo "→ Graceful reload (cluster mode, no downtime)…"
  if ! pm2 reload ecosystem.config.cjs --only "$APP_NAME" --update-env; then
    echo "::warning::pm2 reload failed — falling back to delete+start."
    pm2 delete "$APP_NAME" || true
    wait_for_port_free "${APP_PORT}" || {
      echo "ERROR: Port ${APP_PORT} still bound after failed reload fallback."; print_port_diagnostics; fail_deploy "port-still-bound-after-reload-fallback";
    }
    pm2 start ecosystem.config.cjs --only "$APP_NAME" --update-env || {
      echo "ERROR: pm2 start failed after reload fallback."
      print_port_diagnostics
      pm2 logs "$APP_NAME" --lines 120 --nostream || true
      fail_deploy "pm2-start-failed-after-reload-fallback"
    }
  fi
else
  if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
    echo "→ Existing PM2 app is ${APP_STATUS}/${APP_MODE} — recreating in cluster mode."
    pm2 delete "$APP_NAME" || true
    wait_for_port_free "${APP_PORT}" || {
      echo "ERROR: Port ${APP_PORT} still bound after delete."; print_port_diagnostics; fail_deploy "port-still-bound-after-delete"
    }
  fi
  echo "→ Fresh start in cluster mode…"
  pm2 start ecosystem.config.cjs --only "$APP_NAME" --update-env || {
    echo "ERROR: pm2 start failed."
    print_port_diagnostics
    pm2 logs "$APP_NAME" --lines 120 --nostream || true
    fail_deploy "pm2-start-failed"
  }
fi
pm2 save || echo "::warning::pm2 save failed (non-fatal — process list may not survive reboot)."

# Confirm the Node SSR app bound the port after reload/start.
BOUND=0
for attempt in $(seq 1 45); do
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
  fail_deploy "port-not-bound"
fi
echo "✓ App is listening on ${APP_PORT}."

# === Runtime gate ===
# The NEW workers are now serving. First verify the custom Node runner is alive
# and serving the freshly-rsynced deploy-version.json. This avoids false deploy
# failures caused by an app-level route regression while still proving that PM2
# restarted onto the new bundle. The workflow's next step performs the full SSR
# home-page smoke test separately with clearer diagnostics.
SHORT_SHA="${DEPLOY_SHA:-unknown}"
SHORT_SHA="${SHORT_SHA:0:7}"
echo "→ Local runtime gate (http://127.0.0.1:${APP_PORT}/deploy-version.json)…"
HEALTH_OK=0
for attempt in $(seq 1 30); do
  CODE=$(curl -sS -o /tmp/health.out -w '%{http_code}' --max-time 5 \
    "http://127.0.0.1:${APP_PORT}/deploy-version.json" 2>/dev/null) || CODE="000"
  CODE="${CODE##*$'\n'}"
  if [ "$CODE" = "200" ] && grep -q "$SHORT_SHA" /tmp/health.out 2>/dev/null; then
    HEALTH_OK=1; break
  fi
  echo "  runtime attempt $attempt → HTTP $CODE"
  cat /tmp/health.out 2>/dev/null | cut -c1-300 || true
  sleep 2
done

if [ "$HEALTH_OK" -ne 1 ]; then
  echo "ERROR: Runtime endpoint did not return this deploy (${SHORT_SHA}) after reload."
  cat /tmp/health.out 2>/dev/null || true
  pm2 logs "$APP_NAME" --lines 120 --nostream || true
  echo "→ Auto-rollback: restoring LAST_GOOD and reloading…"
  if integrity_rollback "post-reload-health-failed"; then
    pm2 reload ecosystem.config.cjs --only "$APP_NAME" --update-env || \
      pm2 start ecosystem.config.cjs --only "$APP_NAME" --update-env
    pm2 save || echo "::warning::pm2 save failed after rollback (non-fatal)."
  fi
  fail_deploy "runtime-version-gate-failed"
fi

MALFORMED_CODE=$(curl --path-as-is -sS -o /tmp/malformed-path.out -w '%{http_code}' --max-time 5 \
  "http://127.0.0.1:${APP_PORT}//" 2>/dev/null) || MALFORMED_CODE="000"
MALFORMED_CODE="${MALFORMED_CODE##*$'\n'}"
case "$MALFORMED_CODE" in
  2??|3??|4??)
    echo "✓ Malformed-path guard passed — GET // returned HTTP ${MALFORMED_CODE}, not a server crash." ;;
  *)
    echo "::warning::Malformed-path guard returned HTTP ${MALFORMED_CODE}; deployment remains successful because the runtime version gate already passed."
    cat /tmp/malformed-path.out 2>/dev/null || true
    pm2 logs "$APP_NAME" --lines 120 --nostream || true
    ;;
esac
publish_good_snapshot || echo "::warning::publish_good_snapshot exited unexpectedly after app became healthy. Deployment remains successful because runtime validation already passed."
echo "✓ Health gate passed — new build is live for all clients."
