
-- Extend enums
ALTER TYPE fb_job_status ADD VALUE IF NOT EXISTS 'paused';
ALTER TYPE fb_result_status ADD VALUE IF NOT EXISTS 'pending';

DO $$ BEGIN
  CREATE TYPE fb_campaign_status AS ENUM ('draft','queued','running','paused','completed','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE fb_campaign_content_type AS ENUM ('text','media');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE fb_campaign_target_kind AS ENUM ('groups','pages');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Text templates
CREATE TABLE IF NOT EXISTS public.fb_text_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  content text NOT NULL,
  tags text[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fb_text_templates_user_idx ON public.fb_text_templates(user_id, created_at DESC);
ALTER TABLE public.fb_text_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fb_text_templates select own" ON public.fb_text_templates FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "fb_text_templates insert own" ON public.fb_text_templates FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "fb_text_templates update own" ON public.fb_text_templates FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "fb_text_templates delete own" ON public.fb_text_templates FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER fb_text_templates_updated_at BEFORE UPDATE ON public.fb_text_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Media assets
CREATE TABLE IF NOT EXISTS public.fb_media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('image','video')),
  storage_path text NOT NULL,
  public_url text NOT NULL,
  name text NOT NULL,
  size_bytes bigint NOT NULL DEFAULT 0,
  mime_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fb_media_assets_user_idx ON public.fb_media_assets(user_id, created_at DESC);
ALTER TABLE public.fb_media_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fb_media_assets select own" ON public.fb_media_assets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "fb_media_assets insert own" ON public.fb_media_assets FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "fb_media_assets delete own" ON public.fb_media_assets FOR DELETE USING (auth.uid() = user_id);

-- Campaigns
CREATE TABLE IF NOT EXISTS public.fb_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid REFERENCES public.fb_bot_accounts(id) ON DELETE SET NULL,
  name text NOT NULL,
  content_type fb_campaign_content_type NOT NULL DEFAULT 'text',
  template_id uuid REFERENCES public.fb_text_templates(id) ON DELETE SET NULL,
  custom_text text,
  media_ids uuid[] DEFAULT '{}',
  target_kind fb_campaign_target_kind NOT NULL DEFAULT 'groups',
  target_ids text[] NOT NULL DEFAULT '{}',
  target_names jsonb DEFAULT '{}'::jsonb,
  delay_min_seconds integer NOT NULL DEFAULT 60 CHECK (delay_min_seconds >= 10),
  delay_max_seconds integer NOT NULL DEFAULT 120 CHECK (delay_max_seconds >= 10),
  status fb_campaign_status NOT NULL DEFAULT 'draft',
  total_targets integer NOT NULL DEFAULT 0,
  done_targets integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  last_job_id uuid,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fb_campaigns_delay_range CHECK (delay_max_seconds >= delay_min_seconds)
);
CREATE INDEX IF NOT EXISTS fb_campaigns_user_idx ON public.fb_campaigns(user_id, created_at DESC);
ALTER TABLE public.fb_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fb_campaigns select own" ON public.fb_campaigns FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "fb_campaigns insert own" ON public.fb_campaigns FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "fb_campaigns update own" ON public.fb_campaigns FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "fb_campaigns delete own" ON public.fb_campaigns FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER fb_campaigns_updated_at BEFORE UPDATE ON public.fb_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.fb_jobs ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES public.fb_campaigns(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS fb_jobs_campaign_idx ON public.fb_jobs(campaign_id) WHERE campaign_id IS NOT NULL;

-- Storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('fb-media', 'fb-media', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "fb-media public read" ON storage.objects FOR SELECT USING (bucket_id = 'fb-media');
CREATE POLICY "fb-media user upload" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'fb-media' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "fb-media user delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'fb-media' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Realtime for fb_campaigns (others already in publication)
ALTER PUBLICATION supabase_realtime ADD TABLE public.fb_campaigns;
