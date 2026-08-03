-- ADMIN TASK 2: Users Management RPCs
CREATE OR REPLACE FUNCTION admin_list_users(
  p_search text DEFAULT NULL, p_status text DEFAULT NULL, p_role text DEFAULT NULL,
  p_limit int DEFAULT 20, p_offset int DEFAULT 0
) RETURNS TABLE (
  user_id uuid, email text, full_name text, avatar_url text, locale text,
  status text, phone text, role text, workspace_id uuid, workspace_name text,
  last_sign_in timestamptz, created_at timestamptz
) AS $$
BEGIN
  IF NOT is_super_admin() THEN RAISE EXCEPTION 'insufficient_privileges'; END IF;
  RETURN QUERY
  SELECT p.user_id, p.email, COALESCE(p.full_name, '')::text, p.avatar_url::text, p.locale,
    p.status::text, COALESCE(p.phone, '')::text,
    COALESCE((SELECT r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = p.user_id ORDER BY CASE r.key WHEN 'super_admin' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END LIMIT 1), 'user')::text,
    COALESCE(p.workspace_id, p.user_id)::uuid, COALESCE((SELECT name FROM workspaces WHERE id = COALESCE(p.workspace_id, p.user_id)), '')::text,
    p.last_login_at, p.created_at
  FROM profiles p
  WHERE (p_search IS NULL OR p.email ILIKE '%' || p_search || '%' OR p.full_name ILIKE '%' || p_search || '%')
    AND (p_status IS NULL OR p.status::text = p_status)
    AND (p_role IS NULL OR EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = p.user_id AND r.key = p_role))
  ORDER BY p.created_at DESC LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_count_users(p_search text DEFAULT NULL, p_status text DEFAULT NULL, p_role text DEFAULT NULL)
RETURNS bigint AS $$
DECLARE result bigint;
BEGIN
  IF NOT is_super_admin() THEN RAISE EXCEPTION 'insufficient_privileges'; END IF;
  SELECT COUNT(*) INTO result FROM profiles p
  WHERE (p_search IS NULL OR p.email ILIKE '%' || p_search || '%' OR p.full_name ILIKE '%' || p_search || '%')
    AND (p_status IS NULL OR p.status::text = p_status)
    AND (p_role IS NULL OR EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = p.user_id AND r.key = p_role));
  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_get_user(p_user_id uuid)
RETURNS TABLE (user_id uuid, email text, full_name text, avatar_url text, locale text, status text, phone text, role text, workspace_id uuid, workspace_name text, last_sign_in timestamptz, created_at timestamptz, updated_at timestamptz, wa_sessions_count bigint, wa_messages_count bigint, ai_cost_usd numeric, recent_activities json) AS $$
BEGIN
  IF NOT is_super_admin() THEN RAISE EXCEPTION 'insufficient_privileges'; END IF;
  RETURN QUERY
  SELECT p.user_id, p.email, COALESCE(p.full_name, '')::text, p.avatar_url::text, p.locale, p.status::text,
    COALESCE(p.phone, '')::text,
    COALESCE((SELECT r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = p.user_id ORDER BY CASE r.key WHEN 'super_admin' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END LIMIT 1), 'user')::text,
    COALESCE(p.workspace_id, p.user_id)::uuid, COALESCE((SELECT name FROM workspaces WHERE id = COALESCE(p.workspace_id, p.user_id)), '')::text,
    p.last_login_at, p.created_at, p.updated_at,
    COALESCE((SELECT COUNT(*) FROM wa_sessions WHERE user_id = p.user_id AND deleted_at IS NULL), 0)::bigint,
    COALESCE((SELECT COUNT(*) FROM wa_messages WHERE workspace_id = COALESCE(p.workspace_id, p.user_id)), 0)::bigint,
    COALESCE((SELECT SUM(cost_usd) FROM ai_invocations WHERE workspace_id = COALESCE(p.workspace_id, p.user_id)), 0)::numeric,
    COALESCE((SELECT json_agg(json_build_object('action', a.action, 'description', a.description, 'created_at', a.created_at)) FROM (SELECT action, description, created_at FROM activity_logs WHERE user_id = p.user_id ORDER BY created_at DESC LIMIT 5) a), '[]'::json)
  FROM profiles p WHERE p.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_update_user_status(p_user_id uuid, p_status text, p_reason text DEFAULT NULL)
RETURNS void AS $$
DECLARE v_current_status text;
BEGIN
  IF NOT is_super_admin() THEN RAISE EXCEPTION 'insufficient_privileges'; END IF;
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'cannot_modify_self'; END IF;
  SELECT status::text INTO v_current_status FROM profiles WHERE user_id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'user_not_found'; END IF;
  UPDATE profiles SET status = p_status::user_status, updated_at = now() WHERE user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_change_user_role(p_user_id uuid, p_role text, p_workspace_id uuid DEFAULT NULL)
RETURNS void AS $$
DECLARE v_workspace uuid; v_old_role text; v_role_id uuid;
BEGIN
  IF NOT is_super_admin() THEN RAISE EXCEPTION 'insufficient_privileges'; END IF;
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'cannot_modify_self'; END IF;
  SELECT COALESCE(workspace_id, user_id) INTO v_workspace FROM profiles WHERE user_id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'user_not_found'; END IF;
  IF p_workspace_id IS NOT NULL THEN v_workspace := p_workspace_id; END IF;
  SELECT r.key INTO v_old_role FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = p_user_id AND ur.workspace_id = v_workspace LIMIT 1;
  DELETE FROM user_roles WHERE user_id = p_user_id AND workspace_id = v_workspace;
  SELECT id INTO v_role_id FROM roles WHERE key = p_role AND (workspace_id = v_workspace OR is_system = true) LIMIT 1;
  IF v_role_id IS NULL THEN INSERT INTO roles (key, name, is_system, workspace_id) VALUES (p_role, p_role, false, v_workspace) RETURNING id INTO v_role_id; END IF;
  INSERT INTO user_roles (user_id, role_id, workspace_id, assigned_by) VALUES (p_user_id, v_role_id, v_workspace, auth.uid());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_reset_user_password(p_user_id uuid)
RETURNS void AS $$
DECLARE v_email text;
BEGIN
  IF NOT is_super_admin() THEN RAISE EXCEPTION 'insufficient_privileges'; END IF;
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'cannot_modify_self'; END IF;
  SELECT email INTO v_email FROM profiles WHERE user_id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'user_not_found'; END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_invite_user(p_email text, p_full_name text DEFAULT NULL, p_role text DEFAULT 'user')
RETURNS uuid AS $$
DECLARE v_user_id uuid; v_workspace_id uuid; v_role_id uuid;
BEGIN
  IF NOT is_super_admin() THEN RAISE EXCEPTION 'insufficient_privileges'; END IF;
  IF EXISTS (SELECT 1 FROM profiles WHERE email = p_email) THEN RAISE EXCEPTION 'user_already_exists'; END IF;
  v_user_id := gen_random_uuid(); v_workspace_id := v_user_id;
  INSERT INTO profiles (user_id, email, full_name, status, workspace_id, locale) VALUES (v_user_id, p_email, p_full_name, 'pending', v_workspace_id, 'en');
  SELECT id INTO v_role_id FROM roles WHERE key = p_role AND is_system = true LIMIT 1;
  IF v_role_id IS NOT NULL THEN INSERT INTO user_roles (user_id, role_id, workspace_id, assigned_by) VALUES (v_user_id, v_role_id, v_workspace_id, auth.uid()); END IF;
  RETURN v_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;