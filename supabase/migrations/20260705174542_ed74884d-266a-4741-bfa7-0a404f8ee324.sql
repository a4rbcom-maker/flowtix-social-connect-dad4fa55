
CREATE INDEX IF NOT EXISTS wa_messages_user_from_phone_watime_idx
  ON public.wa_messages (user_id, from_phone, wa_timestamp DESC NULLS LAST, created_at DESC)
  WHERE from_phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS wa_messages_user_to_phone_watime_idx
  ON public.wa_messages (user_id, to_phone, wa_timestamp DESC NULLS LAST, created_at DESC)
  WHERE to_phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS wa_session_events_user_status_created_idx
  ON public.wa_session_events (user_id, to_status, created_at DESC);

ANALYZE public.wa_messages;
ANALYZE public.wa_session_events;
