ALTER TABLE public.wa_quick_replies
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'عام';

ALTER TABLE public.wa_messages
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'received';

CREATE INDEX IF NOT EXISTS wa_quick_replies_user_category_idx
  ON public.wa_quick_replies(user_id, category, sort_order);

CREATE INDEX IF NOT EXISTS wa_messages_provider_message_id_idx
  ON public.wa_messages(user_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS wa_messages_user_remote_status_idx
  ON public.wa_messages(user_id, remote_jid, status, created_at DESC);

UPDATE public.wa_messages
SET status = CASE
  WHEN direction = 'out' THEN 'sent'
  ELSE 'received'
END
WHERE status IS NULL OR status = 'received';