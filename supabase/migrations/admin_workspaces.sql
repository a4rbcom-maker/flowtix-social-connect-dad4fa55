-- ============================================================
-- ADMIN TASK 3: Workspaces Management RPCs
-- ============================================================

-- A1) List workspaces with filters + resource usage
CREATE OR REPLACE FUNCTION admin_list_workspaces(
  p_search text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_plan_key text DEFAULT NULL,
  p_limit int DEFAULT 20,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  workspace_id uuid,
  name text,
  slug text,
  owner_id uuid,
  owner_email text,
  owner_name text,
  status text,
  plan_name text,
  plan_key text,
  subscription_status text,
  settings json,
  limits json,
  wa_sessions_count bigint,
  wa_messages_count bigint,
  wa_contacts_count bigint,
  ai_cost_usd numeric,
  created_at timestamptz
) AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;

  RETURN QUERY
  SELECT
    w.id AS workspace_id,
    w.name,
    w.slug,
    w.owner_id,
    COALESCE((SELECT email FROM profiles WHERE user_id = w.owner_id LIMIT 1), '')::text AS owner_email,
    COALESCE((SELECT full_name FROM profiles WHERE user_id = w.owner_id LIMIT 1), '')::text AS owner_name,
    w.status::text,
    COALESCE((
      SELECT p.name FROM subscriptions s
      JOIN plans p ON p.id = s.plan_id
      WHERE s.workspace_id = w.id AND s.status = 'active'
      ORDER BY s.created_at DESC LIMIT 1
    ), '')::text AS plan_name,
    COALESCE((
      SELECT p.key FROM subscriptions s
      JOIN plans p ON p.id = s.plan_id
      WHERE s.workspace_id = w.id AND s.status = 'active'
      ORDER BY s.created_at DESC LIMIT 1
    ), '')::text AS plan_key,
    COALESCE((
      SELECT s.status::text FROM subscriptions s
      WHERE s.workspace_id = w.id
      ORDER BY s.created_at DESC LIMIT 1
    ), '')::text AS subscription_status,
    w.settings,
    COALESCE((
      SELECT p.limits FROM subscriptions s
      JOIN plans p ON p.id = s.plan_id
      WHERE s.workspace_id = w.id AND s.status = 'active'
      ORDER BY s.created_at DESC LIMIT 1
    ), '{}'::json) AS limits,
    (SELECT COUNT(*) FROM wa_sessions WHERE workspace_id = w.id AND deleted_at IS NULL)::bigint AS wa_sessions_count,
    (SELECT COUNT(*) FROM wa_messages WHERE workspace_id = w.id AND deleted_at IS NULL)::bigint AS wa_messages_count,
    (SELECT COUNT(*) FROM wa_contacts WHERE workspace_id = w.id AND deleted_at IS NULL)::bigint AS wa_contacts_count,
    COALESCE((SELECT SUM(cost_usd) FROM ai_invocations WHERE workspace_id = w.id AND cost_usd IS NOT NULL), 0)::numeric AS ai_cost_usd,
    w.created_at
  FROM workspaces w
  WHERE
    (p_search IS NULL OR w.name ILIKE '%' || p_search || '%' OR w.slug ILIKE '%' || p_search || '%')
    AND (p_status IS NULL OR w.status::text = p_status)
    AND (p_plan_key IS NULL OR EXISTS (
      SELECT 1 FROM subscriptions s
      JOIN plans p ON p.id = s.plan_id
      WHERE s.workspace_id = w.id AND p.key = p_plan_key AND s.status = 'active'
    ))
  ORDER BY w.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- A2) Count workspaces (pagination)
CREATE OR REPLACE FUNCTION admin_count_workspaces(
  p_search text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_plan_key text DEFAULT NULL
)
RETURNS bigint AS $$
DECLARE
  result bigint;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;

  SELECT COUNT(*) INTO result
  FROM workspaces w
  WHERE
    (p_search IS NULL OR w.name ILIKE '%' || p_search || '%' OR w.slug ILIKE '%' || p_search || '%')
    AND (p_status IS NULL OR w.status::text = p_status)
    AND (p_plan_key IS NULL OR EXISTS (
      SELECT 1 FROM subscriptions s
      JOIN plans p ON p.id = s.plan_id
      WHERE s.workspace_id = w.id AND p.key = p_plan_key AND s.status = 'active'
    ));

  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- A3) Get workspace details (full resource breakdown)
