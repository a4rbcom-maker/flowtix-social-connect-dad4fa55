
CREATE TYPE public.wa_keyword_match_mode AS ENUM ('exact', 'contains');

CREATE TABLE public.wa_keyword_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label text NOT NULL,
  keywords text[] NOT NULL DEFAULT '{}',
  match_mode public.wa_keyword_match_mode NOT NULL DEFAULT 'contains',
  reply_text text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 0,
  hit_count integer NOT NULL DEFAULT 0,
  last_hit_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_keyword_rules TO authenticated;
GRANT ALL ON public.wa_keyword_rules TO service_role;

ALTER TABLE public.wa_keyword_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own keyword rules"
  ON public.wa_keyword_rules FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX wa_keyword_rules_user_enabled_idx
  ON public.wa_keyword_rules(user_id, enabled, priority DESC);

CREATE TRIGGER set_wa_keyword_rules_updated_at
  BEFORE UPDATE ON public.wa_keyword_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


CREATE TABLE public.wa_quick_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shortcut text NOT NULL,
  body text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_quick_replies TO authenticated;
GRANT ALL ON public.wa_quick_replies TO service_role;

ALTER TABLE public.wa_quick_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own quick replies"
  ON public.wa_quick_replies FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX wa_quick_replies_user_idx
  ON public.wa_quick_replies(user_id, sort_order);

CREATE TRIGGER set_wa_quick_replies_updated_at
  BEFORE UPDATE ON public.wa_quick_replies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
