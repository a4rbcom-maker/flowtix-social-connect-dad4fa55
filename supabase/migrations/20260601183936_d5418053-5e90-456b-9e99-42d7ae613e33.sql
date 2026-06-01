
-- ENUMs
CREATE TYPE public.ai_account_status AS ENUM ('active','exhausted','disabled','error');
CREATE TYPE public.ai_model_tier AS ENUM ('simple','smart','negotiation');

-- 1) ai_provider_accounts
CREATE TABLE public.ai_provider_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  provider text NOT NULL DEFAULT 'kie',
  api_key_encrypted text NOT NULL,
  key_hint text,
  status public.ai_account_status NOT NULL DEFAULT 'active',
  priority int NOT NULL DEFAULT 100,
  requests_count bigint NOT NULL DEFAULT 0,
  failed_count bigint NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  last_error_at timestamptz,
  last_error_message text,
  cooldown_until timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_provider_accounts TO authenticated;
GRANT ALL ON public.ai_provider_accounts TO service_role;

ALTER TABLE public.ai_provider_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage ai accounts" ON public.ai_provider_accounts
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_ai_accounts_updated
  BEFORE UPDATE ON public.ai_provider_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) ai_model_tiers
CREATE TABLE public.ai_model_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier public.ai_model_tier NOT NULL,
  model_name text NOT NULL,
  display_name_ar text NOT NULL,
  display_name_en text NOT NULL,
  description text,
  enabled boolean NOT NULL DEFAULT true,
  max_tokens int NOT NULL DEFAULT 1024,
  temperature numeric(3,2) NOT NULL DEFAULT 0.7,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tier, model_name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_model_tiers TO authenticated;
GRANT ALL ON public.ai_model_tiers TO service_role;

ALTER TABLE public.ai_model_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated reads enabled tiers" ON public.ai_model_tiers
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage tiers" ON public.ai_model_tiers
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_ai_tiers_updated
  BEFORE UPDATE ON public.ai_model_tiers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed default models
INSERT INTO public.ai_model_tiers (tier, model_name, display_name_ar, display_name_en, description, max_tokens, temperature, sort_order) VALUES
  ('simple', 'gpt-4o-mini', 'GPT-4o Mini (سريع واقتصادي)', 'GPT-4o Mini (Fast & cheap)', 'مثالي للردود القصيرة والترحيب', 512, 0.6, 1),
  ('simple', 'gemini-2.0-flash', 'Gemini 2.0 Flash', 'Gemini 2.0 Flash', 'سريع جداً ومناسب للأسئلة البسيطة', 512, 0.6, 2),
  ('smart',  'gpt-4o', 'GPT-4o', 'GPT-4o', 'متوازن للمحادثات الذكية المتوسطة', 1024, 0.7, 1),
  ('smart',  'claude-3-5-sonnet', 'Claude 3.5 Sonnet', 'Claude 3.5 Sonnet', 'فهم ممتاز للسياق العربي', 1024, 0.7, 2),
  ('negotiation', 'claude-3-5-sonnet', 'Claude 3.5 Sonnet (تفاوض)', 'Claude 3.5 Sonnet (Negotiation)', 'تفاوض ذكي على الأسعار', 2048, 0.8, 1),
  ('negotiation', 'gpt-4o', 'GPT-4o (تفاوض)', 'GPT-4o (Negotiation)', 'إقناع وتفاوض احترافي', 2048, 0.8, 2);

-- 3) ai_usage_logs
CREATE TABLE public.ai_usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES public.ai_provider_accounts(id) ON DELETE SET NULL,
  user_id uuid,
  tier public.ai_model_tier,
  model text,
  tokens_in int,
  tokens_out int,
  latency_ms int,
  status text NOT NULL DEFAULT 'success',
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_usage_logs_created ON public.ai_usage_logs(created_at DESC);
CREATE INDEX idx_ai_usage_logs_user ON public.ai_usage_logs(user_id, created_at DESC);
CREATE INDEX idx_ai_usage_logs_account ON public.ai_usage_logs(account_id, created_at DESC);

GRANT SELECT, INSERT ON public.ai_usage_logs TO authenticated;
GRANT ALL ON public.ai_usage_logs TO service_role;

ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own usage" ON public.ai_usage_logs
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "Service inserts usage" ON public.ai_usage_logs
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));

-- 4) whatsapp_settings additions
ALTER TABLE public.whatsapp_settings
  ADD COLUMN IF NOT EXISTS ai_provider text NOT NULL DEFAULT 'kie',
  ADD COLUMN IF NOT EXISTS ai_tier_simple text,
  ADD COLUMN IF NOT EXISTS ai_tier_smart text,
  ADD COLUMN IF NOT EXISTS ai_tier_negotiation text,
  ADD COLUMN IF NOT EXISTS ai_default_tier public.ai_model_tier NOT NULL DEFAULT 'smart';
