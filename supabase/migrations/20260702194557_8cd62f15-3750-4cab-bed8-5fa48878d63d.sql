-- Ensure wa_conversations.last_message_at always reflects the true latest wa_messages timestamp,
-- so inbox ordering never drifts from the actual last WhatsApp message.

CREATE OR REPLACE FUNCTION public.wa_sync_conversation_last_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  msg_at timestamptz;
BEGIN
  msg_at := COALESCE(NEW.wa_timestamp, NEW.created_at, now());

  UPDATE public.wa_conversations c
  SET last_message_at = msg_at,
      last_message_text = COALESCE(NEW.text_body, c.last_message_text),
      last_direction = COALESCE(NEW.direction, c.last_direction),
      updated_at = now()
  WHERE c.session_id = NEW.session_id
    AND c.remote_jid = NEW.remote_jid
    AND (c.last_message_at IS NULL OR c.last_message_at < msg_at);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wa_sync_conversation_last_message ON public.wa_messages;
CREATE TRIGGER trg_wa_sync_conversation_last_message
AFTER INSERT OR UPDATE OF wa_timestamp, created_at, text_body, direction
ON public.wa_messages
FOR EACH ROW
EXECUTE FUNCTION public.wa_sync_conversation_last_message();

-- One-shot reconciliation function callable on demand to fix any historical drift.
CREATE OR REPLACE FUNCTION public.wa_reconcile_conversation_order(_user_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_rows integer;
BEGIN
  WITH latest AS (
    SELECT m.session_id,
           m.remote_jid,
           MAX(COALESCE(m.wa_timestamp, m.created_at)) AS max_at
    FROM public.wa_messages m
    GROUP BY m.session_id, m.remote_jid
  )
  UPDATE public.wa_conversations c
  SET last_message_at = l.max_at,
      updated_at = now()
  FROM latest l
  WHERE c.session_id = l.session_id
    AND c.remote_jid = l.remote_jid
    AND (_user_id IS NULL OR c.user_id = _user_id)
    AND (c.last_message_at IS DISTINCT FROM l.max_at);

  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  RETURN updated_rows;
END;
$$;

GRANT EXECUTE ON FUNCTION public.wa_reconcile_conversation_order(uuid) TO authenticated, service_role;

-- Run once now to align existing rows.
SELECT public.wa_reconcile_conversation_order(NULL);
