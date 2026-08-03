-- Fix admin_security_overview: return nested shape matching AdminSecurityOverview TS interface
CREATE OR REPLACE FUNCTION public.admin_security_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_total_tables INT;
  v_rls_enabled INT;
  v_tables_without_rls TEXT[];
  v_ext_count INT;
  v_ext_names TEXT[];
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE c.relrowsecurity = true)
  INTO v_total_tables, v_rls_enabled
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname NOT LIKE 'pg_%'
    AND c.relname NOT LIKE 'schema_%';

  SELECT COALESCE(array_agg(c.relname ORDER BY c.relname), ARRAY[]::TEXT[])
  INTO v_tables_without_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relrowsecurity = false
    AND c.relname NOT LIKE 'pg_%'
    AND c.relname NOT LIKE 'schema_%';

  SELECT COUNT(*), COALESCE(array_agg(e.extname ORDER BY e.extname), ARRAY[]::TEXT[])
  INTO v_ext_count, v_ext_names
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE n.nspname = 'public';

  RETURN jsonb_build_object(
    'rls', jsonb_build_object(
      'total_tables', v_total_tables,
      'rls_enabled', v_rls_enabled,
      'coverage_pct', CASE WHEN v_total_tables > 0 THEN ROUND((v_rls_enabled::NUMERIC / v_total_tables) * 100) ELSE 100 END,
      'tables_without_rls', to_jsonb(v_tables_without_rls)
    ),
    'extensions', jsonb_build_object(
      'in_public_schema', v_ext_count,
      'names', to_jsonb(v_ext_names)
    ),
    'users', jsonb_build_object(
      'total', (SELECT COUNT(*) FROM profiles),
      'suspended', (SELECT COUNT(*) FROM profiles WHERE status = 'suspended'),
      'admins', (SELECT COUNT(*) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.key IN ('super_admin', 'admin'))
    ),
    'events_24h', jsonb_build_object(
      'logins', (SELECT COUNT(*) FROM profiles WHERE last_login_at > now() - INTERVAL '24 hours'),
      'suspensions', (SELECT COUNT(*) FROM activity_logs WHERE action = 'admin_action' AND description ILIKE '%suspend%' AND created_at > now() - INTERVAL '24 hours'),
      'role_changes', (SELECT COUNT(*) FROM activity_logs WHERE action = 'admin_action' AND description ILIKE '%role%' AND created_at > now() - INTERVAL '24 hours'),
      'password_changes', (SELECT COUNT(*) FROM activity_logs WHERE action = 'admin_action' AND description ILIKE '%password%' AND created_at > now() - INTERVAL '24 hours'),
      'admin_actions', (SELECT COUNT(*) FROM activity_logs WHERE action = 'admin_action' AND created_at > now() - INTERVAL '24 hours'),
      'unique_ips', 0
    )
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
