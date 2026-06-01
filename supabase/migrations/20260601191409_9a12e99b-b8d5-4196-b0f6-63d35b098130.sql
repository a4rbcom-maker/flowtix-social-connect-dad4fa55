ALTER TABLE public.ai_provider_accounts
  ADD COLUMN IF NOT EXISTS credit_balance numeric,
  ADD COLUMN IF NOT EXISTS credit_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS credit_error text;