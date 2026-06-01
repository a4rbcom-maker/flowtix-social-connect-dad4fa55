
-- ============================================================
-- WhatsApp Phase: Conversations + AI Agent settings + AI logs
-- ============================================================

-- 1) wa_conversations: one row per (user, remote contact)
CREATE TABLE IF NOT EXISTS public.wa_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  session_id text NOT NULL,
  remote_jid text NOT NULL,
  contact_name text,
  contact_phone text,
  last_message_text text,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_direction text NOT NULL DEFAULT 'in',
  unread_count integer NOT NULL DEFAULT 0,
  ai_enabled boolean NOT NULL DEFAULT true,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, remote_jid)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_conversations TO authenticated;
GRANT ALL ON public.wa_conversations TO service_role;

ALTER TABLE public.wa_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wa_conversations select own" ON public.wa_conversations
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "wa_conversations insert own" ON public.wa_conversations
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "wa_conversations update own" ON public.wa_conversations
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "wa_conversations delete own" ON public.wa_conversations
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_wa_conversations_user_last
  ON public.wa_conversations (user_id, last_message_at DESC);

CREATE TRIGGER trg_wa_conversations_updated
  BEFORE UPDATE ON public.wa_conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) wa_ai_logs: log of AI-generated replies
CREATE TABLE IF NOT EXISTS public.wa_ai_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  conversation_id uuid REFERENCES public.wa_conversations(id) ON DELETE CASCADE,
  remote_jid text NOT NULL,
  model text NOT NULL,
  prompt_excerpt text,
  response_text text,
  tokens_in integer,
  tokens_out integer,
  latency_ms integer,
  status text NOT NULL DEFAULT 'success',
  error_message text,
  rating smallint,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_ai_logs TO authenticated;
GRANT ALL ON public.wa_ai_logs TO service_role;

ALTER TABLE public.wa_ai_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wa_ai_logs select own" ON public.wa_ai_logs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "wa_ai_logs insert own" ON public.wa_ai_logs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "wa_ai_logs update own" ON public.wa_ai_logs
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "wa_ai_logs delete own" ON public.wa_ai_logs
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_wa_ai_logs_user_created
  ON public.wa_ai_logs (user_id, created_at DESC);

-- 3) Extend whatsapp_settings with extra AI agent controls
ALTER TABLE public.whatsapp_settings
  ADD COLUMN IF NOT EXISTS ai_blacklist text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS ai_knowledge_base text,
  ADD COLUMN IF NOT EXISTS ai_working_hours_start text,
  ADD COLUMN IF NOT EXISTS ai_working_hours_end text,
  ADD COLUMN IF NOT EXISTS ai_max_context_messages integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS ai_reply_delay_seconds integer NOT NULL DEFAULT 2;

-- 4) Enable realtime for conversations + messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.wa_conversations;
