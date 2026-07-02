
CREATE TABLE IF NOT EXISTS public.wa_webhook_events (
  event_key text PRIMARY KEY,
  session_id text NOT NULL,
  event text,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wa_webhook_events_received_at_idx ON public.wa_webhook_events (received_at);
GRANT ALL ON public.wa_webhook_events TO service_role;
ALTER TABLE public.wa_webhook_events ENABLE ROW LEVEL SECURITY;
-- no policies: only service_role writes/reads from server (admin)
