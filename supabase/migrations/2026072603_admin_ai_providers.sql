-- ============================================================
-- ADMIN TASK 8: AI Providers Management RPCs
-- ============================================================

-- A1) Global AI consumption overview
CREATE OR REPLACE FUNCTION admin_ai_overview()
RETURNS TABLE (
  total_cost_usd numeric,
  total_invocations bigint,
  total_tokens bigint,
  total_prompt_tokens bigint,
  total_completion_tokens bigint,
  successful_invocations bigint,
  failed_invocations bigint,
  escalated_to_human bigint,
  avg_latency_ms numeric,
  cost_today numeric,
  cost_this_week numeric,
  cost_this_month numeric,
  active_workspaces bigint,
  total_workspaces bigint
) AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(SUM(i.cost_usd), 0)::numeric,
    COUNT(i.id)::bigint,
    COALESCE(SUM(i.total_tokens), 0)::bigint,
    COALESCE(SUM(i.prompt_tokens), 0)::bigint,
    COALESCE(SUM(i.completion_tokens), 0)::bigint,
    COUNT(*) FILTER (WHERE i.success = true)::bigint,
    COUNT(*) FILTER (WHERE i.success = false)::bigint,
    COUNT(*) FILTER (WHERE i.escalated_to_human = true)::bigint,
    COALESCE(AVG(i.latency_ms), 0)::numeric,
    COALESCE(SUM(i.cost_usd) FILTER (WHERE i.created_at >= DATE_TRUNC('day', NOW())), 0)::numeric,
    COALESCE(SUM(i.cost_usd) FILTER (WHERE i.created_at >= DATE_TRUNC('week', NOW())), 0)::numeric,
    COALESCE(SUM(i.cost_usd) FILTER (WHERE i.created_at >= DATE_TRUNC('month', NOW())), 0)::numeric,
    (SELECT COUNT(DISTINCT workspace_id) FROM ai_provider_configs WHERE is_active = true)::bigint,
    (SELECT COUNT(*) FROM workspaces)::bigint
  FROM ai_invocations i;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- A2) AI cost trend (last N days)
CREATE OR REPLACE FUNCTION admin_ai_cost_trend(p_days INT DEFAULT 30)
RETURNS TABLE (
  date TEXT,
  cost numeric,
  invocations bigint
) AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;

  RETURN QUERY
  SELECT
    TO_CHAR(d.day, 'YYYY-MM-DD') AS date,
    COALESCE(SUM(i.cost_usd), 0)::numeric AS cost,
    COUNT(i.id)::bigint AS invocations
  FROM generate_series(
    DATE_TRUNC('day', NOW()) - (p_days - 1) * INTERVAL '1 day',
    DATE_TRUNC('day', NOW()),
    INTERVAL '1 day'
  ) AS d(day)
  LEFT JOIN ai_invocations i ON i.created_at >= d.day AND i.created_at < d.day + INTERVAL '1 day'
  GROUP BY d.day
  ORDER BY d.day;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- A3) Top workspaces by AI cost
CREATE OR REPLACE FUNCTION admin_top_ai_workspaces(p_limit INT DEFAULT 10)
RETURNS TABLE (
  workspace_id UUID,
  workspace_name TEXT,
  total_cost numeric,
  invocations bigint,
  avg_cost_per_invocation numeric,
  success_rate numeric,
  is_active BOOLEAN,
  cost_cap_daily numeric,
  cost_cap_monthly numeric
) AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;

  RETURN QUERY
  SELECT
    w.id AS workspace_id,
    w.name AS workspace_name,
    COALESCE(SUM(i.cost_usd), 0)::numeric AS total_cost,
    COUNT(i.id)::bigint AS invocations,
    CASE WHEN COUNT(i.id) > 0 THEN (SUM(i.cost_usd) / COUNT(i.id))::numeric ELSE 0 END AS avg_cost_per_invocation,
    CASE WHEN COUNT(i.id) > 0 THEN (COUNT(*) FILTER (WHERE i.success = true)::numeric / COUNT(*)::numeric * 100) ELSE 0 END AS success_rate,
    COALESCE(c.is_active, false) AS is_active,
    COALESCE((c.cost_caps->>'daily_usd')::numeric, 0) AS cost_cap_daily,
    COALESCE((c.cost_caps->>'monthly_usd')::numeric, 0) AS cost_cap_monthly
  FROM workspaces w
  LEFT JOIN ai_invocations i ON i.workspace_id = w.id
  LEFT JOIN ai_provider_configs c ON c.workspace_id = w.id
  GROUP BY w.id, w.name, c.is_active, c.cost_caps
  ORDER BY total_cost DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- A4) List all AI provider configs
