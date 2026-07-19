-- Switch reaper to SECURITY INVOKER — RLS on fb_jobs already limits
-- updates to auth.uid() = user_id, so no elevated privileges are needed.
CREATE OR REPLACE FUNCTION public.fb_reap_stuck_messenger_jobs(_user_id uuid, _max_minutes integer DEFAULT 6)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
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
