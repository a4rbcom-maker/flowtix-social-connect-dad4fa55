-- Status enum for scheduled messages
DO $$ BEGIN
  CREATE TYPE public.schedule_status AS ENUM ('scheduled','sending','sent','failed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.scheduled_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  channel public.send_channel NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  image_url text,
  recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  scheduled_at timestamptz NOT NULL,
  status public.schedule_status NOT NULL DEFAULT 'scheduled',
  error_message text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.scheduled_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own scheduled messages"
  ON public.scheduled_messages FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users insert own scheduled messages"
  ON public.scheduled_messages FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own scheduled messages"
  ON public.scheduled_messages FOR UPDATE
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users delete own scheduled messages"
  ON public.scheduled_messages FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER update_scheduled_messages_updated_at
  BEFORE UPDATE ON public.scheduled_messages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_scheduled_messages_user_status ON public.scheduled_messages(user_id, status);
CREATE INDEX idx_scheduled_messages_scheduled_at ON public.scheduled_messages(scheduled_at);