CREATE OR REPLACE FUNCTION admin_list_ai_configs(
  p_search TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL,
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0
) RETURNS TABLE (
  id UUID,
  workspace_id UUID,
  workspace_name TEXT,
  base_url TEXT,
  api_key_masked TEXT,
  models JSONB,
  settings JSONB,
  cost_caps JSONB,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  total_invocations bigint,
  total_cost numeric,
  cost_today numeric
) AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;

  RETURN QUERY
  SELECT
    c.id, c.workspace_id, w.name AS workspace_name, c.base_url,
    CASE WHEN c.api_key_enc IS NOT NULL AND LENGTH(c.api_key_enc) > 4
      THEN '••••' || RIGHT(c.api_key_enc, 4) ELSE NULL END AS api_key_masked,
    c.models, c.settings, c.cost_caps, c.is_active, c.created_at, c.updated_at,
    COALESCE(inv.total_invocations, 0)::bigint,
    COALESCE(inv.total_cost, 0)::numeric,
    COALESCE(inv.cost_today, 0)::numeric
  FROM ai_provider_configs c
  JOIN workspaces w ON w.id = c.workspace_id
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS total_invocations,
      COALESCE(SUM(cost_usd), 0) AS total_cost,
      COALESCE(SUM(cost_usd) FILTER (WHERE created_at >= DATE_TRUNC('day', NOW())), 0) AS cost_today
    FROM ai_invocations WHERE workspace_id = c.workspace_id
  ) inv ON true
  WHERE (p_search IS NULL OR w.name ILIKE '%' || p_search || '%' OR c.base_url ILIKE '%' || p_search || '%')
    AND (p_is_active IS NULL OR c.is_active = p_is_active)
  ORDER BY inv.total_cost DESC NULLS LAST
  LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- A5) Count AI configs
CREATE OR REPLACE FUNCTION admin_count_ai_configs(
  p_search TEXT DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT NULL
) RETURNS BIGINT AS $$
DECLARE v_count BIGINT;
BEGIN
  IF NOT is_super_admin() THEN RAISE EXCEPTION 'insufficient_privileges'; END IF;
  SELECT COUNT(*) INTO v_count FROM ai_provider_configs c
  JOIN workspaces w ON w.id = c.workspace_id
  WHERE (p_search IS NULL OR w.name ILIKE '%' || p_search || '%' OR c.base_url ILIKE '%' || p_search || '%')
    AND (p_is_active IS NULL OR c.is_active = p_is_active);
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- A6) Get single AI config detail
CREATE OR REPLACE FUNCTION admin_get_ai_config(p_config_id UUID)
RETURNS TABLE (
  id UUID, workspace_id UUID, workspace_name TEXT, base_url TEXT,
  api_key_masked TEXT, models JSONB, settings JSONB, cost_caps JSONB,
  is_active BOOLEAN, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
  router_rules_count bigint, knowledge_items_count bigint,
  total_invocations bigint, total_cost numeric, total_tokens bigint
) AS $$
BEGIN
  IF NOT is_super_admin() THEN RAISE EXCEPTION 'insufficient_privileges'; END IF;
  RETURN QUERY
  SELECT c.id, c.workspace_id, w.name AS workspace_name, c.base_url,
    CASE WHEN c.api_key_enc IS NOT NULL AND LENGTH(c.api_key_enc) > 4
      THEN '••••' || RIGHT(c.api_key_enc, 4) ELSE NULL END,
    c.models, c.settings, c.cost_caps, c.is_active, c.created_at, c.updated_at,
    (SELECT COUNT(*) FROM ai_router_rules WHERE workspace_id = c.workspace_id)::bigint,
    (SELECT COUNT(*) FROM ai_knowledge_base WHERE workspace_id = c.workspace_id)::bigint,
    COALESCE((SELECT COUNT(*) FROM ai_invocations WHERE workspace_id = c.workspace_id), 0)::bigint,
    COALESCE((SELECT SUM(cost_usd) FROM ai_invocations WHERE workspace_id = c.workspace_id), 0)::numeric,
    COALESCE((SELECT SUM(total_tokens) FROM ai_invocations WHERE workspace_id = c.workspace_id), 0)::bigint
  FROM ai_provider_configs c JOIN workspaces w ON w.id = c.workspace_id WHERE c.id = p_config_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'config_not_found'; END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- A7) Update AI config
