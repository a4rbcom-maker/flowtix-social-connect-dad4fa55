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
  preview_text := COALESCE(
    NULLIF(BTRIM(NEW.text_body), ''),
    CASE
      WHEN NEW.msg_type IS NOT NULL AND NEW.msg_type <> 'text' THEN NEW.msg_type
      ELSE NULL
    END
  );

  -- Bot-Xtra/Baileys can emit text rows with an empty body for history sync or ACKs.
  -- These rows are transport metadata, not readable chat messages, so they must not
  -- become the conversation preview or move a thread to the top as "[text]".
  IF preview_text IS NULL THEN
    RETURN NEW;
  END IF;

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
    last_message_text = EXCLUDED.last_message_text,
    last_direction = COALESCE(EXCLUDED.last_direction, public.wa_conversations.last_direction),
    contact_phone = COALESCE(public.wa_conversations.contact_phone, EXCLUDED.contact_phone),
    updated_at = now()
  WHERE public.wa_conversations.last_message_at < EXCLUDED.last_message_at;

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
           COALESCE(
             NULLIF(BTRIM(m.text_body), ''),
             CASE WHEN m.msg_type IS NOT NULL AND m.msg_type <> 'text' THEN m.msg_type ELSE NULL END
           ) AS preview_text,
           m.direction
    FROM public.wa_messages m
    WHERE (_user_id IS NULL OR m.user_id = _user_id)
      AND (
        NULLIF(BTRIM(m.text_body), '') IS NOT NULL
        OR (m.msg_type IS NOT NULL AND m.msg_type <> 'text')
        OR NULLIF(BTRIM(COALESCE(m.media_url, '')), '') IS NOT NULL
      )
    ORDER BY m.user_id, m.session_id, m.remote_jid, COALESCE(m.wa_timestamp, m.created_at) DESC, m.created_at DESC
  )
  UPDATE public.wa_conversations c
  SET last_message_at = r.msg_at,
      last_message_text = r.preview_text,
      last_direction = COALESCE(r.direction, c.last_direction),
      updated_at = now()
  FROM ranked r
  WHERE c.user_id = r.user_id
    AND c.session_id = r.session_id
    AND c.remote_jid = r.remote_jid
    AND (
      c.last_message_at IS DISTINCT FROM r.msg_at
      OR c.last_message_text IS DISTINCT FROM r.preview_text
      OR c.last_direction IS DISTINCT FROM COALESCE(r.direction, c.last_direction)
    );

  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  RETURN updated_rows;
END;
$function$;

DELETE FROM public.wa_messages
WHERE msg_type = 'text'
  AND NULLIF(BTRIM(COALESCE(text_body, '')), '') IS NULL
  AND NULLIF(BTRIM(COALESCE(media_url, '')), '') IS NULL;

SELECT public.wa_reconcile_conversation_order(NULL);