
-- Fix wrong model_name (gpt-4o-mini isn't supported by our provider)
UPDATE public.ai_model_tiers SET model_name = 'gemini-2.5-pro' WHERE model_name = 'gpt-4o-mini';

-- Seed additional models per tier (idempotent via ON CONFLICT on tier+model_name)
-- Add unique constraint if missing
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_model_tiers_tier_model_name_key'
  ) THEN
    ALTER TABLE public.ai_model_tiers
      ADD CONSTRAINT ai_model_tiers_tier_model_name_key UNIQUE (tier, model_name);
  END IF;
END $$;

INSERT INTO public.ai_model_tiers (tier, model_name, display_name_ar, display_name_en, description, max_tokens, temperature, sort_order, enabled) VALUES
  -- Simple tier: fastest/cheapest
  ('simple', 'gemini-2.5-flash',  'Gemini 2.5 Flash',     'Gemini 2.5 Flash',     'سريع وموفّر — مناسب للأسئلة الشائعة',     512, 0.5, 1, true),
  ('simple', 'gemini-3-flash',    'Gemini 3 Flash',       'Gemini 3 Flash',       'أحدث موديل سريع من جوجل',                    512, 0.5, 3, true),
  ('simple', 'gpt-5-2',           'GPT-5 Mini',           'GPT-5 Mini',           'موديل OpenAI اقتصادي وسريع',                 512, 0.6, 4, true),

  -- Smart tier: general chat
  ('smart',  'gemini-2.5-flash',  'Gemini 2.5 Flash',     'Gemini 2.5 Flash',     'متوازن بين السرعة والجودة',                 1024, 0.7, 1, true),
  ('smart',  'gemini-2.5-pro',    'Gemini 2.5 Pro',       'Gemini 2.5 Pro',       'فهم ممتاز للسياق العربي',                    1024, 0.7, 3, true),
  ('smart',  'gemini-3-flash',    'Gemini 3 Flash',       'Gemini 3 Flash',       'أحدث موديل — سريع وذكي',                     1024, 0.7, 4, true),
  ('smart',  'gpt-5-2',           'GPT-5',                'GPT-5',                'قوي في الردود الطبيعية',                     1024, 0.7, 5, true),

  -- Negotiation tier: strongest reasoning
  ('negotiation', 'gemini-2.5-pro',   'Gemini 2.5 Pro',      'Gemini 2.5 Pro',      'إقناع وتفاوض احترافي',                   2048, 0.8, 1, true),
  ('negotiation', 'gemini-3-1-pro',   'Gemini 3.1 Pro',      'Gemini 3.1 Pro',      'أحدث موديل استدلال متقدّم من جوجل',       2048, 0.8, 3, true),
  ('negotiation', 'gpt-5-2',          'GPT-5',               'GPT-5',               'قوة إقناع عالية من OpenAI',              2048, 0.85, 4, true)
ON CONFLICT (tier, model_name) DO UPDATE SET
  display_name_ar = EXCLUDED.display_name_ar,
  display_name_en = EXCLUDED.display_name_en,
  description     = EXCLUDED.description,
  enabled         = true,
  updated_at      = now();
