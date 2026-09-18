-- ============================================================================
-- Facebook forced-logout repair — schema support
--
-- Root cause this migration supports: the extraction service persisted rotated
-- cookies without first proving the session was still logged in. Facebook hands
-- back a login page whose cookie jar still carries c_user/xs keys, so the write
-- guard passed on names alone and overwrote a live identity with a dead one.
-- Repeated logouts followed. These columns give the fix its safety net.
-- ============================================================================

-- 1) Snapshot of the LAST KNOWN GOOD identity.
--    Written exactly once per session, immediately after the first successful
--    login verification, and never overwritten afterwards. If a later capture
--    is bad, the working identity can still be restored from here.
alter table public.fb_browser_profiles
  add column if not exists snapshot_state_enc jsonb,
  add column if not exists snapshot_taken_at timestamptz;

-- 2) Why a session stopped working — surfaces a readable reason in the UI
--    instead of leaving the user to guess why Facebook logged them out.
alter table public.fb_sessions
  add column if not exists invalid_reason text;

-- 3) Sessions are looked up by status on every job start.
create index if not exists idx_fb_sessions_status_active
  on public.fb_sessions (status)
  where deleted_at is null;