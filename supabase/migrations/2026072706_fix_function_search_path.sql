-- Fix: Functions had empty search_path, causing "relation does not exist" errors

CREATE OR REPLACE FUNCTION public.current_workspace_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_ws UUID;
BEGIN
    SELECT workspace_id INTO v_ws
    FROM profiles
    WHERE user_id = auth.uid()
    LIMIT 1;
    RETURN v_ws;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = auth.uid()
        AND r.key = 'super_admin'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public._current_workspace_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    RETURN current_workspace_id();
END;
$$;

-- Also fix has_permission to have proper search_path
CREATE OR REPLACE FUNCTION public.has_permission(p_key text)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN role_permissions rp ON rp.role_id = ur.role_id
        JOIN permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = auth.uid()
        AND p.key = p_key
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.current_workspace_id() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public._current_workspace_id() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
