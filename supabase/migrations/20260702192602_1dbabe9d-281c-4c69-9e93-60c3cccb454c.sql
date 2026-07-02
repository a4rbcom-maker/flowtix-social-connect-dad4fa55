
CREATE TABLE public.site_visits (
  id BIGSERIAL PRIMARY KEY,
  path TEXT NOT NULL,
  referrer TEXT,
  user_agent TEXT,
  is_bot BOOLEAN NOT NULL DEFAULT false,
  bot_reason TEXT,
  session_id TEXT,
  lang TEXT,
  country TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.site_visits TO service_role;
GRANT SELECT ON public.site_visits TO authenticated;

ALTER TABLE public.site_visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read all visits" ON public.site_visits
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX site_visits_created_at_idx ON public.site_visits (created_at DESC);
CREATE INDEX site_visits_is_bot_idx ON public.site_visits (is_bot, created_at DESC);
CREATE INDEX site_visits_session_idx ON public.site_visits (session_id, created_at DESC);
