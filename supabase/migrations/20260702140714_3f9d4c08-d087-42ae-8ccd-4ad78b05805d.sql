
CREATE TABLE public.wa_history_sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  session_id text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  baseline_msg integer NOT NULL DEFAULT 0,
  baseline_conv integer NOT NULL DEFAULT 0,
  imported_msg integer NOT NULL DEFAULT 0,
  imported_conv integer NOT NULL DEFAULT 0,
  message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  deadline_at timestamptz NOT NULL DEFAULT (now() + interval '90 seconds'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT wa_history_sync_jobs_user_unique UNIQUE (user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_history_sync_jobs TO authenticated;
GRANT ALL ON public.wa_history_sync_jobs TO service_role;

ALTER TABLE public.wa_history_sync_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user manages own history sync job"
ON public.wa_history_sync_jobs
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER wa_history_sync_jobs_updated_at
BEFORE UPDATE ON public.wa_history_sync_jobs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
