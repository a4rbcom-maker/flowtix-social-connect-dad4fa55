CREATE INDEX IF NOT EXISTS wa_messages_user_timestamp_idx
ON public.wa_messages (user_id, wa_timestamp DESC NULLS LAST, created_at DESC);

CREATE INDEX IF NOT EXISTS wa_conversations_user_visible_time_idx
ON public.wa_conversations (user_id, is_archived, last_message_at DESC NULLS LAST);

ANALYZE public.wa_messages;
ANALYZE public.wa_conversations;