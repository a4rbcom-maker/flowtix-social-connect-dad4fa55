WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, provider_message_id
      ORDER BY wa_timestamp ASC NULLS LAST, created_at ASC, id ASC
    ) AS rn
  FROM public.wa_messages
  WHERE provider_message_id IS NOT NULL
)
DELETE FROM public.wa_messages m
USING ranked r
WHERE m.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS wa_messages_user_provider_uidx
  ON public.wa_messages (user_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;