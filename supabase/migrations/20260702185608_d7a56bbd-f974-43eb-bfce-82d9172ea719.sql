
-- 1) whatsapp_settings: per-user throttling & content rules
ALTER TABLE public.whatsapp_settings
  ADD COLUMN IF NOT EXISTS daily_message_cap int NOT NULL DEFAULT 500,
  ADD COLUMN IF NOT EXISTS messages_per_batch int NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS batch_rest_seconds int NOT NULL DEFAULT 300,
  ADD COLUMN IF NOT EXISTS jitter_min_seconds int NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS jitter_max_seconds int NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS enable_spintax boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS prioritize_existing_contacts boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS skip_after_failures int NOT NULL DEFAULT 2;

ALTER TABLE public.whatsapp_settings
  ALTER COLUMN max_concurrent_campaigns SET DEFAULT 1;

-- 2) wa_sessions: daily throttle state
ALTER TABLE public.wa_sessions
  ADD COLUMN IF NOT EXISTS daily_sent_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_sent_date date,
  ADD COLUMN IF NOT EXISTS batch_counter int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rest_until timestamptz;

-- 3) wa_invalid_phones: skip-list for numbers not on WhatsApp
CREATE TABLE IF NOT EXISTS public.wa_invalid_phones (
  user_id uuid NOT NULL,
  phone text NOT NULL,
  failure_count int NOT NULL DEFAULT 0,
  last_failure_at timestamptz NOT NULL DEFAULT now(),
  last_reason text,
  PRIMARY KEY (user_id, phone)
);

GRANT SELECT ON public.wa_invalid_phones TO authenticated;
GRANT ALL ON public.wa_invalid_phones TO service_role;

ALTER TABLE public.wa_invalid_phones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own invalid phones"
  ON public.wa_invalid_phones FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access invalid phones"
  ON public.wa_invalid_phones FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS wa_invalid_phones_user_idx ON public.wa_invalid_phones (user_id);

-- 4) global bridge rate-limit + circuit breaker config
INSERT INTO public.platform_settings (key, value, description)
VALUES (
  'bulk_rate_limit',
  jsonb_build_object(
    'global_msgs_per_second', 6,
    'circuit_breaker_failure_pct', 20,
    'circuit_breaker_window_min', 5,
    'circuit_breaker_pause_min', 15,
    'small_job_threshold', 20
  ),
  'الحد الأقصى العالمي لسرعة الإرسال عبر البريدج، وقواطع الحماية عند ارتفاع الفشل'
)
ON CONFLICT (key) DO NOTHING;

-- 5) shared circuit-breaker state row
INSERT INTO public.platform_settings (key, value, description)
VALUES (
  'bulk_circuit_state',
  jsonb_build_object('paused_until', null, 'last_check_at', null),
  'حالة قاطع الحماية العالمي للحملات الجماعية'
)
ON CONFLICT (key) DO NOTHING;
