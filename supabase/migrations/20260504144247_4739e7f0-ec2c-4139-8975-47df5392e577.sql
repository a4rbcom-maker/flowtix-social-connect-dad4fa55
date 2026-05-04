CREATE INDEX IF NOT EXISTS fb_jobs_pending_idx
  ON public.fb_jobs (status, scheduled_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS fb_jobs_user_status_idx
  ON public.fb_jobs (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS fb_job_results_job_idx
  ON public.fb_job_results (job_id, created_at DESC);