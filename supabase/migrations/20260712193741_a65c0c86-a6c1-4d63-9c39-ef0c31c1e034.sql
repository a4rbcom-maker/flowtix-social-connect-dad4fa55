
CREATE TABLE public.bot_worker_heartbeats (
  worker_name text PRIMARY KEY,
  version text,
  capabilities text[] NOT NULL DEFAULT '{}',
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT ON public.bot_worker_heartbeats TO authenticated;
GRANT ALL ON public.bot_worker_heartbeats TO service_role;
ALTER TABLE public.bot_worker_heartbeats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read heartbeats" ON public.bot_worker_heartbeats
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
