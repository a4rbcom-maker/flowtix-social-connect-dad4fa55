-- First, drop all RLS policies that reference workspace_id
DROP POLICY IF EXISTS "read_own_profile" ON profiles;
DROP POLICY IF EXISTS "workspace_upload_exports" ON storage.objects;
DROP POLICY IF EXISTS "workspace_read_exports" ON storage.objects;

-- Then drop workspace_id columns (use CASCADE to handle dependent objects)
ALTER TABLE profiles DROP COLUMN IF EXISTS workspace_id CASCADE;
ALTER TABLE user_roles DROP COLUMN IF EXISTS workspace_id CASCADE;
ALTER TABLE activity_logs DROP COLUMN IF EXISTS workspace_id CASCADE;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS workspace_id CASCADE;
ALTER TABLE invoices DROP COLUMN IF EXISTS workspace_id CASCADE;
ALTER TABLE notifications DROP COLUMN IF EXISTS workspace_id CASCADE;
ALTER TABLE wa_sessions DROP COLUMN IF EXISTS workspace_id CASCADE;
ALTER TABLE wa_conversations DROP COLUMN IF EXISTS workspace_id CASCADE;
ALTER TABLE wa_messages DROP COLUMN IF EXISTS workspace_id CASCADE;
ALTER TABLE wa_contacts DROP COLUMN IF EXISTS workspace_id CASCADE;
ALTER TABLE wa_campaigns DROP COLUMN IF EXISTS workspace_id CASCADE;
ALTER TABLE wa_templates DROP COLUMN IF EXISTS workspace_id CASCADE;
ALTER TABLE wa_keyword_rules DROP COLUMN IF EXISTS workspace_id CASCADE;
ALTER TABLE wa_workflows DROP COLUMN IF EXISTS workspace_id CASCADE;
ALTER TABLE wa_workflow_steps DROP COLUMN IF EXISTS workspace_id CASCADE;
ALTER TABLE wa_notes DROP COLUMN IF EXISTS workspace_id CASCADE;
ALTER TABLE fb_sessions DROP COLUMN IF EXISTS workspace_id CASCADE;
ALTER TABLE fb_browser_profiles DROP COLUMN IF EXISTS workspace_id CASCADE;
ALTER TABLE fb_session_activity DROP COLUMN IF EXISTS workspace_id CASCADE;
ALTER TABLE fb_session_events DROP COLUMN IF EXISTS workspace_id CASCADE;
ALTER TABLE fb_session_status_history DROP COLUMN IF EXISTS workspace_id CASCADE;
ALTER TABLE fb_connection_attempts DROP COLUMN IF EXISTS workspace_id CASCADE;
ALTER TABLE facebook_accounts DROP COLUMN IF EXISTS workspace_id CASCADE;
ALTER TABLE facebook_pages DROP COLUMN IF EXISTS workspace_id CASCADE;
ALTER TABLE extraction_jobs DROP COLUMN IF EXISTS workspace_id CASCADE;
ALTER TABLE extraction_results DROP COLUMN IF EXISTS workspace_id CASCADE;
ALTER TABLE exports DROP COLUMN IF EXISTS workspace_id CASCADE;
ALTER TABLE ai_provider_accounts DROP COLUMN IF EXISTS workspace_id CASCADE;

-- Drop workspace-related tables
DROP TABLE IF EXISTS workspace_members CASCADE;
DROP TABLE IF EXISTS workspace_invitations CASCADE;
DROP TABLE IF EXISTS workspaces CASCADE;

-- Drop workspace-related functions
DROP FUNCTION IF EXISTS public.admin_list_workspaces;
DROP FUNCTION IF EXISTS public.admin_get_workspace;
DROP FUNCTION IF EXISTS public.admin_update_workspace_status;
DROP FUNCTION IF EXISTS public.admin_update_workspace_settings;
DROP FUNCTION IF EXISTS public.admin_transfer_workspace_ownership;
DROP FUNCTION IF EXISTS public.admin_workspace_members;
DROP FUNCTION IF EXISTS public.get_workspace_ai_overview;
DROP FUNCTION IF EXISTS public.get_workspace_usage;
DROP FUNCTION IF EXISTS public.set_workspace_limits;

-- Recreate profiles read policy
CREATE POLICY "read_own_profile" ON profiles FOR SELECT
  USING (auth.uid() = user_id);