CREATE OR REPLACE FUNCTION admin_update_ai_config(
  p_config_id UUID, p_base_url TEXT DEFAULT NULL, p_models JSONB DEFAULT NULL,
  p_settings JSONB DEFAULT NULL, p_cost_caps JSONB DEFAULT NULL
) RETURNS VOID AS $$
DECLARE v_workspace_id UUID;
BEGIN
  IF NOT is_super_admin() THEN RAISE EXCEPTION 'insufficient_privileges'; END IF;
  SELECT workspace_id INTO v_workspace_id FROM ai_provider_configs WHERE id = p_config_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'config_not_found'; END IF;
  UPDATE ai_provider_configs SET
    base_url = COALESCE(p_base_url, base_url), models = COALESCE(p_models, models),
    settings = COALESCE(p_settings, settings), cost_caps = COALESCE(p_cost_caps, cost_caps),
    updated_at = now() WHERE id = p_config_id;
  INSERT INTO activity_logs (user_id, workspace_id, action, resource_type, resource_id, description, metadata)
  VALUES (auth.uid(), v_workspace_id, 'admin_action', 'ai_config', p_config_id::text,
    'Updated AI provider config', jsonb_build_object('base_url', p_base_url, 'cost_caps', p_cost_caps));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- A8) Update API key
CREATE OR REPLACE FUNCTION admin_update_ai_api_key(p_config_id UUID, p_api_key TEXT) RETURNS VOID AS $$
DECLARE v_workspace_id UUID;
BEGIN
  IF NOT is_super_admin() THEN RAISE EXCEPTION 'insufficient_privileges'; END IF;
  SELECT workspace_id INTO v_workspace_id FROM ai_provider_configs WHERE id = p_config_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'config_not_found'; END IF;
  UPDATE ai_provider_configs SET api_key_enc = p_api_key, updated_at = now() WHERE id = p_config_id;
  INSERT INTO activity_logs (user_id, workspace_id, action, resource_type, resource_id, description, metadata)
  VALUES (auth.uid(), v_workspace_id, 'admin_action', 'ai_config', p_config_id::text,
    'Updated AI API key', '{}'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- A9) Toggle AI config
CREATE OR REPLACE FUNCTION admin_toggle_ai_config(p_config_id UUID, p_is_active BOOLEAN) RETURNS VOID AS $$
DECLARE v_workspace_id UUID;
BEGIN
  IF NOT is_super_admin() THEN RAISE EXCEPTION 'insufficient_privileges'; END IF;
  SELECT workspace_id INTO v_workspace_id FROM ai_provider_configs WHERE id = p_config_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'config_not_found'; END IF;
  UPDATE ai_provider_configs SET is_active = p_is_active, updated_at = now() WHERE id = p_config_id;
  INSERT INTO activity_logs (user_id, workspace_id, action, resource_type, resource_id, description, metadata)
  VALUES (auth.uid(), v_workspace_id, 'admin_action', 'ai_config', p_config_id::text,
    CASE WHEN p_is_active THEN 'Enabled AI for workspace' ELSE 'Disabled AI for workspace' END,
    jsonb_build_object('enabled', p_is_active));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- A10) List AI invocations
