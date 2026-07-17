
ALTER TYPE public.fb_job_type ADD VALUE IF NOT EXISTS 'messenger_list_pages';
ALTER TYPE public.fb_job_type ADD VALUE IF NOT EXISTS 'messenger_sync_cookies';
ALTER TYPE public.fb_job_type ADD VALUE IF NOT EXISTS 'messenger_send_cookies';

ALTER TABLE public.messenger_contacts
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'graph_api';

CREATE INDEX IF NOT EXISTS messenger_contacts_source_idx
  ON public.messenger_contacts (user_id, page_id, source);
