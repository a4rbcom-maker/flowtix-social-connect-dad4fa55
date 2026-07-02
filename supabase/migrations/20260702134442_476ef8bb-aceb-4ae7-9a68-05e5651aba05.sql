ALTER TABLE public.wa_conversations
  ADD COLUMN IF NOT EXISTS profile_pic_url text;

-- Free heavy TOASTed JSONB payloads that are no longer read from the inbox path.
UPDATE public.wa_messages SET raw = NULL WHERE raw IS NOT NULL;