-- IG mention + DM actions: make message_jobs platform/mode aware.
-- Applied via Supabase Management API statement-by-statement (CLI has no
-- privileges — see references/supabase-management-api.md).
--
-- Design: REUSE the existing message_jobs / message_recipients /
-- message_send_counters tables (proven by the Messenger broadcast path)
-- instead of creating parallel tables. Two new NOT NULL columns with safe
-- defaults preserve every existing Messenger row's behavior verbatim.
-- status stays plain text (no ALTER TYPE ... ADD VALUE enum trap).

ALTER TABLE public.message_jobs
  ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'facebook',
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'dm';

ALTER TABLE public.message_jobs
  ADD CONSTRAINT message_jobs_platform_chk
  CHECK (platform IN ('facebook', 'instagram')) NOT VALID;
ALTER TABLE public.message_jobs
  ADD CONSTRAINT message_jobs_mode_chk
  CHECK (mode IN ('dm', 'mention')) NOT VALID;

ALTER TABLE public.message_recipients
  ADD COLUMN IF NOT EXISTS batch_index int;

CREATE INDEX IF NOT EXISTS idx_message_jobs_user_platform_status
  ON public.message_jobs (user_id, platform, status);

-- One active action job PER (user, platform). Lets a Messenger job and an IG
-- job run concurrently; still forbids two IG jobs colliding on the same
-- account (protects from double-pacing / faster blocks).
DROP FUNCTION IF EXISTS public.enforce_message_jobs_active_limit() CASCADE;

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
    AND j.platform = NEW.platform
    AND j.status IN ('queued', 'running', 'paused')
    AND (TG_OP = 'INSERT' OR j.id <> NEW.id);

  IF active_count >= 1 THEN
    RAISE EXCEPTION 'لديك مهمة مراسلة نشطة بالفعل على هذه المنصة. أوقفها أو انتظر اكتمالها قبل بدء مهمة جديدة.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_message_jobs_active_limit ON public.message_jobs;
CREATE TRIGGER trg_message_jobs_active_limit
  BEFORE INSERT OR UPDATE ON public.message_jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_message_jobs_active_limit();

-- message_send_counters is shared across platforms via its (session_id,
-- day_key) PK. The existing SELECT policy only links to fb_sessions, so IG
-- sessions (ig_sessions) cannot read their own counters — add a parallel
-- policy so the worker's live progress display works for IG too.
DROP POLICY IF EXISTS select_own_ig_message_counters ON public.message_send_counters;
CREATE POLICY select_own_ig_message_counters ON public.message_send_counters
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.ig_sessions s
            WHERE s.id = session_id AND (s.user_id = auth.uid() OR is_super_admin()))
  );
