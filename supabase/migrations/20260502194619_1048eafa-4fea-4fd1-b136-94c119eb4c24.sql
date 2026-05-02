-- Contacts table
CREATE TABLE IF NOT EXISTS public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  phone text NOT NULL,
  tags text[] DEFAULT '{}',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, phone)
);
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own contacts" ON public.contacts FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own contacts" ON public.contacts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own contacts" ON public.contacts FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own contacts" ON public.contacts FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER update_contacts_updated_at BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_contacts_user ON public.contacts(user_id);

-- Bulk job status enum
DO $$ BEGIN
  CREATE TYPE public.bulk_job_status AS ENUM ('scheduled','running','completed','failed','cancelled','paused');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Bulk jobs table
CREATE TABLE IF NOT EXISTS public.bulk_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  channel public.send_channel NOT NULL DEFAULT 'whatsapp',
  title text NOT NULL,
  message text NOT NULL,
  image_url text,
  interval_seconds integer NOT NULL DEFAULT 5,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  status public.bulk_job_status NOT NULL DEFAULT 'scheduled',
  total_recipients integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  next_send_at timestamptz,
  error_message text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bulk_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own bulk jobs" ON public.bulk_jobs FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own bulk jobs" ON public.bulk_jobs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own bulk jobs" ON public.bulk_jobs FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own bulk jobs" ON public.bulk_jobs FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER update_bulk_jobs_updated_at BEFORE UPDATE ON public.bulk_jobs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_bulk_jobs_user_status ON public.bulk_jobs(user_id, status);
CREATE INDEX idx_bulk_jobs_next_send ON public.bulk_jobs(next_send_at) WHERE status = 'running';
CREATE INDEX idx_bulk_jobs_scheduled ON public.bulk_jobs(scheduled_at) WHERE status = 'scheduled';

-- Per-recipient tracking
CREATE TABLE IF NOT EXISTS public.bulk_job_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.bulk_jobs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  contact_id uuid,
  name text NOT NULL,
  phone text NOT NULL,
  status public.send_status NOT NULL DEFAULT 'pending',
  sent_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bulk_job_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own bulk recipients" ON public.bulk_job_recipients FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own bulk recipients" ON public.bulk_job_recipients FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own bulk recipients" ON public.bulk_job_recipients FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users delete own bulk recipients" ON public.bulk_job_recipients FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX idx_bulk_recipients_job ON public.bulk_job_recipients(job_id, status);

-- Enable realtime for live progress updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.bulk_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.bulk_job_recipients;