
-- 1) New enum values for messenger graph-api jobs
ALTER TYPE public.fb_job_type ADD VALUE IF NOT EXISTS 'messenger_extract_token';
ALTER TYPE public.fb_job_type ADD VALUE IF NOT EXISTS 'messenger_graph_sync_pages';
ALTER TYPE public.fb_job_type ADD VALUE IF NOT EXISTS 'messenger_graph_sync_conversations';

-- 2) Store Graph API token per bot account (extracted from the session)
ALTER TABLE public.fb_bot_accounts
  ADD COLUMN IF NOT EXISTS graph_token_encrypted text,
  ADD COLUMN IF NOT EXISTS graph_token_updated_at timestamptz;

-- 3) messenger_pages: discovered pages via /me/accounts
CREATE TABLE IF NOT EXISTS public.messenger_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid REFERENCES public.fb_bot_accounts(id) ON DELETE CASCADE,
  page_id text NOT NULL,
  name text NOT NULL,
  category text,
  tasks text[] NOT NULL DEFAULT '{}',
  access_token_encrypted text,
  picture_url text,
  followers_count integer,
  last_synced_at timestamptz,
  source text NOT NULL DEFAULT 'graph_api',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, page_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.messenger_pages TO authenticated;
GRANT ALL ON public.messenger_pages TO service_role;

ALTER TABLE public.messenger_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "messenger_pages owner all"
  ON public.messenger_pages FOR ALL
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS messenger_pages_user_idx ON public.messenger_pages(user_id);
CREATE INDEX IF NOT EXISTS messenger_pages_account_idx ON public.messenger_pages(account_id);

CREATE TRIGGER trg_messenger_pages_updated_at
  BEFORE UPDATE ON public.messenger_pages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4) messenger_sync_logs: per-stage structured log
CREATE TABLE IF NOT EXISTS public.messenger_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid REFERENCES public.fb_bot_accounts(id) ON DELETE SET NULL,
  page_id text,
  job_id uuid,
  stage text NOT NULL,
  status text NOT NULL,
  message text,
  failure_reason text,
  expected jsonb,
  received jsonb,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.messenger_sync_logs TO authenticated;
GRANT ALL ON public.messenger_sync_logs TO service_role;

ALTER TABLE public.messenger_sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "messenger_sync_logs owner select"
  ON public.messenger_sync_logs FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "messenger_sync_logs owner insert"
  ON public.messenger_sync_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "messenger_sync_logs owner delete"
  ON public.messenger_sync_logs FOR DELETE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS messenger_sync_logs_user_idx ON public.messenger_sync_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messenger_sync_logs_job_idx ON public.messenger_sync_logs(job_id);
CREATE INDEX IF NOT EXISTS messenger_sync_logs_page_idx ON public.messenger_sync_logs(page_id);
