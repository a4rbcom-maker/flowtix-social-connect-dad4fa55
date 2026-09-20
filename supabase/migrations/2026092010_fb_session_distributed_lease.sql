-- Distributed session lease: ONE service instance in the world may open a
-- given Facebook session's cookies at a time. Root cause this kills: local dev
-- AND the production VPS shared the same Supabase and both replayed the same
-- cookies from different IPs/devices within minutes — Facebook reads that as
-- token theft and force-logs the account out (the recurring "3-minute session"
-- death). An atomic DB lease is the only guard that works across machines.

CREATE TABLE IF NOT EXISTS public.fb_session_leases (
  session_id uuid PRIMARY KEY REFERENCES public.fb_sessions(id) ON DELETE CASCADE,
  holder text NOT NULL,          -- instance identity: host:pid:boot-ts
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

ALTER TABLE public.fb_session_leases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role full access" ON public.fb_session_leases
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Atomic acquire: succeeds only if the row is free or the previous holder's
-- lease has expired. Returns true when this holder now owns the lease.
CREATE OR REPLACE FUNCTION public.acquire_fb_session_lease(
  p_session_id uuid,
  p_holder text,
  p_ttl_seconds integer DEFAULT 900
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.fb_session_leases (session_id, holder, expires_at)
  VALUES (p_session_id, p_holder, now() + make_interval(secs => p_ttl_seconds))
  ON CONFLICT (session_id) DO UPDATE
    SET holder = p_holder,
        acquired_at = now(),
        expires_at = now() + make_interval(secs => p_ttl_seconds)
    WHERE public.fb_session_leases.holder = p_holder          -- renew own lease
       OR public.fb_session_leases.expires_at <= now();        -- or take expired

  RETURN EXISTS (
    SELECT 1 FROM public.fb_session_leases
    WHERE session_id = p_session_id AND holder = p_holder AND expires_at > now()
  );
END;
$$;

-- Renew (heartbeat) — only the current holder can extend.
CREATE OR REPLACE FUNCTION public.renew_fb_session_lease(
  p_session_id uuid,
  p_holder text,
  p_ttl_seconds integer DEFAULT 900
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.fb_session_leases
  SET expires_at = now() + make_interval(secs => p_ttl_seconds)
  WHERE session_id = p_session_id AND holder = p_holder;

  RETURN FOUND;
END;
$$;

-- Release on clean close.
CREATE OR REPLACE FUNCTION public.release_fb_session_lease(
  p_session_id uuid,
  p_holder text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.fb_session_leases
  WHERE session_id = p_session_id AND holder = p_holder;
END;
$$;

GRANT EXECUTE ON FUNCTION public.acquire_fb_session_lease(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_fb_session_lease(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_fb_session_lease(uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