CREATE OR REPLACE FUNCTION admin_get_workspace(
  p_workspace_id uuid
)
RETURNS TABLE (
  workspace_id uuid,
  name text,
  slug text,
  owner_id uuid,
  owner_email text,
  owner_name text,
  status text,
  plan_name text,
  plan_key text,
  plan_limits json,
  subscription_status text,
  subscription_id uuid,
  current_period_end timestamptz,
  settings json,
  created_at timestamptz,
  updated_at timestamptz,
  members_count bigint,
  wa_sessions_count bigint,
  connected_wa_sessions bigint,
  wa_messages_count bigint,
  wa_contacts_count bigint,
  wa_campaigns_count bigint,
  fb_sessions_count bigint,
  ai_invocations_count bigint,
  ai_cost_usd numeric,
  ai_cost_today numeric,
  storage_used_mb numeric
) AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;

  RETURN QUERY
  SELECT
    w.id, w.name, w.slug, w.owner_id,
    COALESCE((SELECT email FROM profiles WHERE user_id = w.owner_id LIMIT 1), '')::text,
    COALESCE((SELECT full_name FROM profiles WHERE user_id = w.owner_id LIMIT 1), '')::text,
    w.status::text,
    COALESCE((SELECT p.name FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.workspace_id = w.id AND s.status = 'active' ORDER BY s.created_at DESC LIMIT 1), '')::text,
    COALESCE((SELECT p.key FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.workspace_id = w.id AND s.status = 'active' ORDER BY s.created_at DESC LIMIT 1), '')::text,
    COALESCE((SELECT p.limits FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.workspace_id = w.id AND s.status = 'active' ORDER BY s.created_at DESC LIMIT 1), '{}'::json),
    COALESCE((SELECT s.status::text FROM subscriptions s WHERE s.workspace_id = w.id ORDER BY s.created_at DESC LIMIT 1), '')::text,
    COALESCE((SELECT s.id FROM subscriptions s WHERE s.workspace_id = w.id ORDER BY s.created_at DESC LIMIT 1), NULL)::uuid,
    COALESCE((SELECT s.current_period_end FROM subscriptions s WHERE s.workspace_id = w.id ORDER BY s.created_at DESC LIMIT 1), NULL)::timestamptz,
    w.settings,
    w.created_at,
    w.updated_at,
    (SELECT COUNT(*) FROM user_roles ur WHERE ur.workspace_id = w.id)::bigint,
    (SELECT COUNT(*) FROM wa_sessions WHERE workspace_id = w.id AND deleted_at IS NULL)::bigint,
    (SELECT COUNT(*) FROM wa_sessions WHERE workspace_id = w.id AND status = 'connected' AND deleted_at IS NULL)::bigint,
    (SELECT COUNT(*) FROM wa_messages WHERE workspace_id = w.id AND deleted_at IS NULL)::bigint,
    (SELECT COUNT(*) FROM wa_contacts WHERE workspace_id = w.id AND deleted_at IS NULL)::bigint,
    (SELECT COUNT(*) FROM wa_campaigns WHERE workspace_id = w.id AND deleted_at IS NULL)::bigint,
    (SELECT COUNT(*) FROM fb_sessions WHERE workspace_id = w.id AND deleted_at IS NULL)::bigint,
    (SELECT COUNT(*) FROM ai_invocations WHERE workspace_id = w.id)::bigint,
    COALESCE((SELECT SUM(cost_usd) FROM ai_invocations WHERE workspace_id = w.id AND cost_usd IS NOT NULL), 0)::numeric,
    COALESCE((SELECT SUM(cost_usd) FROM ai_invocations WHERE workspace_id = w.id AND cost_usd IS NOT NULL AND created_at >= DATE_TRUNC('day', NOW())), 0)::numeric,
    0::numeric AS storage_used_mb  -- placeholder (يُحسب لاحقاً من Supabase Storage)
  FROM workspaces w
  WHERE w.id = p_workspace_id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- A4) Update workspace status (suspend / activate / delete)
