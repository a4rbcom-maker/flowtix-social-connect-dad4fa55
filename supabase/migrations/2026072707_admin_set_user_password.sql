-- admin_set_user_password: يحدّث كلمة مرور المستخدم مباشرة بدون إرسال إيميل
CREATE OR REPLACE FUNCTION public.admin_set_user_password(p_user_id uuid, p_password text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = auth, public
AS $$
BEGIN
    IF NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'insufficient_privileges';
    END IF;

    IF LENGTH(p_password) < 8 THEN
        RAISE EXCEPTION 'كلمة المرور يجب أن تكون 8 أحرف على الأقل';
    END IF;

    UPDATE auth.users
    SET encrypted_password = crypt(p_password, gen_salt('bf', 10)),
        updated_at = now()
    WHERE id = p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'user_not_found';
    END IF;

    INSERT INTO public.activity_logs (user_id, workspace_id, action, resource_type, resource_id, description, metadata)
    SELECT auth.uid(), p.workspace_id, 'admin_action', 'user', p_user_id::text,
           'Password changed directly (no email)', '{}'::jsonb
    FROM public.profiles p WHERE p.user_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_user_password(uuid, text) TO authenticated;
