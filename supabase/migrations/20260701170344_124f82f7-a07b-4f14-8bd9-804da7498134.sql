UPDATE public.wa_conversations AS c
SET contact_name = NULL,
    updated_at = now()
WHERE c.contact_name IS NOT NULL
  AND btrim(c.contact_name) <> ''
  AND c.remote_jid NOT LIKE '%@g.us'
  AND EXISTS (
    SELECT 1
    FROM public.wa_messages AS m
    WHERE m.user_id = c.user_id
      AND m.session_id = c.session_id
      AND m.remote_jid = c.remote_jid
      AND m.direction = 'out'
      AND lower(coalesce(m.raw->>'pushName', m.raw->>'senderName', m.raw->>'notifyName')) = lower(c.contact_name)
      AND lower(coalesce(m.raw->>'fromMe', 'true')) IN ('true', '1', 'yes')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.wa_messages AS mi
    WHERE mi.user_id = c.user_id
      AND mi.session_id = c.session_id
      AND mi.remote_jid = c.remote_jid
      AND mi.direction = 'in'
      AND lower(coalesce(mi.raw->>'pushName', mi.raw->>'senderName', mi.raw->>'notifyName', mi.raw->>'contactName', mi.raw->>'name')) = lower(c.contact_name)
  );