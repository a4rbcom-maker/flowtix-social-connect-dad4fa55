-- Task Watchdog: heartbeat + progress tracking + generalized stuck-job reaper.
-- Non-destructive: preserves existing statuses/policies/grants.

-- 1) Heartbeat + activity columns on fb_jobs.
ALTER TABLE public.fb_jobs
  ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_progress_at  timestamptz,
  ADD COLUMN IF NOT EXISTS stuck_reason      text;

-- Backfill activity to current row state so the sweep does not misclassify
-- jobs that already had progress before this column existed.
UPDATE public.fb_jobs
   SET last_progress_at = COALESCE(last_progress_at, updated_at, started_at, created_at)
 WHERE last_progress_at IS NULL;

-- Helpful index for the sweep (only pending/running are considered).
CREATE INDEX IF NOT EXISTS fb_jobs_watchdog_idx
  ON public.fb_jobs (status, COALESCE(last_progress_at, updated_at))
  WHERE status IN ('pending','running');

-- 2) Trigger — bump last_progress_at whenever real progress is observed.
CREATE OR REPLACE FUNCTION public.fb_jobs_track_activity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.last_progress_at := COALESCE(NEW.last_progress_at, now());
    RETURN NEW;
  END IF;

  -- Any observable forward motion counts as activity.
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.progress IS DISTINCT FROM OLD.progress
     OR NEW.processed_items IS DISTINCT FROM OLD.processed_items
     OR NEW.total_items IS DISTINCT FROM OLD.total_items
     OR (NEW.started_at IS NOT NULL AND OLD.started_at IS NULL)
     OR (NEW.completed_at IS NOT NULL AND OLD.completed_at IS NULL)
     OR NEW.last_heartbeat_at IS DISTINCT FROM OLD.last_heartbeat_at
  THEN
    NEW.last_progress_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fb_jobs_track_activity_trg ON public.fb_jobs;
CREATE TRIGGER fb_jobs_track_activity_trg
  BEFORE INSERT OR UPDATE ON public.fb_jobs
  FOR EACH ROW EXECUTE FUNCTION public.fb_jobs_track_activity();

