
-- Enums
CREATE TYPE public.fb_auth_method AS ENUM ('cookies', 'credentials');
CREATE TYPE public.fb_account_status AS ENUM ('active', 'invalid', 'checkpoint', 'disabled', 'untested');
CREATE TYPE public.fb_job_type AS ENUM ('post_to_groups', 'extract_pages', 'extract_commenters', 'test_account');
CREATE TYPE public.fb_job_status AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled');
CREATE TYPE public.fb_result_status AS ENUM ('success', 'failed', 'skipped');

-- Table: fb_bot_accounts
CREATE TABLE public.fb_bot_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  auth_method public.fb_auth_method NOT NULL,
  encrypted_payload TEXT NOT NULL,
  status public.fb_account_status NOT NULL DEFAULT 'untested',
  last_check_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_fb_bot_accounts_user ON public.fb_bot_accounts(user_id);

ALTER TABLE public.fb_bot_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own bot accounts" ON public.fb_bot_accounts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own bot accounts" ON public.fb_bot_accounts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own bot accounts" ON public.fb_bot_accounts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own bot accounts" ON public.fb_bot_accounts FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER trg_fb_bot_accounts_updated
BEFORE UPDATE ON public.fb_bot_accounts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Table: fb_jobs
CREATE TABLE public.fb_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID REFERENCES public.fb_bot_accounts(id) ON DELETE SET NULL,
  job_type public.fb_job_type NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status public.fb_job_status NOT NULL DEFAULT 'pending',
  progress INT NOT NULL DEFAULT 0,
  total_items INT NOT NULL DEFAULT 0,
  processed_items INT NOT NULL DEFAULT 0,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_fb_jobs_user ON public.fb_jobs(user_id);
CREATE INDEX idx_fb_jobs_status_scheduled ON public.fb_jobs(status, scheduled_at);

ALTER TABLE public.fb_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own fb jobs" ON public.fb_jobs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own fb jobs" ON public.fb_jobs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own fb jobs" ON public.fb_jobs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own fb jobs" ON public.fb_jobs FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER trg_fb_jobs_updated
BEFORE UPDATE ON public.fb_jobs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Table: fb_job_results
CREATE TABLE public.fb_job_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.fb_jobs(id) ON DELETE CASCADE,
  target TEXT,
  status public.fb_result_status NOT NULL,
  data JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_fb_job_results_job ON public.fb_job_results(job_id);

ALTER TABLE public.fb_job_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view results of own jobs" ON public.fb_job_results FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.fb_jobs j WHERE j.id = job_id AND j.user_id = auth.uid()));
CREATE POLICY "Users delete results of own jobs" ON public.fb_job_results FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.fb_jobs j WHERE j.id = job_id AND j.user_id = auth.uid()));

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.fb_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.fb_job_results;
ALTER TABLE public.fb_jobs REPLICA IDENTITY FULL;
ALTER TABLE public.fb_job_results REPLICA IDENTITY FULL;
