-- Fix admin_list_users: return user_id (not id) to match frontend
DROP FUNCTION IF EXISTS public.admin_list_users(text, text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.admin_list_users(
  p_search text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_role text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  user_id uuid, email text, full_name text, avatar_url text,
  status text, workspace_id uuid, workspace_name text, role text,
  last_sign_in timestamptz, created_at timestamptz,
  wa_sessions_count bigint, wa_messages_count bigint, ai_cost_usd numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;
  RETURN QUERY
  SELECT DISTINCT ON (u.id)
    u.id AS user_id, u.email::TEXT, COALESCE(p.full_name, ''), p.avatar_url,
    COALESCE(p.status, 'pending')::TEXT, p.workspace_id, w.name,
    COALESCE(r.key, 'user'), u.last_sign_in_at, u.created_at,
    0::BIGINT, 0::BIGINT, 0::NUMERIC
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.user_id = u.id
  LEFT JOIN public.workspaces w ON w.id = p.workspace_id
  LEFT JOIN public.user_roles ur ON ur.user_id = u.id
  LEFT JOIN public.roles r ON r.id = ur.role_id
  WHERE
    (p_search IS NULL OR u.email ILIKE '%' || p_search || '%' OR p.full_name ILIKE '%' || p_search || '%')
    AND (p_status IS NULL OR COALESCE(p.status, 'pending')::TEXT = p_status)
    AND (p_role IS NULL OR r.key = p_role)
  ORDER BY u.id, CASE r.key WHEN 'super_admin' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

-- Fix admin_security_overview: use schema-qualified table names
DROP FUNCTION IF EXISTS public.admin_security_overview();

CREATE OR REPLACE FUNCTION public.admin_security_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;

  SELECT jsonb_build_object(
    'total_users', (SELECT count(*) FROM public.profiles),
    'active_users', (SELECT count(*) FROM public.profiles WHERE status = 'active'),
    'suspended_users', (SELECT count(*) FROM public.profiles WHERE status = 'suspended'),
    'super_admins', (SELECT count(*) FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id WHERE r.key = 'super_admin'),
    'recent_logins_24h', (SELECT count(*) FROM public.profiles WHERE last_login_at > now() - interval '24 hours'),
    'failed_logins_24h', 0,
    'blocked_ips', 0,
    'security_events_7d', (SELECT count(*) FROM public.activity_logs WHERE created_at > now() - interval '7 days')
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_users(text, text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_security_overview() TO authenticated;
NOTIFY pgrst, 'reload schema';