WITH ranked AS (
  SELECT DISTINCT ON (m.user_id, m.session_id, m.remote_jid)
         m.user_id,
         m.session_id,
         m.remote_jid,
         CASE WHEN m.remote_jid LIKE '%@g.us' THEN NULL ELSE COALESCE(m.from_phone, m.to_phone) END AS contact_phone,
         COALESCE(NULLIF(m.text_body, ''), CASE WHEN m.msg_type IS NOT NULL AND m.msg_type <> 'text' THEN m.msg_type ELSE NULL END) AS last_message_text,
         COALESCE(m.wa_timestamp, m.created_at) AS last_message_at,
         COALESCE(m.direction, 'in') AS last_direction
  FROM public.wa_messages m
  ORDER BY m.user_id, m.session_id, m.remote_jid, COALESCE(m.wa_timestamp, m.created_at) DESC, m.created_at DESC
)
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
)
SELECT
  r.user_id,
  r.session_id,
  r.remote_jid,
  r.contact_phone,
  r.last_message_text,
  r.last_message_at,
  r.last_direction,
  0,
  now()
FROM ranked r
ON CONFLICT (user_id, session_id, remote_jid) DO NOTHING;