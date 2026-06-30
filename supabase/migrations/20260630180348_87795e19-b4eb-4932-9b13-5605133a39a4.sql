-- Deduplicate existing rows that would block the unique index
WITH dups AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY user_id, session_id, provider_message_id
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM public.wa_messages
  WHERE provider_message_id IS NOT NULL
)
DELETE FROM public.wa_messages m
USING dups
WHERE m.id = dups.id AND dups.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS wa_messages_user_session_provider_uidx
  ON public.wa_messages (user_id, session_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;