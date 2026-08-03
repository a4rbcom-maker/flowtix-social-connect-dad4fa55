-- إصلاح شامل: إزالة الـ overloads المكررة، ضبط search_path لكل الدوال
-- 1. Drop old overloads
DROP FUNCTION IF EXISTS public.admin_change_user_role(uuid, text);
DROP FUNCTION IF EXISTS public.admin_update_user_status(uuid, text);

-- 2. Recreate with proper search_path (keep only the 3-param versions)
CREATE OR REPLACE FUNCTION public.admin_change_user_role(p_user_id uuid, p_role text, p_workspace_id uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_ws UUID; v_role_id UUID;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'insufficient_privileges'; END IF;
  v_ws := COALESCE(p_workspace_id, (SELECT workspace_id FROM profiles WHERE user_id = p_user_id LIMIT 1));
  SELECT id INTO v_role_id FROM roles WHERE key = p_role LIMIT 1;
  IF v_role_id IS NULL THEN RAISE EXCEPTION 'invalid_role'; END IF;
  IF EXISTS (SELECT 1 FROM user_roles WHERE user_id = p_user_id AND workspace_id = v_ws) THEN
    UPDATE user_roles SET role_id = v_role_id WHERE user_id = p_user_id AND workspace_id = v_ws;
  ELSE
    INSERT INTO user_roles (user_id, workspace_id, role_id) VALUES (p_user_id, v_ws, v_role_id);
  END IF;
  INSERT INTO activity_logs (user_id, workspace_id, action, resource_type, resource_id, description, metadata)
  VALUES (auth.uid(), v_ws, 'admin_action', 'user', p_user_id::text, 'Changed role to: ' || p_role, jsonb_build_object('role', p_role));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_user_status(p_user_id uuid, p_status text, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'insufficient_privileges'; END IF;
  IF p_status NOT IN ('active','suspended','pending','deleted') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  UPDATE profiles SET status = p_status::user_status, updated_at = now() WHERE user_id = p_user_id;
  INSERT INTO activity_logs (user_id, workspace_id, action, resource_type, resource_id, description, metadata)
  VALUES (auth.uid(), NULL, 'admin_action', 'user', p_user_id::text, 'Updated user status to: ' || p_status, jsonb_build_object('status', p_status, 'reason', p_reason));
END;
$$;

-- 3. Fix admin_security_overview (had empty search_path="")
CREATE OR REPLACE FUNCTION public.admin_security_overview()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'insufficient_privileges'; END IF;

  SELECT jsonb_build_object(
    'total_users', (SELECT count(*) FROM profiles),
    'active_users', (SELECT count(*) FROM profiles WHERE status = 'active'),
    'suspended_users', (SELECT count(*) FROM profiles WHERE status = 'suspended'),
    'super_admins', (SELECT count(*) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.key = 'super_admin'),
    'recent_logins_24h', (SELECT count(*) FROM profiles WHERE last_login_at > now() - interval '24 hours'),
    'failed_logins_24h', 0,
    'blocked_ips', 0,
    'security_events_7d', (SELECT count(*) FROM activity_logs WHERE created_at > now() - interval '7 days')
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- 4. Apply search_path to ALL other SECURITY DEFINER admin functions
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname LIKE 'admin_%'
      AND p.prosecdef = true
      AND COALESCE(p.proconfig, ARRAY[]::text[]) != ARRAY['search_path=public, extensions']
  LOOP
    BEGIN
      EXECUTE format('ALTER FUNCTION public.%I(%s) SET search_path = public, extensions', r.proname, r.args);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Skipping % (%)', r.proname, r.args;
    END;
  END LOOP;
END;
$$;

-- 5. Reload schema cache
NOTIFY pgrst, 'reload schema';
