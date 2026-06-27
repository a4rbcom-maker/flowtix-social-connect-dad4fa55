CREATE TABLE IF NOT EXISTS public.wa_session_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  session_id text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  source text NOT NULL,
  reason text,
  raw_status text,
  bridge_event text,
  bridge_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_session_events TO authenticated;
GRANT ALL ON public.wa_session_events TO service_role;

ALTER TABLE public.wa_session_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wa_session_events select own" ON public.wa_session_events;
CREATE POLICY "wa_session_events select own" ON public.wa_session_events
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "wa_session_events insert own" ON public.wa_session_events;
CREATE POLICY "wa_session_events insert own" ON public.wa_session_events
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "wa_session_events update own" ON public.wa_session_events;
CREATE POLICY "wa_session_events update own" ON public.wa_session_events
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "wa_session_events delete own" ON public.wa_session_events;
CREATE POLICY "wa_session_events delete own" ON public.wa_session_events
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_wa_session_events_user_created
  ON public.wa_session_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wa_session_events_session_created
  ON public.wa_session_events (session_id, created_at DESC);