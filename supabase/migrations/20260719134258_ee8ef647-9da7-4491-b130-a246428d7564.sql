
-- Stuck-job reaper for Messenger pipeline. Any messenger_* job that stays
-- 'running' longer than _max_minutes is marked failed with a clear reason,
-- so the UI stops spinning forever and the user can retry.
CREATE OR REPLACE FUNCTION public.fb_reap_stuck_messenger_jobs(_user_id uuid, _max_minutes int DEFAULT 6)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE reaped int;
BEGIN
  IF _user_id IS NULL THEN RETURN 0; END IF;
  UPDATE public.fb_jobs
     SET status = 'failed'::fb_job_status,
         error_message = COALESCE(NULLIF(error_message,''),
           'انتهت المهلة الزمنية للعامل (' || _max_minutes || ' دقائق) — تم إلغاؤها تلقائياً.'),
         completed_at = now(),
         updated_at = now()
   WHERE user_id = _user_id
     AND status = 'running'
     AND job_type IN (
       'messenger_extract_token',
       'messenger_list_pages',
       'messenger_sync_cookies',
       'messenger_send_cookies'
     )
     AND COALESCE(started_at, created_at) < now() - (_max_minutes::text || ' minutes')::interval;
  GET DIAGNOSTICS reaped = ROW_COUNT;
  RETURN reaped;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fb_reap_stuck_messenger_jobs(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fb_reap_stuck_messenger_jobs(uuid, int) TO service_role;
