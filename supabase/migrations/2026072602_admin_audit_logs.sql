-- ============================================================
-- ADMIN TASK 7: Audit Logs RPCs
-- ============================================================

-- A1) List audit logs with advanced filters + pagination
CREATE OR REPLACE FUNCTION admin_list_audit_logs(
  p_search     TEXT DEFAULT NULL,
  p_user_id    UUID DEFAULT NULL,
  p_action     TEXT DEFAULT NULL,
  p_resource_type TEXT DEFAULT NULL,
  p_workspace_id UUID DEFAULT NULL,
  p_date_from  TIMESTAMPTZ DEFAULT NULL,
  p_date_to    TIMESTAMPTZ DEFAULT NULL,
  p_limit      INT DEFAULT 20,
  p_offset     INT DEFAULT 0
) RETURNS TABLE (
  id UUID,
  user_id UUID,
  user_email TEXT,
  user_name TEXT,
  workspace_id UUID,
  workspace_name TEXT,
  action TEXT,
  resource_type TEXT,
  resource_id TEXT,
  description TEXT,
  metadata JSONB,
  ip JSONB,
  user_agent TEXT,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;

  RETURN QUERY
  SELECT
    al.id,
    al.user_id,
    u.email AS user_email,
    COALESCE(p.full_name, '') AS user_name,
    al.workspace_id,
    w.name AS workspace_name,
    al.action::text,
    al.resource_type,
    al.resource_id,
    al.description,
    al.metadata,
    al.ip,
    al.user_agent,
    al.created_at
  FROM activity_logs al
  LEFT JOIN auth.users u ON u.id = al.user_id
  LEFT JOIN profiles p ON p.id = al.user_id
  LEFT JOIN workspaces w ON w.id = al.workspace_id
  WHERE
    (p_search IS NULL OR
     al.description ILIKE '%' || p_search || '%' OR
     al.resource_type ILIKE '%' || p_search || '%' OR
     al.resource_id::text ILIKE '%' || p_search || '%' OR
     u.email ILIKE '%' || p_search || '%' OR
     COALESCE(p.full_name, '') ILIKE '%' || p_search || '%')
    AND (p_user_id IS NULL OR al.user_id = p_user_id)
    AND (p_action IS NULL OR al.action::text = p_action)
    AND (p_resource_type IS NULL OR al.resource_type = p_resource_type)
    AND (p_workspace_id IS NULL OR al.workspace_id = p_workspace_id)
    AND (p_date_from IS NULL OR al.created_at >= p_date_from)
    AND (p_date_to IS NULL OR al.created_at <= p_date_to)
  ORDER BY al.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- A2) Count audit logs (with same filters, for pagination)
