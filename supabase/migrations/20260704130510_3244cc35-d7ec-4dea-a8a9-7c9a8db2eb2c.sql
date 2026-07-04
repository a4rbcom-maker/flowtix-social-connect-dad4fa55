CREATE OR REPLACE FUNCTION public.wa_normalize_phone(_value text, _default_country text DEFAULT '20')
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  cleaned text;
BEGIN
  IF _value IS NULL OR BTRIM(_value) = '' THEN
    RETURN NULL;
  END IF;

  cleaned := regexp_replace(BTRIM(_value), '[^0-9+]', '', 'g');
  IF cleaned LIKE '+%' THEN
    cleaned := substring(cleaned FROM 2);
  END IF;
  cleaned := regexp_replace(cleaned, '[^0-9]', '', 'g');
  IF cleaned LIKE '00%' THEN
    cleaned := substring(cleaned FROM 3);
  END IF;
  IF cleaned = '' THEN
    RETURN NULL;
  END IF;

  IF _default_country = '20' AND cleaned ~ '^01[0125][0-9]{8}$' THEN
    RETURN '20' || substring(cleaned FROM 2);
  END IF;
  IF _default_country = '20' AND cleaned ~ '^1[0125][0-9]{8}$' THEN
    RETURN '20' || cleaned;
  END IF;
  IF cleaned LIKE '0%' AND length(cleaned) >= 8 THEN
    RETURN _default_country || regexp_replace(cleaned, '^0+', '');
  END IF;

  RETURN cleaned;
END;
$function$;

UPDATE public.wa_conversations c
SET contact_phone = public.wa_normalize_phone(c.contact_phone),
    updated_at = now()
WHERE c.contact_phone IS NOT NULL
  AND c.contact_phone IS DISTINCT FROM public.wa_normalize_phone(c.contact_phone)
  AND NOT (
    c.remote_jid LIKE '%@lid'
    AND public.wa_normalize_phone(c.contact_phone) = split_part(c.remote_jid, '@', 1)
    AND length(split_part(c.remote_jid, '@', 1)) >= 14
  );

UPDATE public.wa_conversations c
SET contact_phone = public.wa_normalize_phone(split_part(c.remote_jid, '@', 1)),
    updated_at = now()
WHERE c.remote_jid LIKE '%@s.whatsapp.net'
  AND length(public.wa_normalize_phone(split_part(c.remote_jid, '@', 1))) BETWEEN 10 AND 13
  AND c.contact_phone IS DISTINCT FROM public.wa_normalize_phone(split_part(c.remote_jid, '@', 1));

UPDATE public.wa_conversations c
SET contact_phone = NULL,
    updated_at = now()
WHERE c.remote_jid LIKE '%@lid'
  AND public.wa_normalize_phone(c.contact_phone) = split_part(c.remote_jid, '@', 1)
  AND length(split_part(c.remote_jid, '@', 1)) >= 14;

WITH ranked AS (
  SELECT c.*,
         first_value(c.id) OVER w AS canonical_id,
         first_value(c.remote_jid) OVER w AS canonical_jid,
         row_number() OVER w AS rn
  FROM public.wa_conversations c
  WHERE c.contact_phone IS NOT NULL
    AND BTRIM(c.contact_phone) <> ''
    AND c.remote_jid NOT LIKE '%@g.us'
  WINDOW w AS (
    PARTITION BY c.user_id, c.session_id, c.contact_phone
    ORDER BY (c.remote_jid LIKE '%@lid') DESC,
             c.last_message_at DESC NULLS LAST,
             c.updated_at DESC NULLS LAST,
             c.created_at DESC NULLS LAST,
             c.id
  )
), dupes AS (
  SELECT * FROM ranked WHERE rn > 1
)
UPDATE public.wa_messages m
SET remote_jid = d.canonical_jid,
    from_phone = CASE
      WHEN m.direction = 'in' THEN COALESCE(public.wa_normalize_phone(m.from_phone), d.contact_phone)
      ELSE public.wa_normalize_phone(m.from_phone)
    END,
    to_phone = CASE
      WHEN m.direction = 'out' THEN COALESCE(public.wa_normalize_phone(m.to_phone), d.contact_phone)
      ELSE public.wa_normalize_phone(m.to_phone)
    END
FROM dupes d
WHERE m.user_id = d.user_id
  AND m.session_id = d.session_id
  AND m.remote_jid = d.remote_jid;

WITH ranked AS (
  SELECT c.*,
         first_value(c.id) OVER w AS canonical_id,
         row_number() OVER w AS rn
  FROM public.wa_conversations c
  WHERE c.contact_phone IS NOT NULL
    AND BTRIM(c.contact_phone) <> ''
    AND c.remote_jid NOT LIKE '%@g.us'
  WINDOW w AS (
    PARTITION BY c.user_id, c.session_id, c.contact_phone
    ORDER BY (c.remote_jid LIKE '%@lid') DESC,
             c.last_message_at DESC NULLS LAST,
             c.updated_at DESC NULLS LAST,
             c.created_at DESC NULLS LAST,
             c.id
  )
), rollup AS (
  SELECT canonical_id,
         max(contact_phone) AS phone,
         sum(COALESCE(unread_count, 0)) AS unread_total,
         (array_remove(array_agg(NULLIF(contact_name, '') ORDER BY last_message_at DESC NULLS LAST), NULL))[1] AS best_name,
         (array_remove(array_agg(profile_pic_url ORDER BY last_message_at DESC NULLS LAST), NULL))[1] AS best_pic
  FROM ranked
  GROUP BY canonical_id
)
UPDATE public.wa_conversations c
SET contact_phone = COALESCE(c.contact_phone, r.phone),
    contact_name = COALESCE(NULLIF(c.contact_name, ''), r.best_name),
    profile_pic_url = COALESCE(c.profile_pic_url, r.best_pic),
    unread_count = r.unread_total,
    updated_at = now()
FROM rollup r
WHERE c.id = r.canonical_id;

WITH ranked AS (
  SELECT c.id,
         row_number() OVER (
           PARTITION BY c.user_id, c.session_id, c.contact_phone
           ORDER BY (c.remote_jid LIKE '%@lid') DESC,
                    c.last_message_at DESC NULLS LAST,
                    c.updated_at DESC NULLS LAST,
                    c.created_at DESC NULLS LAST,
                    c.id
         ) AS rn
  FROM public.wa_conversations c
  WHERE c.contact_phone IS NOT NULL
    AND BTRIM(c.contact_phone) <> ''
    AND c.remote_jid NOT LIKE '%@g.us'
)
DELETE FROM public.wa_conversations c
USING ranked r
WHERE c.id = r.id
  AND r.rn > 1;

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

  IF NEW.remote_jid LIKE '%@g.us' THEN
    conv_phone := NULL;
  ELSE
    conv_phone := public.wa_normalize_phone(COALESCE(NEW.from_phone, NEW.to_phone));
    IF NEW.remote_jid LIKE '%@lid'
       AND conv_phone = split_part(NEW.remote_jid, '@', 1)
       AND length(split_part(NEW.remote_jid, '@', 1)) >= 14 THEN
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

SELECT public.wa_reconcile_conversation_order(NULL);