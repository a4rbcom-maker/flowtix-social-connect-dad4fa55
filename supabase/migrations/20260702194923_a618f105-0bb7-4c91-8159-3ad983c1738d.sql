CREATE INDEX IF NOT EXISTS wa_messages_user_watime_desc_idx
ON public.wa_messages (user_id, wa_timestamp DESC NULLS LAST, created_at DESC);

CREATE INDEX IF NOT EXISTS wa_messages_user_session_remote_watime_desc_idx
ON public.wa_messages (user_id, session_id, remote_jid, wa_timestamp DESC NULLS LAST, created_at DESC);

CREATE INDEX IF NOT EXISTS wa_messages_user_remote_watime_desc_idx
ON public.wa_messages (user_id, remote_jid, wa_timestamp DESC NULLS LAST, created_at DESC);

CREATE OR REPLACE FUNCTION public.wa_sync_conversation_last_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  msg_at timestamptz;
BEGIN
  msg_at := COALESCE(NEW.wa_timestamp, NEW.created_at, now());

  UPDATE public.wa_conversations c
  SET last_message_at = msg_at,
      last_message_text = COALESCE(NEW.text_body, c.last_message_text),
      last_direction = COALESCE(NEW.direction, c.last_direction),
      updated_at = now()
  WHERE c.user_id = NEW.user_id
    AND c.session_id = NEW.session_id
    AND c.remote_jid = NEW.remote_jid
    AND c.last_message_at < msg_at;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.wa_reconcile_conversation_order(_user_id uuid DEFAULT NULL::uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  updated_rows integer;
BEGIN
  WITH ranked AS (
    SELECT DISTINCT ON (m.user_id, m.session_id, m.remote_jid)
           m.user_id,
           m.session_id,
           m.remote_jid,
           COALESCE(m.wa_timestamp, m.created_at) AS msg_at,
           m.text_body,
           m.direction
    FROM public.wa_messages m
    WHERE (_user_id IS NULL OR m.user_id = _user_id)
    ORDER BY m.user_id, m.session_id, m.remote_jid, COALESCE(m.wa_timestamp, m.created_at) DESC, m.created_at DESC
  )
  UPDATE public.wa_conversations c
  SET last_message_at = r.msg_at,
      last_message_text = COALESCE(r.text_body, c.last_message_text),
      last_direction = COALESCE(r.direction, c.last_direction),
      updated_at = now()
  FROM ranked r
  WHERE c.user_id = r.user_id
    AND c.session_id = r.session_id
    AND c.remote_jid = r.remote_jid
    AND (
      c.last_message_at IS DISTINCT FROM r.msg_at
      OR c.last_message_text IS DISTINCT FROM COALESCE(r.text_body, c.last_message_text)
      OR c.last_direction IS DISTINCT FROM COALESCE(r.direction, c.last_direction)
    );

  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  RETURN updated_rows;
END;
$function$;

SELECT public.wa_reconcile_conversation_order();