-- 3) Per-type timeout table (data-driven so we don't hardcode inside SQL).
--    (in seconds) pickup_timeout: pending pickup budget.
--                 progress_timeout: max silence while running.
CREATE OR REPLACE FUNCTION public.fb_job_timeout(_type fb_job_type)
RETURNS TABLE(pickup_secs int, progress_secs int)
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT
    CASE _type
      WHEN 'test_proxy'                        THEN 60
      WHEN 'messenger_extract_token'           THEN 180
      WHEN 'messenger_list_pages'              THEN 180
      WHEN 'messenger_sync_cookies'            THEN 180
      WHEN 'messenger_send_cookies'            THEN 240
      WHEN 'messenger_graph_sync_pages'        THEN 180
      WHEN 'messenger_graph_sync_conversations' THEN 240
      WHEN 'test_account'                      THEN 120
      WHEN 'post_to_groups'                    THEN 300
      WHEN 'publish_pages_graph'               THEN 300
      WHEN 'send_messenger_dm'                 THEN 300
      ELSE 300
    END AS pickup_secs,
    CASE _type
      WHEN 'test_proxy'                        THEN 60
      WHEN 'messenger_extract_token'           THEN 180
      WHEN 'messenger_list_pages'              THEN 240
      WHEN 'messenger_sync_cookies'            THEN 300
      WHEN 'messenger_send_cookies'            THEN 300
      WHEN 'messenger_graph_sync_pages'        THEN 240
      WHEN 'messenger_graph_sync_conversations' THEN 360
      WHEN 'test_account'                      THEN 180
      WHEN 'post_to_groups'                    THEN 1800
      WHEN 'publish_pages_graph'               THEN 1800
      WHEN 'send_messenger_dm'                 THEN 1800
      WHEN 'extract_pages'                     THEN 600
      WHEN 'extract_commenters'                THEN 600
      WHEN 'extract_group_members'             THEN 900
      WHEN 'extract_page_audience'             THEN 900
      WHEN 'deep_profile_scrape'               THEN 600
      WHEN 'list_my_groups'                    THEN 300
      ELSE 600
    END AS progress_secs;
$$;

-- 4) Server-side heartbeat helper — workers/bridges can bump the pulse
--    without touching progress counters. Scoped to the caller by RLS
--    unless invoked under service_role.
CREATE OR REPLACE FUNCTION public.fb_job_heartbeat(_job_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.fb_jobs
     SET last_heartbeat_at = now()
   WHERE id = _job_id
     AND status IN ('pending','running');
END;
$$;

-- 5) Generalized watchdog sweep. Marks Stuck jobs as `failed` (existing
--    enum has no 'stuck' value; we tag them via `stuck_reason` so the UI
--    can distinguish them from real failures without an enum migration).
--
--    Decision matrix (per fb_job_timeout(job_type)):
--      * Pending  : marked stuck when created > pickup_secs and never picked up.
--      * Running  : marked stuck when BOTH no heartbeat AND no progress
--                   have arrived within progress_secs.
--    Grace: an explicit last_heartbeat_at within progress_secs ALWAYS
--    protects a running job even when progress counters do not move.
CREATE OR REPLACE FUNCTION public.fb_watchdog_sweep(_max_batch int DEFAULT 500)
RETURNS TABLE(reaped_pending int, reaped_running int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  rp int := 0;
  rr int := 0;
BEGIN
  -- Pending: never picked up by any worker.
  WITH targets AS (
    SELECT j.id,
           t.pickup_secs
      FROM public.fb_jobs j
      CROSS JOIN LATERAL public.fb_job_timeout(j.job_type) t
     WHERE j.status = 'pending'
       AND j.started_at IS NULL
       AND j.created_at < now() - make_interval(secs => t.pickup_secs)
     ORDER BY j.created_at ASC
     LIMIT _max_batch
  ), upd AS (
    UPDATE public.fb_jobs j
       SET status = 'failed'::fb_job_status,
           stuck_reason = 'no_worker_pickup',
           error_message = COALESCE(NULLIF(j.error_message,''),
             'لم يلتقط أي عامل هذه المهمة خلال المهلة المسموحة. تأكد من تشغيل البوت ثم أعد المحاولة.'),
           completed_at = now(),
           updated_at = now()
      FROM targets t
     WHERE j.id = t.id
    RETURNING 1
  )
  SELECT count(*) INTO rp FROM upd;

  -- Running: no heartbeat AND no progress for the whole progress budget.
  WITH targets AS (
    SELECT j.id,
           t.progress_secs
      FROM public.fb_jobs j
      CROSS JOIN LATERAL public.fb_job_timeout(j.job_type) t
     WHERE j.status = 'running'
       AND (
         j.last_heartbeat_at IS NULL
         OR j.last_heartbeat_at < now() - make_interval(secs => t.progress_secs)
       )
       AND COALESCE(j.last_progress_at, j.started_at, j.created_at)
             < now() - make_interval(secs => t.progress_secs)
       AND COALESCE(j.updated_at, j.created_at)
             < now() - make_interval(secs => t.progress_secs)
     ORDER BY COALESCE(j.last_progress_at, j.created_at) ASC
     LIMIT _max_batch
  ), upd AS (
    UPDATE public.fb_jobs j
       SET status = 'failed'::fb_job_status,
           stuck_reason = 'no_progress_timeout',
           error_message = COALESCE(NULLIF(j.error_message,''),
             'توقفت المهمة عن التقدم لفترة أطول من المسموح. تم إنهاؤها تلقائياً — يمكنك إعادة تشغيلها.'),
           completed_at = now(),
           updated_at = now()
      FROM targets t
     WHERE j.id = t.id
    RETURNING 1
  )
  SELECT count(*) INTO rr FROM upd;

  RETURN QUERY SELECT rp, rr;
END;
$$;

-- 6) Keep the older messenger-only reaper working (it's still called from
--    src/lib/messenger-graph.functions.ts). Reimplement it as a thin wrapper
--    that also tags stuck_reason so the UI is consistent.
CREATE OR REPLACE FUNCTION public.fb_reap_stuck_messenger_jobs(_user_id uuid, _max_minutes integer DEFAULT 6)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE reaped int;
BEGIN
  IF _user_id IS NULL THEN RETURN 0; END IF;
  UPDATE public.fb_jobs
     SET status = 'failed'::fb_job_status,
         stuck_reason = COALESCE(stuck_reason,
           CASE WHEN status = 'pending' THEN 'no_worker_pickup' ELSE 'no_progress_timeout' END),
         error_message = CASE
           WHEN status = 'pending' THEN
             'لم يلتقط أي عامل هذه المهمة خلال ' || _max_minutes || ' دقائق. تحقّق من تشغيل البوت وحاول مرة أخرى.'
           ELSE
             COALESCE(NULLIF(error_message,''),
               'انتهت المهلة الزمنية للعامل (' || _max_minutes || ' دقائق) — تم إلغاؤها تلقائياً.')
         END,
         completed_at = now(),
         updated_at = now()
   WHERE user_id = _user_id
     AND status IN ('pending','running')
     AND job_type IN (
       'messenger_extract_token',
       'messenger_list_pages',
       'messenger_sync_cookies',
       'messenger_send_cookies'
     )
     AND COALESCE(last_progress_at, started_at, created_at) < now() - (_max_minutes::text || ' minutes')::interval;
  GET DIAGNOSTICS reaped = ROW_COUNT;
  RETURN reaped;
END;
$$;

-- 7) Retry helper — clone a stuck/failed/cancelled job as a fresh pending
--    row belonging to the same user. RLS enforces ownership.
CREATE OR REPLACE FUNCTION public.fb_retry_job(_job_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE new_id uuid;
BEGIN
  INSERT INTO public.fb_jobs
    (user_id, account_id, job_type, payload, status, campaign_id)
  SELECT user_id, account_id, job_type, payload, 'pending'::fb_job_status, campaign_id
    FROM public.fb_jobs
   WHERE id = _job_id
     AND status IN ('failed','cancelled')
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

-- 8) Execute permissions.
REVOKE ALL ON FUNCTION public.fb_watchdog_sweep(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fb_watchdog_sweep(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.fb_job_heartbeat(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fb_retry_job(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fb_job_timeout(fb_job_type) TO authenticated, service_role;
