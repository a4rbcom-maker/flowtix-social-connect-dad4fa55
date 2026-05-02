-- Enums for type-safe channel/status
CREATE TYPE public.send_channel AS ENUM ('whatsapp', 'facebook', 'bulk', 'system');
CREATE TYPE public.send_status AS ENUM ('pending', 'processing', 'success', 'failed');

-- Unified send activity log
CREATE TABLE public.send_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  channel public.send_channel NOT NULL,
  action TEXT NOT NULL,
  status public.send_status NOT NULL DEFAULT 'pending',
  title TEXT NOT NULL,
  description TEXT,
  recipient TEXT,
  error_message TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_send_log_user_created ON public.send_log (user_id, created_at DESC);
CREATE INDEX idx_send_log_user_unread ON public.send_log (user_id) WHERE read = false;
CREATE INDEX idx_send_log_user_status ON public.send_log (user_id, status);

ALTER TABLE public.send_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own send logs"
  ON public.send_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own send logs"
  ON public.send_log FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own send logs"
  ON public.send_log FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own send logs"
  ON public.send_log FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER update_send_log_updated_at
  BEFORE UPDATE ON public.send_log
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime
ALTER TABLE public.send_log REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.send_log;