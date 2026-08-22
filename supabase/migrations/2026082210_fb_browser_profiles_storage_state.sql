-- Persist full browser storage state (cookies + localStorage origins) per FB
-- session. Replaying cookies into a fresh ephemeral browser on every run is a
-- strong token-theft signal that makes Facebook force-log the account —
-- restoring the same localStorage identity each run keeps the session stable.
ALTER TABLE public.fb_browser_profiles
  ADD COLUMN IF NOT EXISTS storage_state_enc jsonb;
