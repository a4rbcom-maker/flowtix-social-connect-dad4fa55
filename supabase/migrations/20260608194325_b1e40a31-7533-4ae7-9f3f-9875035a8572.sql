-- Tighten fb_job_results policies to authenticated role
DROP POLICY IF EXISTS "Users view results of own jobs" ON public.fb_job_results;
DROP POLICY IF EXISTS "Users delete results of own jobs" ON public.fb_job_results;

CREATE POLICY "Users view results of own jobs"
ON public.fb_job_results
FOR SELECT
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.fb_jobs j
  WHERE j.id = fb_job_results.job_id AND j.user_id = auth.uid()
));

CREATE POLICY "Users delete results of own jobs"
ON public.fb_job_results
FOR DELETE
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.fb_jobs j
  WHERE j.id = fb_job_results.job_id AND j.user_id = auth.uid()
));

-- Tighten realtime topic policy: require topic to start with the user's UID
DROP POLICY IF EXISTS "Users subscribe to own topics" ON realtime.messages;

CREATE POLICY "Users subscribe to own topics"
ON realtime.messages
FOR SELECT
TO authenticated
USING (realtime.topic() LIKE (auth.uid()::text || '%'));