-- Update admin functions (remove workspace columns)
DROP FUNCTION IF EXISTS public.admin_change_user_role;

CREATE OR REPLACE FUNCTION public.admin_change_user_role(
  p_user_id uuid,
  p_workspace_id uuid DEFAULT NULL,
  p_role text DEFAULT 'user'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_role_id uuid;
BEGIN
  IF NOT is_super_admin() THEN RAISE EXCEPTION 'insufficient_privileges'; END IF;
  SELECT id INTO v_role_id FROM roles WHERE key = p_role;
  IF v_role_id IS NULL THEN RAISE EXCEPTION 'invalid_role'; END IF;
  DELETE FROM user_roles WHERE user_id = p_user_id;
  INSERT INTO user_roles (user_id, role_id) VALUES (p_user_id, v_role_id);
  INSERT INTO activity_logs (user_id, action, resource_type, resource_id, description, metadata)
  VALUES (auth.uid(), 'admin_action', 'user', p_user_id::text, 'Changed role to ' || p_role,
    jsonb_build_object('role', p_role));
END;
$$;

DROP FUNCTION IF EXISTS public.admin_list_users;

CREATE OR REPLACE FUNCTION public.admin_list_users(
  p_search text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_role text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  user_id uuid, email text, full_name text, avatar_url text,
  status text, role text,
  last_sign_in timestamptz, created_at timestamptz,
  wa_sessions_count bigint, wa_messages_count bigint, ai_cost_usd numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT is_super_admin() THEN RAISE EXCEPTION 'insufficient_privileges'; END IF;
  RETURN QUERY
  SELECT DISTINCT ON (u.id)
    u.id AS user_id, u.email::TEXT, COALESCE(p.full_name, ''), p.avatar_url,
    COALESCE(p.status, 'pending')::TEXT,
    COALESCE(r.key, 'user'), u.last_sign_in_at, u.created_at,
    0::BIGINT, 0::BIGINT, 0::NUMERIC
  FROM auth.users u
  LEFT JOIN profiles p ON p.user_id = u.id
  LEFT JOIN user_roles ur ON ur.user_id = u.id
  LEFT JOIN roles r ON r.id = ur.role_id
  WHERE
    (p_search IS NULL OR u.email ILIKE '%' || p_search || '%' OR p.full_name ILIKE '%' || p_search || '%')
    AND (p_status IS NULL OR COALESCE(p.status, 'pending')::TEXT = p_status)
    AND (p_role IS NULL OR r.key = p_role)
  ORDER BY u.id, CASE r.key WHEN 'super_admin' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

DROP FUNCTION IF EXISTS public.admin_get_user;

CREATE OR REPLACE FUNCTION public.admin_get_user(p_user_id uuid)
RETURNS TABLE(
  user_id uuid, email text, full_name text, avatar_url text,
  status text, role text,
  last_sign_in timestamptz, created_at timestamptz,
  wa_sessions_count bigint, wa_messages_count bigint, ai_cost_usd numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT is_super_admin() THEN RAISE EXCEPTION 'insufficient_privileges'; END IF;
  RETURN QUERY SELECT
    u.id AS user_id, u.email::TEXT, COALESCE(p.full_name, ''), p.avatar_url,
    COALESCE(p.status, 'active')::TEXT,
    COALESCE((SELECT r.key FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id ORDER BY CASE r.key WHEN 'super_admin' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END LIMIT 1), 'user'),
    u.last_sign_in_at, u.created_at,
    0::BIGINT, 0::BIGINT, 0::NUMERIC
  FROM auth.users u
  LEFT JOIN profiles p ON p.user_id = u.id
  WHERE u.id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'user_not_found'; END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.admin_create_subscription;

CREATE OR REPLACE FUNCTION public.admin_create_subscription(
  p_workspace_id uuid DEFAULT NULL,
  p_plan_id uuid DEFAULT NULL,
  p_status text DEFAULT 'active'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT is_super_admin() THEN RAISE EXCEPTION 'insufficient_privileges'; END IF;
  INSERT INTO subscriptions (plan_id, status, current_period_start, current_period_end)
  VALUES (p_plan_id, p_status, now(), now() + interval '1 month')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_change_user_role(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users(text, text, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_subscription(uuid, uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';