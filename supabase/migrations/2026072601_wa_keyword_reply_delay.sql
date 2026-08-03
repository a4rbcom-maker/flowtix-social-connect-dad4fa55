-- TASK: WhatsApp Automation — reply delay column
ALTER TABLE public.wa_keyword_rules
  ADD COLUMN IF NOT EXISTS reply_delay_sec int NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.wa_keyword_rules.reply_delay_sec IS 'Delay in seconds before sending the auto-reply (simulates human typing). 0 = instant.';
