-- Lock down SECURITY DEFINER functions to their intended callers only.
REVOKE ALL ON FUNCTION public.fb_watchdog_sweep(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fb_watchdog_sweep(int) TO service_role;

REVOKE ALL ON FUNCTION public.fb_reap_stuck_messenger_jobs(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fb_reap_stuck_messenger_jobs(uuid, int) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fb_retry_job(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fb_retry_job(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.fb_job_heartbeat(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fb_job_heartbeat(uuid) TO authenticated, service_role;
