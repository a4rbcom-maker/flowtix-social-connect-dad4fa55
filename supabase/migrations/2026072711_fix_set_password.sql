DROP FUNCTION IF EXISTS public.admin_set_user_password(uuid, text);

CREATE OR REPLACE FUNCTION public.admin_set_user_password(target_user_id uuid, new_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public, extensions
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;
  IF LENGTH(new_password) < 8 THEN
    RAISE EXCEPTION 'Password must be at least 8 characters';
  END IF;
  PERFORM auth.admin_update_user_by_id(target_user_id, jsonb_build_object('password', new_password));
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_user_password(uuid, text) TO authenticated;
NOTIFY pgrst, 'reload schema';