
CREATE OR REPLACE FUNCTION public.wa_sync_conversation_last_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  msg_at timestamptz;
  preview_text text;
  conv_phone text;
  existing_id uuid;
  existing_remote text;
  existing_unread integer;
  next_remote text;
  local_part text;
  is_lid_alias boolean;
BEGIN
  msg_at := COALESCE(NEW.wa_timestamp, NEW.created_at, now());
  preview_text := COALESCE(
    NULLIF(BTRIM(NEW.text_body), ''),
    CASE
      WHEN NEW.msg_type IS NOT NULL AND NEW.msg_type <> 'text' THEN NEW.msg_type
      ELSE NULL
    END
  );

  IF preview_text IS NULL THEN
    RETURN NEW;
  END IF;

  local_part := split_part(NEW.remote_jid, '@', 1);
  is_lid_alias := local_part ~ '^[0-9]{14,}$';

  IF NEW.remote_jid LIKE '%@g.us' THEN
    conv_phone := NULL;
  ELSE
    conv_phone := public.wa_normalize_phone(COALESCE(NEW.from_phone, NEW.to_phone));
    IF is_lid_alias AND conv_phone = local_part THEN
      conv_phone := NULL;
    END IF;
  END IF;

  SELECT c.id, c.remote_jid, c.unread_count
  INTO existing_id, existing_remote, existing_unread
  FROM public.wa_conversations c
  WHERE c.user_id = NEW.user_id
    AND c.session_id = NEW.session_id
    AND (
      c.remote_jid = NEW.remote_jid
      OR (conv_phone IS NOT NULL AND c.contact_phone = conv_phone)
      OR (conv_phone IS NOT NULL AND c.remote_jid = conv_phone || '@s.whatsapp.net')
      -- NEW: treat @lid and @s.whatsapp.net variants of the same LID-alias
      -- local part as the SAME conversation. Prevents split rows like
      -- 213438785687694@lid vs 213438785687694@s.whatsapp.net.
      OR (is_lid_alias AND split_part(c.remote_jid, '@', 1) = local_part)
    )
  ORDER BY (c.remote_jid LIKE '%@lid') DESC,
           (c.remote_jid = NEW.remote_jid) DESC,
           c.last_message_at DESC NULLS LAST,
           c.updated_at DESC NULLS LAST
  LIMIT 1;

  IF existing_id IS NOT NULL THEN
    next_remote := existing_remote;
    IF NEW.remote_jid LIKE '%@lid'
       AND existing_remote NOT LIKE '%@lid'
       AND NOT EXISTS (
         SELECT 1
         FROM public.wa_conversations other
         WHERE other.user_id = NEW.user_id
           AND other.session_id = NEW.session_id
           AND other.remote_jid = NEW.remote_jid
           AND other.id <> existing_id
       ) THEN
      next_remote := NEW.remote_jid;
    END IF;

    UPDATE public.wa_conversations c
    SET remote_jid = next_remote,
        contact_phone = COALESCE(c.contact_phone, conv_phone),
        last_message_at = CASE WHEN c.last_message_at <= msg_at THEN msg_at ELSE c.last_message_at END,
        last_message_text = CASE WHEN c.last_message_at <= msg_at THEN preview_text ELSE c.last_message_text END,
        last_direction = CASE WHEN c.last_message_at <= msg_at THEN COALESCE(NEW.direction, c.last_direction) ELSE c.last_direction END,
        unread_count = CASE WHEN NEW.direction = 'in' THEN COALESCE(existing_unread, 0) + 1 ELSE COALESCE(existing_unread, 0) END,
        updated_at = now()
    WHERE c.id = existing_id;
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
    conv_phone,
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

-- One-off merge for existing duplicate LID/@s.whatsapp.net conversation pairs.
WITH pairs AS (
  SELECT
    lid.id  AS keep_id,
    plain.id AS drop_id,
    lid.user_id,
    lid.session_id
  FROM public.wa_conversations lid
  JOIN public.wa_conversations plain
    ON plain.user_id = lid.user_id
   AND plain.session_id = lid.session_id
   AND plain.id <> lid.id
   AND plain.remote_jid LIKE '%@s.whatsapp.net'
   AND lid.remote_jid   LIKE '%@lid'
   AND split_part(plain.remote_jid, '@', 1) = split_part(lid.remote_jid, '@', 1)
   AND split_part(lid.remote_jid, '@', 1) ~ '^[0-9]{14,}$'
),
updated_conv AS (
  UPDATE public.wa_conversations c
  SET unread_count      = c.unread_count + COALESCE(dp.unread_count, 0),
      last_message_at   = GREATEST(c.last_message_at,   dp.last_message_at),
      last_message_text = CASE WHEN dp.last_message_at > c.last_message_at THEN dp.last_message_text ELSE c.last_message_text END,
      last_direction    = CASE WHEN dp.last_message_at > c.last_message_at THEN dp.last_direction    ELSE c.last_direction    END,
      contact_phone     = COALESCE(c.contact_phone, dp.contact_phone),
      contact_name      = COALESCE(c.contact_name,  dp.contact_name),
      profile_pic_url   = COALESCE(c.profile_pic_url, dp.profile_pic_url),
      updated_at        = now()
  FROM pairs p
  JOIN public.wa_conversations dp ON dp.id = p.drop_id
  WHERE c.id = p.keep_id
  RETURNING c.id
)
DELETE FROM public.wa_conversations d
USING pairs p
WHERE d.id = p.drop_id;
