ALTER TABLE public.fb_text_templates
  ADD COLUMN IF NOT EXISTS media_ids uuid[] NOT NULL DEFAULT '{}';