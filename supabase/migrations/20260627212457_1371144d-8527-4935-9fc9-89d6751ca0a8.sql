ALTER TABLE public.wa_conversations
  DROP CONSTRAINT IF EXISTS wa_conversations_user_id_remote_jid_key;

CREATE UNIQUE INDEX IF NOT EXISTS wa_conversations_user_session_remote_key
  ON public.wa_conversations (user_id, session_id, remote_jid);

CREATE INDEX IF NOT EXISTS idx_wa_conversations_user_session_last
  ON public.wa_conversations (user_id, session_id, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_wa_messages_user_session_remote_watime
  ON public.wa_messages (user_id, session_id, remote_jid, wa_timestamp);

CREATE INDEX IF NOT EXISTS idx_wa_messages_user_session_remote_created
  ON public.wa_messages (user_id, session_id, remote_jid, created_at DESC);