CREATE OR REPLACE FUNCTION admin_list_ai_invocations(
  p_workspace_id UUID DEFAULT NULL, p_model TEXT DEFAULT NULL,
  p_success BOOLEAN DEFAULT NULL, p_date_from TIMESTAMPTZ DEFAULT NULL,
  p_date_to TIMESTAMPTZ DEFAULT NULL, p_limit INT DEFAULT 20, p_offset INT DEFAULT 0
) RETURNS TABLE (
  id UUID, workspace_id UUID, workspace_name TEXT, level TEXT, intent TEXT,
  model TEXT, provider TEXT, prompt_tokens INT, completion_tokens INT,
  total_tokens INT, cost_usd numeric, latency_ms INT, confidence numeric,
  success BOOLEAN, error TEXT, escalated_to_human BOOLEAN, created_at TIMESTAMPTZ
) AS $$
BEGIN
  IF NOT is_super_admin() THEN RAISE EXCEPTION 'insufficient_privileges'; END IF;
  RETURN QUERY
  SELECT i.id, i.workspace_id, w.name, i.level, i.intent, i.model, i.provider,
    i.prompt_tokens, i.completion_tokens, i.total_tokens, i.cost_usd, i.latency_ms,
    i.confidence, i.success, i.error, i.escalated_to_human, i.created_at
  FROM ai_invocations i LEFT JOIN workspaces w ON w.id = i.workspace_id
  WHERE (p_workspace_id IS NULL OR i.workspace_id = p_workspace_id)
    AND (p_model IS NULL OR i.model ILIKE '%' || p_model || '%')
    AND (p_success IS NULL OR i.success = p_success)
    AND (p_date_from IS NULL OR i.created_at >= p_date_from)
    AND (p_date_to IS NULL OR i.created_at <= p_date_to)
  ORDER BY i.created_at DESC LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- A11) Count AI invocations
CREATE OR REPLACE FUNCTION admin_count_ai_invocations(
  p_workspace_id UUID DEFAULT NULL, p_model TEXT DEFAULT NULL,
  p_success BOOLEAN DEFAULT NULL, p_date_from TIMESTAMPTZ DEFAULT NULL,
  p_date_to TIMESTAMPTZ DEFAULT NULL
) RETURNS BIGINT AS $$
DECLARE v_count BIGINT;
BEGIN
  IF NOT is_super_admin() THEN RAISE EXCEPTION 'insufficient_privileges'; END IF;
  SELECT COUNT(*) INTO v_count FROM ai_invocations i
  WHERE (p_workspace_id IS NULL OR i.workspace_id = p_workspace_id)
    AND (p_model IS NULL OR i.model ILIKE '%' || p_model || '%')
    AND (p_success IS NULL OR i.success = p_success)
    AND (p_date_from IS NULL OR i.created_at >= p_date_from)
    AND (p_date_to IS NULL OR i.created_at <= p_date_to);
  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- A12) Model usage breakdown
CREATE OR REPLACE FUNCTION admin_ai_model_usage()
RETURNS TABLE (
  model TEXT, provider TEXT, invocations bigint, total_cost numeric,
  total_tokens bigint, avg_cost_per_invocation numeric, success_rate numeric
) AS $$
BEGIN
  IF NOT is_super_admin() THEN RAISE EXCEPTION 'insufficient_privileges'; END IF;
  RETURN QUERY
  SELECT i.model, i.provider, COUNT(*)::bigint, COALESCE(SUM(i.cost_usd), 0)::numeric,
    COALESCE(SUM(i.total_tokens), 0)::bigint,
    CASE WHEN COUNT(*) > 0 THEN (SUM(i.cost_usd) / COUNT(*))::numeric ELSE 0 END,
    CASE WHEN COUNT(*) > 0 THEN (COUNT(*) FILTER (WHERE i.success)::numeric / COUNT(*)::numeric * 100) ELSE 0 END
  FROM ai_invocations i GROUP BY i.model, i.provider ORDER BY total_cost DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
