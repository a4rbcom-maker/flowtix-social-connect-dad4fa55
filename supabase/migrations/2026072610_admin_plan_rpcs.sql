-- Admin Plan Management RPCs
-- Note: "interval" is a PostgreSQL reserved word, must be quoted as \"interval\" in non-RETURNS TABLE contexts

CREATE OR REPLACE FUNCTION admin_create_plan(
  p_name TEXT, p_key TEXT, p_price_cents INT,
  p_description TEXT DEFAULT NULL, p_currency TEXT DEFAULT 'USD',
  p_interval TEXT DEFAULT 'monthly', p_trial_days INT DEFAULT 0,
  p_limits JSONB DEFAULT NULL, p_sort_order INT DEFAULT 0
) RETURNS UUID AS $$
DECLARE v_id UUID;
BEGIN
  IF NOT is_super_admin() THEN RAISE EXCEPTION 'insufficient_privileges'; END IF;
  IF p_key !~ '^[a-z0-9_-]+$' THEN RAISE EXCEPTION 'invalid_key'; END IF;
  IF EXISTS (SELECT 1 FROM plans WHERE key = p_key) THEN RAISE EXCEPTION 'key_exists'; END IF;
  IF p_interval NOT IN ('monthly', 'yearly') THEN RAISE EXCEPTION 'invalid_interval'; END IF;
  INSERT INTO plans (name, key, description, price_cents, currency, "interval", trial_days, limits, sort_order, is_active)
  VALUES (p_name, p_key, p_description, p_price_cents, COALESCE(p_currency,'USD'), p_interval, p_trial_days, COALESCE(p_limits, '{}'::jsonb), p_sort_order, true)
  RETURNING id INTO v_id;
  INSERT INTO activity_logs (user_id, workspace_id, action, resource_type, resource_id, description, metadata)
  VALUES (auth.uid(), NULL, 'admin_action', 'plan', v_id::text, 'Created plan: ' || p_name, jsonb_build_object('key', p_key, 'name', p_name));
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_update_plan(
  p_plan_id UUID, p_name TEXT DEFAULT NULL, p_description TEXT DEFAULT NULL,
  p_price_cents INT DEFAULT NULL, p_currency TEXT DEFAULT NULL,
  p_interval TEXT DEFAULT NULL, p_trial_days INT DEFAULT NULL,
  p_limits JSONB DEFAULT NULL, p_sort_order INT DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  IF NOT is_super_admin() THEN RAISE EXCEPTION 'insufficient_privileges'; END IF;
  UPDATE plans SET name = COALESCE(p_name, name), description = p_description,
    price_cents = COALESCE(p_price_cents, price_cents), currency = COALESCE(p_currency, currency),
    "interval" = COALESCE(p_interval, "interval"), trial_days = COALESCE(p_trial_days, trial_days),
    limits = COALESCE(p_limits, limits), sort_order = COALESCE(p_sort_order, sort_order), updated_at = now()
  WHERE id = p_plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'plan_not_found'; END IF;
  INSERT INTO activity_logs (user_id, workspace_id, action, resource_type, resource_id, description, metadata)
  VALUES (auth.uid(), NULL, 'admin_action', 'plan', p_plan_id::text, 'Updated plan', jsonb_build_object('name', p_name));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_toggle_plan(p_plan_id UUID, p_is_active BOOLEAN) RETURNS VOID AS $$
BEGIN
  IF NOT is_super_admin() THEN RAISE EXCEPTION 'insufficient_privileges'; END IF;
  IF NOT p_is_active AND EXISTS (SELECT 1 FROM subscriptions WHERE plan_id = p_plan_id AND status = 'active') THEN
    RAISE EXCEPTION 'active_subscriptions';
  END IF;
  UPDATE plans SET is_active = p_is_active, updated_at = now() WHERE id = p_plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'plan_not_found'; END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_get_plan(p_plan_id UUID)
RETURNS TABLE (id UUID, key TEXT, name TEXT, description TEXT, price_cents INT, currency TEXT,
  plan_interval TEXT, trial_days INT, limits JSONB, is_active BOOLEAN, sort_order INT,
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, active_subscriptions BIGINT, total_subscriptions BIGINT) AS $$
BEGIN
  IF NOT is_super_admin() THEN RAISE EXCEPTION 'insufficient_privileges'; END IF;
  RETURN QUERY SELECT p.id, p.key, p.name, p.description, p.price_cents, p.currency, p."interval"::text,
    p.trial_days, p.limits, p.is_active, p.sort_order, p.created_at, p.updated_at,
    COALESCE((SELECT COUNT(*) FROM subscriptions WHERE plan_id = p.id AND status = 'active'), 0)::BIGINT,
    COALESCE((SELECT COUNT(*) FROM subscriptions WHERE plan_id = p.id), 0)::BIGINT
  FROM plans p WHERE p.id = p_plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'plan_not_found'; END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_reorder_plans(p_orders JSONB) RETURNS VOID AS $$
DECLARE item JSONB;
BEGIN
  IF NOT is_super_admin() THEN RAISE EXCEPTION 'insufficient_privileges'; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(p_orders) LOOP
    UPDATE plans SET sort_order = (item->>'sort_order')::int, updated_at = now()
    WHERE id = (item->>'id')::uuid;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
