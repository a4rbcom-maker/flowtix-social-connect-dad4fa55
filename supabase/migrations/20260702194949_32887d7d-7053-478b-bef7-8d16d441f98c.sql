CREATE OR REPLACE FUNCTION public.wa_sync_conversation_last_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  msg_at timestamptz;
  preview_text text;
BEGIN
  msg_at := COALESCE(NEW.wa_timestamp, NEW.created_at, now());
  preview_text := COALESCE(NULLIF(NEW.text_body, ''), CASE WHEN NEW.msg_type IS NOT NULL AND NEW.msg_type <> 'text' THEN NEW.msg_type ELSE NULL END);

  INSERT INTO public.wa_conversations (
    user_id,
    session_id,
    remote_jid,
    contact_phone,
    last_message_text,
    last_message_at,
    last_direction,
    unread_count,
    updated_at
  ) VALUES (
    NEW.user_id,
    NEW.session_id,
    NEW.remote_jid,
    CASE WHEN NEW.remote_jid LIKE '%@g.us' THEN NULL ELSE COALESCE(NEW.from_phone, NEW.to_phone) END,
    preview_text,
    msg_at,
    COALESCE(NEW.direction, 'in'),
    CASE WHEN NEW.direction = 'in' THEN 1 ELSE 0 END,
    now()
  )
  ON CONFLICT (user_id, session_id, remote_jid)
  DO UPDATE SET
    last_message_at = EXCLUDED.last_message_at,
    last_message_text = COALESCE(EXCLUDED.last_message_text, public.wa_conversations.last_message_text),
    last_direction = COALESCE(EXCLUDED.last_direction, public.wa_conversations.last_direction),
    contact_phone = COALESCE(public.wa_conversations.contact_phone, EXCLUDED.contact_phone),
    updated_at = now()
  WHERE public.wa_conversations.last_message_at < EXCLUDED.last_message_at;

  RETURN NEW;
END;
$function$;

SELECT public.wa_reconcile_conversation_order();