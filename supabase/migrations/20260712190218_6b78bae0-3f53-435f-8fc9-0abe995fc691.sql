-- Draft selection for the "new campaign" builder. One row per user.
-- Lets group selections persist across devices/sessions, not just localStorage.
CREATE TABLE IF NOT EXISTS public.fb_campaign_drafts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  selected_ids text[] NOT NULL DEFAULT '{}',
  groups jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fb_campaign_drafts TO authenticated;
GRANT ALL ON public.fb_campaign_drafts TO service_role;

ALTER TABLE public.fb_campaign_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own campaign draft"
  ON public.fb_campaign_drafts
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP TRIGGER IF EXISTS trg_fb_campaign_drafts_updated_at ON public.fb_campaign_drafts;
CREATE TRIGGER trg_fb_campaign_drafts_updated_at
  BEFORE UPDATE ON public.fb_campaign_drafts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();