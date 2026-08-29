-- Message broadcast tables (applied via Management API 2026-08-29 — see
-- references/supabase-management-api.md; CLI db push has no privileges).
-- status is plain text on purpose: no ALTER TYPE ... ADD VALUE enum trap.

CREATE TABLE IF NOT EXISTS public.message_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_job_id uuid REFERENCES public.extraction_jobs(id) ON DELETE SET NULL,
  name text,
  status text NOT NULL DEFAULT 'queued',   -- queued|running|paused|completed|failed|canceled
  session_ids uuid[] NOT NULL DEFAULT '{}',
  content jsonb NOT NULL DEFAULT '{}',     -- {body, media_keys[], media_mime[]}
  config jsonb NOT NULL DEFAULT '{}',      -- pacing (daily_cap, rate_per_hour, ...)
  progress jsonb NOT NULL DEFAULT '{}',    -- {sent, failed, skipped, current_idx, stop_reason}
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.message_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_job_id uuid NOT NULL REFERENCES public.message_jobs(id) ON DELETE CASCADE,
  fb_id text NOT NULL,
  thread_id text NOT NULL,
  name text,
  status text NOT NULL DEFAULT 'pending',  -- pending|sent|failed|skipped
  attempts int NOT NULL DEFAULT 0,
  sent_via_session_id uuid,
  error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_message_recipients_job_fb
  ON public.message_recipients (message_job_id, fb_id);
CREATE INDEX IF NOT EXISTS idx_message_recipients_pick
  ON public.message_recipients (message_job_id, status, attempts);

CREATE TABLE IF NOT EXISTS public.message_send_counters (
  session_id uuid NOT NULL,
  day_key date NOT NULL,
  sent_count int NOT NULL DEFAULT 0,
  cooldown_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, day_key)
);

ALTER TABLE public.message_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_send_counters ENABLE ROW LEVEL SECURITY;

-- message_jobs: owner (auth.uid) or super admin
DROP POLICY IF EXISTS select_own_message_jobs ON public.message_jobs;
CREATE POLICY select_own_message_jobs ON public.message_jobs
  FOR SELECT USING (user_id = auth.uid() OR is_super_admin());
DROP POLICY IF EXISTS insert_own_message_jobs ON public.message_jobs;
CREATE POLICY insert_own_message_jobs ON public.message_jobs
  FOR INSERT WITH CHECK (user_id = auth.uid() OR is_super_admin());
DROP POLICY IF EXISTS update_own_message_jobs ON public.message_jobs;
CREATE POLICY update_own_message_jobs ON public.message_jobs
  USING (user_id = auth.uid() OR is_super_admin())
  WITH CHECK (user_id = auth.uid() OR is_super_admin());
DROP POLICY IF EXISTS delete_own_message_jobs ON public.message_jobs;
CREATE POLICY delete_own_message_jobs ON public.message_jobs
  FOR DELETE USING (user_id = auth.uid() OR is_super_admin());

-- message_recipients: ownership via parent message_jobs
DROP POLICY IF EXISTS select_own_message_recipients ON public.message_recipients;
CREATE POLICY select_own_message_recipients ON public.message_recipients
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.message_jobs j
            WHERE j.id = message_job_id AND (j.user_id = auth.uid() OR is_super_admin()))
  );
DROP POLICY IF EXISTS insert_own_message_recipients ON public.message_recipients;
CREATE POLICY insert_own_message_recipients ON public.message_recipients
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.message_jobs j
            WHERE j.id = message_job_id AND (j.user_id = auth.uid() OR is_super_admin()))
  );
DROP POLICY IF EXISTS update_own_message_recipients ON public.message_recipients;
CREATE POLICY update_own_message_recipients ON public.message_recipients
  USING (
    EXISTS (SELECT 1 FROM public.message_jobs j
            WHERE j.id = message_job_id AND (j.user_id = auth.uid() OR is_super_admin()))
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.message_jobs j
            WHERE j.id = message_job_id AND (j.user_id = auth.uid() OR is_super_admin()))
  );
DROP POLICY IF EXISTS delete_own_message_recipients ON public.message_recipients;
CREATE POLICY delete_own_message_recipients ON public.message_recipients
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.message_jobs j
            WHERE j.id = message_job_id AND (j.user_id = auth.uid() OR is_super_admin()))
  );

-- message_send_counters: read-only for the owner (via fb_sessions), writes are
-- service-role only (the worker bypasses RLS by design).
DROP POLICY IF EXISTS select_own_message_counters ON public.message_send_counters;
CREATE POLICY select_own_message_counters ON public.message_send_counters
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.fb_sessions s
            WHERE s.id = session_id AND (s.user_id = auth.uid() OR is_super_admin()))
  );

-- One active message job per user (race-safe trigger, mirrors
-- enforce_fb_sessions_limit pattern from 2026082310).
CREATE OR REPLACE FUNCTION public.enforce_message_jobs_active_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  active_count integer;
BEGIN
  IF NEW.status NOT IN ('queued', 'running', 'paused') THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO active_count
  FROM public.message_jobs j
  WHERE j.user_id = NEW.user_id
    AND j.status IN ('queued', 'running', 'paused')
    AND (TG_OP = 'INSERT' OR j.id <> NEW.id);

  IF active_count >= 1 THEN
    RAISE EXCEPTION 'لديك مهمة مراسلة نشطة بالفعل. أوقفها أو انتظر اكتمالها قبل بدء مهمة جديدة.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_message_jobs_active_limit ON public.message_jobs;
CREATE TRIGGER trg_message_jobs_active_limit
  BEFORE INSERT ON public.message_jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_message_jobs_active_limit();
