ALTER TABLE public.wa_conversations
  ADD COLUMN IF NOT EXISTS agent_active_until timestamptz;

CREATE INDEX IF NOT EXISTS wa_conversations_agent_active_until_idx
  ON public.wa_conversations (user_id, session_id, remote_jid)
  WHERE agent_active_until IS NOT NULL;