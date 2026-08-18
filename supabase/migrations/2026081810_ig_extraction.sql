-- ============================================================
-- IG Extraction: ig_sessions + ig_browser_profiles + platform column
-- ============================================================

-- ============================================================
-- 1. ig_sessions
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ig_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'disconnected', 'needs_login')),
  ig_username text,
  ig_user_id text,
  avatar_url text,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ig_sessions_user_deleted
  ON public.ig_sessions (user_id, deleted_at);

CREATE INDEX IF NOT EXISTS idx_ig_sessions_username
  ON public.ig_sessions (ig_username);

-- ============================================================
-- 2. ig_browser_profiles
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ig_browser_profiles (
  session_id uuid PRIMARY KEY REFERENCES public.ig_sessions(id) ON DELETE CASCADE,
  cookies_enc text NOT NULL,
  user_agent text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 3. extraction_results.platform
-- ============================================================
ALTER TABLE public.extraction_results
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'facebook';

CREATE INDEX IF NOT EXISTS idx_extraction_results_platform
  ON public.extraction_results (platform);

-- ============================================================
-- 4. RLS — ig_sessions (user_id = auth.uid() OR is_super_admin())
-- ============================================================
ALTER TABLE public.ig_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_own_ig_sessions ON public.ig_sessions
  FOR SELECT USING (user_id = auth.uid() OR is_super_admin());

CREATE POLICY insert_own_ig_sessions ON public.ig_sessions
  FOR INSERT WITH CHECK (user_id = auth.uid() OR is_super_admin());

CREATE POLICY update_own_ig_sessions ON public.ig_sessions
  FOR UPDATE
  USING (user_id = auth.uid() OR is_super_admin())
  WITH CHECK (user_id = auth.uid() OR is_super_admin());

CREATE POLICY delete_own_ig_sessions ON public.ig_sessions
  FOR DELETE USING (user_id = auth.uid() OR is_super_admin());

-- ============================================================
-- 5. RLS — ig_browser_profiles (join عبر ig_sessions.user_id)
-- ============================================================
ALTER TABLE public.ig_browser_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY select_own_ig_browser_profiles ON public.ig_browser_profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.ig_sessions s
      WHERE s.id = session_id
        AND (s.user_id = auth.uid() OR is_super_admin())
    )
  );

CREATE POLICY insert_own_ig_browser_profiles ON public.ig_browser_profiles
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.ig_sessions s
      WHERE s.id = session_id
        AND (s.user_id = auth.uid() OR is_super_admin())
    )
  );

CREATE POLICY update_own_ig_browser_profiles ON public.ig_browser_profiles
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.ig_sessions s
      WHERE s.id = session_id
        AND (s.user_id = auth.uid() OR is_super_admin())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.ig_sessions s
      WHERE s.id = session_id
        AND (s.user_id = auth.uid() OR is_super_admin())
    )
  );

CREATE POLICY delete_own_ig_browser_profiles ON public.ig_browser_profiles
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.ig_sessions s
      WHERE s.id = session_id
        AND (s.user_id = auth.uid() OR is_super_admin())
    )
  );

-- ============================================================
-- 6. soft delete function (مرآة soft_delete_fb_session)
-- ============================================================
CREATE FUNCTION public.soft_delete_ig_session(p_session_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_session_user_id UUID;
BEGIN
    SELECT user_id INTO v_session_user_id
    FROM public.ig_sessions
    WHERE id = p_session_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'session_not_found';
    END IF;

    IF NOT public.is_super_admin()
       AND v_session_user_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'insufficient_privileges';
    END IF;

    UPDATE public.ig_sessions
    SET deleted_at   = now(),
        status       = 'disconnected',
        updated_at   = now()
    WHERE id = p_session_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.soft_delete_ig_session(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