CREATE OR REPLACE FUNCTION admin_count_audit_logs(
  p_search     TEXT DEFAULT NULL,
  p_user_id    UUID DEFAULT NULL,
  p_action     TEXT DEFAULT NULL,
  p_resource_type TEXT DEFAULT NULL,
  p_workspace_id UUID DEFAULT NULL,
  p_date_from  TIMESTAMPTZ DEFAULT NULL,
  p_date_to    TIMESTAMPTZ DEFAULT NULL
) RETURNS BIGINT AS $$
DECLARE
  v_count BIGINT;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM activity_logs al
  LEFT JOIN auth.users u ON u.id = al.user_id
  LEFT JOIN profiles p ON p.id = al.user_id
  WHERE
    (p_search IS NULL OR
     al.description ILIKE '%' || p_search || '%' OR
     al.resource_type ILIKE '%' || p_search || '%' OR
     al.resource_id::text ILIKE '%' || p_search || '%' OR
     u.email ILIKE '%' || p_search || '%' OR
     COALESCE(p.full_name, '') ILIKE '%' || p_search || '%')
    AND (p_user_id IS NULL OR al.user_id = p_user_id)
    AND (p_action IS NULL OR al.action::text = p_action)
    AND (p_resource_type IS NULL OR al.resource_type = p_resource_type)
    AND (p_workspace_id IS NULL OR al.workspace_id = p_workspace_id)
    AND (p_date_from IS NULL OR al.created_at >= p_date_from)
    AND (p_date_to IS NULL OR al.created_at <= p_date_to);

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- A3) Audit log statistics (counts + breakdown by action type)
CREATE OR REPLACE FUNCTION admin_audit_stats()
RETURNS TABLE (
  total_logs BIGINT,
  today_count BIGINT,
  week_count BIGINT,
  month_count BIGINT,
  unique_users_today BIGINT,
  unique_workspaces_today BIGINT,
  top_actions JSONB,
  top_resource_types JSONB
) AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM activity_logs)::bigint,
    (SELECT COUNT(*) FROM activity_logs WHERE created_at >= DATE_TRUNC('day', NOW()))::bigint,
    (SELECT COUNT(*) FROM activity_logs WHERE created_at >= DATE_TRUNC('week', NOW()))::bigint,
    (SELECT COUNT(*) FROM activity_logs WHERE created_at >= DATE_TRUNC('month', NOW()))::bigint,
    (SELECT COUNT(DISTINCT user_id) FROM activity_logs WHERE created_at >= DATE_TRUNC('day', NOW()) AND user_id IS NOT NULL)::bigint,
    (SELECT COUNT(DISTINCT workspace_id) FROM activity_logs WHERE created_at >= DATE_TRUNC('day', NOW()) AND workspace_id IS NOT NULL)::bigint,
    -- Top 10 actions by count (last 30 days)
    (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('action', action, 'count', cnt)), '[]'::jsonb)
      FROM (
        SELECT action::text, COUNT(*) AS cnt
        FROM activity_logs
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY action
        ORDER BY cnt DESC
        LIMIT 10
      ) a
    ),
    -- Top 10 resource types by count (last 30 days)
    (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('type', COALESCE(resource_type, 'unknown'), 'count', cnt)), '[]'::jsonb)
      FROM (
        SELECT resource_type, COUNT(*) AS cnt
        FROM activity_logs
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY resource_type
        ORDER BY cnt DESC
        LIMIT 10
      ) r
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- A4) Export audit logs (returns all matching without pagination, for CSV/JSON download)
CREATE OR REPLACE FUNCTION admin_export_audit_logs(
  p_search     TEXT DEFAULT NULL,
  p_user_id    UUID DEFAULT NULL,
  p_action     TEXT DEFAULT NULL,
  p_resource_type TEXT DEFAULT NULL,
  p_workspace_id UUID DEFAULT NULL,
  p_date_from  TIMESTAMPTZ DEFAULT NULL,
  p_date_to    TIMESTAMPTZ DEFAULT NULL,
  p_limit      INT DEFAULT 10000
) RETURNS TABLE (
  id UUID,
  user_email TEXT,
  user_name TEXT,
  workspace_name TEXT,
  action TEXT,
  resource_type TEXT,
  resource_id TEXT,
  description TEXT,
  metadata JSONB,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;

  RETURN QUERY
  SELECT
    al.id,
    u.email AS user_email,
    COALESCE(p.full_name, '') AS user_name,
    w.name AS workspace_name,
    al.action::text,
    al.resource_type,
    al.resource_id,
    al.description,
    al.metadata,
    COALESCE(al.ip::text, '') AS ip,
    al.user_agent,
    al.created_at
  FROM activity_logs al
  LEFT JOIN auth.users u ON u.id = al.user_id
  LEFT JOIN profiles p ON p.id = al.user_id
  LEFT JOIN workspaces w ON w.id = al.workspace_id
  WHERE
    (p_search IS NULL OR
     al.description ILIKE '%' || p_search || '%' OR
     al.resource_type ILIKE '%' || p_search || '%' OR
     al.resource_id::text ILIKE '%' || p_search || '%' OR
     u.email ILIKE '%' || p_search || '%' OR
     COALESCE(p.full_name, '') ILIKE '%' || p_search || '%')
    AND (p_user_id IS NULL OR al.user_id = p_user_id)
    AND (p_action IS NULL OR al.action::text = p_action)
    AND (p_resource_type IS NULL OR al.resource_type = p_resource_type)
    AND (p_workspace_id IS NULL OR al.workspace_id = p_workspace_id)
    AND (p_date_from IS NULL OR al.created_at >= p_date_from)
    AND (p_date_to IS NULL OR al.created_at <= p_date_to)
  ORDER BY al.created_at DESC
  LIMIT LEAST(p_limit, 10000);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- A5) Get audit log detail by ID
CREATE OR REPLACE FUNCTION admin_get_audit_log(p_log_id UUID)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  user_email TEXT,
  user_name TEXT,
  workspace_id UUID,
  workspace_name TEXT,
  action TEXT,
  resource_type TEXT,
  resource_id TEXT,
  description TEXT,
  metadata JSONB,
  ip JSONB,
  user_agent TEXT,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;

  RETURN QUERY
  SELECT
    al.id,
    al.user_id,
    u.email AS user_email,
    COALESCE(p.full_name, '') AS user_name,
    al.workspace_id,
    w.name AS workspace_name,
    al.action::text,
    al.resource_type,
    al.resource_id,
    al.description,
    al.metadata,
    al.ip,
    al.user_agent,
    al.created_at
  FROM activity_logs al
  LEFT JOIN auth.users u ON u.id = al.user_id
  LEFT JOIN profiles p ON p.id = al.user_id
  LEFT JOIN workspaces w ON w.id = al.workspace_id
  WHERE al.id = p_log_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'log_not_found';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- A6) Activity trend (last 30 days — for chart)
CREATE OR REPLACE FUNCTION admin_audit_trend(p_days INT DEFAULT 30)
RETURNS TABLE (
  date TEXT,
  count BIGINT
) AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;

  RETURN QUERY
  SELECT
    TO_CHAR(d.day, 'YYYY-MM-DD') AS date,
    COALESCE(c.cnt, 0)::bigint AS count
  FROM generate_series(
    DATE_TRUNC('day', NOW()) - (p_days - 1) * INTERVAL '1 day',
    DATE_TRUNC('day', NOW()),
    INTERVAL '1 day'
  ) AS d(day)
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS cnt
    FROM activity_logs
    WHERE created_at >= d.day AND created_at < d.day + INTERVAL '1 day'
  ) c ON true
  ORDER BY d.day;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
