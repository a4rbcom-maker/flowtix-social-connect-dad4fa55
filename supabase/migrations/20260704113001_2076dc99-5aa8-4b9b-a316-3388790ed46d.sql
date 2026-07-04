-- Remove placeholder WhatsApp conversations created from chat/contact catalog rows
-- that do not have any stored messages behind them.
DELETE FROM public.wa_conversations c
WHERE COALESCE(BTRIM(c.last_message_text), '') = ''
  AND NOT EXISTS (
    SELECT 1
    FROM public.wa_messages m
    WHERE m.user_id = c.user_id
      AND m.session_id = c.session_id
      AND m.remote_jid = c.remote_jid
  );

-- Recreate the conversation upsert helper so catalogue/contact rows without
-- readable message content can enrich existing contacts, but can no longer
-- create or reorder empty conversations.
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
    AND r.preview_text IS NOT NULL
    AND (
      c.last_message_at IS DISTINCT FROM r.msg_at
      OR c.last_message_text IS DISTINCT FROM r.preview_text
      OR c.last_direction IS DISTINCT FROM COALESCE(r.direction, c.last_direction)
    );

  GET DIAGNOSTICS updated_rows = ROW_COUNT;
  RETURN updated_rows;
END;
$function$;

SELECT public.wa_reconcile_conversation_order(NULL);