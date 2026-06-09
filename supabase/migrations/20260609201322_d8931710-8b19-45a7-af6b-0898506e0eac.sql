
-- ===== fb_pages =====
CREATE TYPE public.fb_page_connection_type AS ENUM ('official', 'bot');
CREATE TYPE public.fb_page_status AS ENUM ('active', 'expired', 'disconnected');

CREATE TABLE public.fb_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page_id text NOT NULL,
  page_name text NOT NULL,
  avatar_url text,
  connection_type public.fb_page_connection_type NOT NULL,
  access_token_encrypted text,
  bot_account_id uuid REFERENCES public.fb_bot_accounts(id) ON DELETE SET NULL,
  status public.fb_page_status NOT NULL DEFAULT 'active',
  webhook_subscribed boolean NOT NULL DEFAULT false,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, page_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fb_pages TO authenticated;
GRANT ALL ON public.fb_pages TO service_role;
ALTER TABLE public.fb_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own fb pages" ON public.fb_pages FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "service role full fb pages" ON public.fb_pages FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE TRIGGER fb_pages_updated BEFORE UPDATE ON public.fb_pages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX fb_pages_user_idx ON public.fb_pages(user_id);
CREATE INDEX fb_pages_page_idx ON public.fb_pages(page_id);

-- ===== fb_autoreply_rules =====
CREATE TYPE public.fb_autoreply_scope AS ENUM ('specific_post', 'all_posts');
CREATE TYPE public.fb_autoreply_trigger AS ENUM ('keywords', 'any_comment');
CREATE TYPE public.fb_autoreply_match_mode AS ENUM ('any', 'all', 'exact');

CREATE TABLE public.fb_autoreply_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page_id uuid NOT NULL REFERENCES public.fb_pages(id) ON DELETE CASCADE,
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  scope public.fb_autoreply_scope NOT NULL DEFAULT 'all_posts',
  post_id text,
  trigger_type public.fb_autoreply_trigger NOT NULL DEFAULT 'keywords',
  keywords text[] NOT NULL DEFAULT '{}',
  match_mode public.fb_autoreply_match_mode NOT NULL DEFAULT 'any',
  reply_comment_enabled boolean NOT NULL DEFAULT true,
  reply_comment_text text,
  reply_dm_enabled boolean NOT NULL DEFAULT false,
  reply_dm_text text,
  reply_dm_buttons jsonb,
  ignore_admin_comments boolean NOT NULL DEFAULT true,
  dedupe_per_user boolean NOT NULL DEFAULT true,
  detect_spam boolean NOT NULL DEFAULT true,
  priority int NOT NULL DEFAULT 0,
  cooldown_seconds int NOT NULL DEFAULT 0,
  match_count bigint NOT NULL DEFAULT 0,
  last_matched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fb_autoreply_rules TO authenticated;
GRANT ALL ON public.fb_autoreply_rules TO service_role;
ALTER TABLE public.fb_autoreply_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own autoreply rules" ON public.fb_autoreply_rules FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "service role full autoreply rules" ON public.fb_autoreply_rules FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE TRIGGER fb_autoreply_rules_updated BEFORE UPDATE ON public.fb_autoreply_rules FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX fb_autoreply_rules_page_enabled_idx ON public.fb_autoreply_rules(page_id, enabled);
CREATE INDEX fb_autoreply_rules_user_idx ON public.fb_autoreply_rules(user_id);

-- ===== fb_autoreply_log =====
CREATE TYPE public.fb_autoreply_action AS ENUM ('comment', 'dm', 'both', 'skipped');
CREATE TYPE public.fb_autoreply_status AS ENUM ('success', 'failed', 'skipped');

CREATE TABLE public.fb_autoreply_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rule_id uuid REFERENCES public.fb_autoreply_rules(id) ON DELETE SET NULL,
  page_id uuid NOT NULL REFERENCES public.fb_pages(id) ON DELETE CASCADE,
  post_id text,
  comment_id text NOT NULL,
  commenter_id text,
  commenter_name text,
  comment_text text,
  action_taken public.fb_autoreply_action NOT NULL DEFAULT 'skipped',
  skip_reason text,
  status public.fb_autoreply_status NOT NULL DEFAULT 'success',
  error_message text,
  fb_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.fb_autoreply_log TO authenticated;
GRANT ALL ON public.fb_autoreply_log TO service_role;
ALTER TABLE public.fb_autoreply_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own autoreply log" ON public.fb_autoreply_log FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "service role full autoreply log" ON public.fb_autoreply_log FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX fb_autoreply_log_user_idx ON public.fb_autoreply_log(user_id, created_at DESC);
CREATE INDEX fb_autoreply_log_rule_idx ON public.fb_autoreply_log(rule_id, created_at DESC);
CREATE INDEX fb_autoreply_log_page_idx ON public.fb_autoreply_log(page_id, created_at DESC);
CREATE UNIQUE INDEX fb_autoreply_log_dedupe_idx ON public.fb_autoreply_log(rule_id, comment_id) WHERE rule_id IS NOT NULL AND status = 'success';
