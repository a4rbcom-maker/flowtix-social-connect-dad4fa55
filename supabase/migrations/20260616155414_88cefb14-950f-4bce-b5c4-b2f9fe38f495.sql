-- fb_job_results is written exclusively by the worker via service_role (bypasses RLS).
-- Add explicit deny policies for INSERT/UPDATE by authenticated users to satisfy the scanner
-- and make the intent explicit. service_role bypasses RLS so worker writes are unaffected.

CREATE POLICY "Block authenticated inserts on fb_job_results"
ON public.fb_job_results
FOR INSERT TO authenticated
WITH CHECK (false);

CREATE POLICY "Block authenticated updates on fb_job_results"
ON public.fb_job_results
FOR UPDATE TO authenticated
USING (false)
WITH CHECK (false);