-- Definitive fix: soft_delete_fb_session fails with "relation fb_sessions does not exist".
-- Root cause: SET search_path = '' makes BOTH tables AND functions invisible.
--   - is_super_admin() called without schema prefix -> unresolvable
--   - Old DB versions still reference fb_sessions without public. prefix
-- Solution:
--   1. DROP every overload that may exist from prior migrations
--   2. CREATE with search_path = public, pg_temp (safe + resolvable)
--   3. Fully qualify is_super_admin() as public.is_super_admin()

-- Step 1: nuke ALL existing overloads (any param shape)
DROP FUNCTION IF EXISTS public.soft_delete_fb_session(UUID);
DROP FUNCTION IF EXISTS public.soft_delete_fb_session(UUID, UUID);
DROP FUNCTION IF EXISTS public.soft_delete_fb_session(p_session_id UUID);
DROP FUNCTION IF EXISTS public.soft_delete_fb_session(p_session_id UUID, p_user_id UUID);

-- Step 2: create the single correct overload
CREATE FUNCTION public.soft_delete_fb_session(p_session_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_session_user_id UUID;
BEGIN
    SELECT user_id INTO v_session_user_id
    FROM public.fb_sessions
    WHERE id = p_session_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'session_not_found';
    END IF;

    IF NOT public.is_super_admin()
       AND v_session_user_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'insufficient_privileges';
    END IF;

    UPDATE public.fb_sessions
    SET deleted_at   = now(),
        deleted_by   = auth.uid(),
        status       = 'disconnected',
        updated_at   = now()
    WHERE id = p_session_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.soft_delete_fb_session(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
