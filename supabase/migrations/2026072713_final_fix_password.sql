DROP FUNCTION IF EXISTS public.admin_set_user_password(uuid, text);

CREATE OR REPLACE FUNCTION public.admin_set_user_password(target_user_id uuid, new_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_secret text;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;
  IF LENGTH(new_password) < 8 THEN
    RAISE EXCEPTION 'Password must be at least 8 characters';
  END IF;

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets WHERE name = 'service_role_key'
  LIMIT 1;

  IF v_secret IS NULL THEN
    UPDATE auth.users
    SET encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf', 10)),
        updated_at = now()
    WHERE id = target_user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'user_not_found';
    END IF;
    RETURN;
  END IF;

  -- Fallback: direct hash update
  UPDATE auth.users
  SET encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf', 10)),
      updated_at = now()
  WHERE id = target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_not_found';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_user_password(uuid, text) TO authenticated;
NOTIFY pgrst, 'reload schema';