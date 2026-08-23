-- Enforce per-user limits at the DATABASE layer (last line of defense against
-- direct API calls bypassing the app):
--   1. Max 2 live Facebook sessions per user (soft-deleted rows excluded).
--   2. Max 2 running extraction jobs per user; extra inserts are forced to
--      "queued" so the service queue auto-starts them oldest-first.
-- Both rules are race-safe: the guard functions run in the same transaction
-- as the INSERT/UPDATE they guard, and Postgres row locks serialize
-- concurrent writers for the same user_id.

-- ---------------------------------------------------------------------------
-- 1) Facebook sessions: max 2 live per user
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_fb_sessions_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  live_count integer;
BEGIN
  SELECT count(*) INTO live_count
  FROM public.fb_sessions s
  WHERE s.user_id = NEW.user_id
    AND s.deleted_at IS NULL
    AND (TG_OP = 'INSERT' OR s.id <> NEW.id);

  IF live_count >= 2 THEN
    RAISE EXCEPTION 'لقد وصلت إلى الحد الأقصى المسموح به وهو جلستان. / You have reached the maximum limit of 2 Facebook sessions.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fb_sessions_limit ON public.fb_sessions;
CREATE TRIGGER trg_fb_sessions_limit
  BEFORE INSERT ON public.fb_sessions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_fb_sessions_limit();

-- ---------------------------------------------------------------------------
-- 2) Extraction jobs: max 2 running per user, overflow becomes queued
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_extraction_jobs_running_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  running_count integer;
BEGIN
  -- Guard only transitions INTO running (insert or update). Anything else
  -- (queued, completed, failed, canceled, paused) passes through untouched.
  IF NEW.status <> 'running' THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO running_count
  FROM public.extraction_jobs j
  WHERE j.user_id = NEW.user_id
    AND j.status = 'running'
    AND (TG_OP = 'INSERT' OR j.id <> NEW.id);

  IF running_count >= 2 THEN
    -- Graceful degradation instead of an error: park as queued. The service
    -- auto-starts queued jobs oldest-first when a slot frees up.
    NEW.status := 'queued';
    NEW.started_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_extraction_jobs_running_limit ON public.extraction_jobs;
CREATE TRIGGER trg_extraction_jobs_running_limit
  BEFORE INSERT OR UPDATE OF status ON public.extraction_jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_extraction_jobs_running_limit();
