
-- WhatsApp Bridge sessions: one row per user
CREATE TABLE public.wa_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  session_id text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'disconnected',
  qr_data_url text,
  phone_number text,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.wa_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wa_sessions select own" ON public.wa_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "wa_sessions insert own" ON public.wa_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "wa_sessions update own" ON public.wa_sessions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "wa_sessions delete own" ON public.wa_sessions FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER wa_sessions_updated_at BEFORE UPDATE ON public.wa_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX wa_sessions_session_id_idx ON public.wa_sessions(session_id);

-- WhatsApp messages: inbox + sent log
CREATE TABLE public.wa_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  session_id text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('in','out')),
  remote_jid text NOT NULL,
  from_phone text,
  to_phone text,
  msg_type text NOT NULL DEFAULT 'text',
  text_body text,
  media_url text,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.wa_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wa_messages select own" ON public.wa_messages FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "wa_messages insert own" ON public.wa_messages FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "wa_messages delete own" ON public.wa_messages FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX wa_messages_user_remote_idx ON public.wa_messages(user_id, remote_jid, created_at DESC);
CREATE INDEX wa_messages_session_idx ON public.wa_messages(session_id, created_at DESC);

ALTER PUBLICATION supabase_realtime ADD TABLE public.wa_messages;
ALTER TABLE public.wa_messages REPLICA IDENTITY FULL;
