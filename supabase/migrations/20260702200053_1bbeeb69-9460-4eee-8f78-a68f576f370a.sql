CREATE INDEX IF NOT EXISTS wa_messages_user_provider_message_id_idx
ON public.wa_messages (user_id, provider_message_id)
WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS wa_messages_user_remote_created_from_phone_idx
ON public.wa_messages (user_id, remote_jid, created_at DESC)
WHERE from_phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS wa_conversations_user_contact_phone_named_idx
ON public.wa_conversations (user_id, contact_phone)
WHERE contact_phone IS NOT NULL AND contact_name IS NOT NULL;