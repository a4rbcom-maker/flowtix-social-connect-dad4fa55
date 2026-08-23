-- ============================================================
-- IG Extraction admission fix: enum values + workspace-free scoping
-- ============================================================
-- Root causes fixed here (audit 2026-08-23):
--   RC1: extraction_type enum has NO ig_* values -> every IG job died
--        with 22P02 at insert time (0 IG jobs in history).
--   RC2: service derived workspace from fb_sessions.workspace_id /
--        extraction_jobs.workspace_id — columns dropped by
--        2026072716_remove_workspaces (all NULL) -> resolveIgWorkspaceId
--        threw for every user.
--   RC3: cross-job dedup filtered by workspace_id (always NULL) ->
--        skip_duplicates was a silent no-op.
--
-- Scope: additive only. No existing enum value, row, policy or trigger
-- is touched. FB/Groups/Pages behavior unchanged.

-- ============================================================
-- 1. extraction_type: add Instagram values
-- ============================================================
-- NOTE: applied via Supabase Management API statement-by-statement on
-- 2026-08-23 (ADD VALUE cannot run inside a transaction block).
ALTER TYPE public.extraction_type ADD VALUE IF NOT EXISTS 'ig_followers' BEFORE 'custom';
ALTER TYPE public.extraction_type ADD VALUE IF NOT EXISTS 'ig_following' BEFORE 'custom';

-- ============================================================
-- 2. Cross-job dedup scope for Instagram: user_id + platform
-- ============================================================
-- The service queries existing results for dedup by user_id+platform
-- (see getExistingIgIds). Index backs that lookup.
CREATE INDEX IF NOT EXISTS idx_extraction_results_user_platform_fb_id
  ON public.extraction_results (user_id, platform, fb_id);

-- extraction_results.user_id backfill: existing rows predate the
-- column added below; scope them to their job's owner so dedup and
-- future queries stay correct.
ALTER TABLE public.extraction_results
  ADD COLUMN IF NOT EXISTS user_id uuid;

UPDATE public.extraction_results r
SET user_id = j.user_id
FROM public.extraction_jobs j
WHERE r.job_id = j.id
  AND r.user_id IS NULL;

ALTER TABLE public.extraction_results
  ADD CONSTRAINT extraction_results_user_fkey
  FOREIGN KEY (user_id) REFERENCES public.auth.users(id) ON DELETE CASCADE
  NOT VALID;

-- ============================================================
-- 3. In-job uniqueness for Instagram results
-- ============================================================
-- Partial unique index: one row per (job, platform, fb_id). Prevents
-- duplicate rows inside a single IG job (restart/resume double-flush)
-- without constraining FB rows or historical data.
CREATE UNIQUE INDEX IF NOT EXISTS uq_extraction_results_job_platform_fb_id
  ON public.extraction_results (job_id, platform, fb_id)
  WHERE platform = 'instagram';

NOTIFY pgrst, 'reload schema';
