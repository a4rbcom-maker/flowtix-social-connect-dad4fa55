
-- messenger_contacts: one row per (user_id, page_id, psid)
CREATE TABLE public.messenger_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page_id text NOT NULL,
  page_name text,
  psid text NOT NULL,
  conversation_id text,
  full_name text,
  profile_pic_url text,
  first_message_at timestamptz,
  last_message_at timestamptz,
  messages_count integer NOT NULL DEFAULT 0,
  unread_count integer NOT NULL DEFAULT 0,
  last_direction text CHECK (last_direction IN ('in','out')),
  last_message_preview text,
  last_agent_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, page_id, psid)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.messenger_contacts TO authenticated;
GRANT ALL ON public.messenger_contacts TO service_role;

ALTER TABLE public.messenger_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own messenger contacts"
  ON public.messenger_contacts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX messenger_contacts_user_page_last_idx
  ON public.messenger_contacts (user_id, page_id, last_message_at DESC NULLS LAST);
CREATE INDEX messenger_contacts_user_last_idx
  ON public.messenger_contacts (user_id, last_message_at DESC NULLS LAST);
CREATE INDEX messenger_contacts_tags_idx
  ON public.messenger_contacts USING GIN (tags);
CREATE INDEX messenger_contacts_name_trgm_idx
  ON public.messenger_contacts USING GIN (full_name extensions.gin_trgm_ops)
  WHERE full_name IS NOT NULL;

CREATE TRIGGER messenger_contacts_updated_at
  BEFORE UPDATE ON public.messenger_contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- messenger_sync_jobs: track each sync run per page
CREATE TABLE public.messenger_sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page_id text NOT NULL,
  page_name text,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','completed','failed')),
  mode text NOT NULL DEFAULT 'incremental'
    CHECK (mode IN ('initial','incremental')),
  started_at timestamptz,
  finished_at timestamptz,
  contacts_upserted integer NOT NULL DEFAULT 0,
  messages_scanned integer NOT NULL DEFAULT 0,
  conversations_scanned integer NOT NULL DEFAULT 0,
  cursor text,
  error_message text,
  triggered_by text NOT NULL DEFAULT 'manual'
    CHECK (triggered_by IN ('manual','cron','webhook')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.messenger_sync_jobs TO authenticated;
GRANT ALL ON public.messenger_sync_jobs TO service_role;

ALTER TABLE public.messenger_sync_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own messenger sync jobs"
  ON public.messenger_sync_jobs FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX messenger_sync_jobs_user_page_idx
  ON public.messenger_sync_jobs (user_id, page_id, created_at DESC);
CREATE INDEX messenger_sync_jobs_running_idx
  ON public.messenger_sync_jobs (status) WHERE status IN ('queued','running');

CREATE TRIGGER messenger_sync_jobs_updated_at
  BEFORE UPDATE ON public.messenger_sync_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