CREATE OR REPLACE FUNCTION admin_update_workspace_status(
  p_workspace_id uuid,
  p_status text,
  p_reason text DEFAULT NULL
)
RETURNS void AS $$
DECLARE
  v_old_status text;
  v_owner_workspace uuid;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;

  -- منع تعديل workspace الأدمن نفسه
  SELECT owner_id INTO v_owner_workspace FROM workspaces WHERE id = p_workspace_id;
  IF v_owner_workspace = auth.uid() THEN
    RAISE EXCEPTION 'cannot_modify_own_workspace';
  END IF;

  SELECT status::text INTO v_old_status FROM workspaces WHERE id = p_workspace_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workspace_not_found';
  END IF;

  UPDATE workspaces SET status = p_status::user_status, updated_at = now()
  WHERE id = p_workspace_id;

  -- لو تعليق: أوقف كل sessions النشطة
  IF p_status = 'suspended' THEN
    UPDATE wa_sessions SET status = 'disconnected', updated_at = now()
    WHERE workspace_id = p_workspace_id AND status IN ('connected', 'connecting', 'reconnecting') AND deleted_at IS NULL;
  END IF;

  -- سجل النشاط
  INSERT INTO activity_logs (user_id, workspace_id, action, description, resource_id, resource_type, metadata)
  VALUES (
    auth.uid(), p_workspace_id, 'admin_action'::activity_action,
    COALESCE(p_reason, 'Workspace status changed to ' || p_status),
    p_workspace_id, 'workspace',
    jsonb_build_object('old_status', v_old_status, 'new_status', p_status)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- A5) Update workspace settings (limits override + custom settings)
CREATE OR REPLACE FUNCTION admin_update_workspace_settings(
  p_workspace_id uuid,
  p_settings json DEFAULT NULL
)
RETURNS void AS $$
DECLARE
  v_old_settings json;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;

  SELECT settings INTO v_old_settings FROM workspaces WHERE id = p_workspace_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workspace_not_found';
  END IF;

  UPDATE workspaces
  SET settings = COALESCE(p_settings, settings), updated_at = now()
  WHERE id = p_workspace_id;

  INSERT INTO activity_logs (user_id, workspace_id, action, description, resource_id, resource_type, metadata)
  VALUES (
    auth.uid(), p_workspace_id, 'workspace_update'::activity_action,
    'Workspace settings updated',
    p_workspace_id, 'workspace',
    jsonb_build_object('old_settings', v_old_settings, 'new_settings', p_settings)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- A6) Transfer workspace ownership
CREATE OR REPLACE FUNCTION admin_transfer_workspace_ownership(
  p_workspace_id uuid,
  p_new_owner_id uuid
)
RETURNS void AS $$
DECLARE
  v_old_owner uuid;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;

  SELECT owner_id INTO v_old_owner FROM workspaces WHERE id = p_workspace_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workspace_not_found';
  END IF;

  -- التحقق من وجود المستخدم الجديد
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = p_new_owner_id) THEN
    RAISE EXCEPTION 'new_owner_not_found';
  END IF;

  UPDATE workspaces
  SET owner_id = p_new_owner_id, updated_at = now()
  WHERE id = p_workspace_id;

  -- تأكد إن المالك الجديد لديه دور admin على الأقل في الـ workspace
  IF NOT EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = p_new_owner_id AND ur.workspace_id = p_workspace_id
      AND r.key IN ('admin', 'super_admin')
  ) THEN
    INSERT INTO user_roles (user_id, role_id, workspace_id, assigned_by)
    SELECT p_new_owner_id, r.id, p_workspace_id, auth.uid()
    FROM roles r WHERE r.key = 'admin' AND is_system = true LIMIT 1;
  END IF;

  INSERT INTO activity_logs (user_id, workspace_id, action, description, resource_id, resource_type, metadata)
  VALUES (
    auth.uid(), p_workspace_id, 'admin_action'::activity_action,
    'Workspace ownership transferred',
    p_workspace_id, 'workspace',
    jsonb_build_object('old_owner', v_old_owner, 'new_owner', p_new_owner_id)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- A7) Get workspace members (for drawer)
CREATE OR REPLACE FUNCTION admin_workspace_members(
  p_workspace_id uuid
)
RETURNS TABLE (
  user_id uuid,
  email text,
  full_name text,
  role text,
  status text,
  created_at timestamptz
) AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;

  RETURN QUERY
  SELECT
    p.user_id,
    p.email,
    COALESCE(p.full_name, '')::text,
    COALESCE((
      SELECT r.key FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = p.user_id AND ur.workspace_id = p_workspace_id
      LIMIT 1
    ), 'user')::text AS role,
    p.status::text,
    ur.created_at
  FROM user_roles ur
  JOIN profiles p ON p.user_id = ur.user_id
  WHERE ur.workspace_id = p_workspace_id
  ORDER BY ur.created_at DESC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;
