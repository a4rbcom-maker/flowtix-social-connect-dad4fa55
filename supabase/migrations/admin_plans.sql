-- ============================================================
-- ADMIN TASK 4: Plans Management RPCs
-- ============================================================

-- A1) List plans with subscriber counts
CREATE OR REPLACE FUNCTION admin_list_plans()
RETURNS TABLE (
  id uuid,
  name text,
  key text,
  description text,
  price_cents bigint,
  currency text,
  interval text,
  trial_days int,
  limits json,
  sort_order int,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz,
  active_subscriptions bigint,
  total_subscriptions bigint
) AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.name,
    p.key,
    COALESCE(p.description, '')::text,
    p.price_cents::bigint,
    p.currency,
    p.interval::text,
    p.trial_days,
    p.limits,
    p.sort_order,
    p.is_active,
    p.created_at,
    p.updated_at,
    (SELECT COUNT(*) FROM subscriptions s WHERE s.plan_id = p.id AND s.status = 'active')::bigint,
    (SELECT COUNT(*) FROM subscriptions s WHERE s.plan_id = p.id)::bigint
  FROM plans p
  ORDER BY p.sort_order, p.created_at;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- A2) Get single plan
CREATE OR REPLACE FUNCTION admin_get_plan(
  p_plan_id uuid
)
RETURNS TABLE (
  id uuid,
  name text,
  key text,
  description text,
  price_cents bigint,
  currency text,
  interval text,
  trial_days int,
  limits json,
  sort_order int,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
) AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;

  RETURN QUERY
  SELECT
    p.id, p.name, p.key,
    COALESCE(p.description, '')::text,
    p.price_cents::bigint, p.currency, p.interval::text,
    p.trial_days, p.limits, p.sort_order, p.is_active,
    p.created_at, p.updated_at
  FROM plans p
  WHERE p.id = p_plan_id;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- A3) Create plan
CREATE OR REPLACE FUNCTION admin_create_plan(
  p_name text,
  p_key text,
  p_description text DEFAULT NULL,
  p_price_cents int DEFAULT 0,
  p_currency text DEFAULT 'USD',
  p_interval text DEFAULT 'monthly',
  p_trial_days int DEFAULT 0,
  p_limits json DEFAULT NULL,
  p_sort_order int DEFAULT 0
)
RETURNS uuid AS $$
DECLARE
  v_id uuid;
  v_exists boolean;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;

  -- التحقق من عدم تكرار المفتاح
  SELECT EXISTS(SELECT 1 FROM plans WHERE key = p_key) INTO v_exists;
  IF v_exists THEN
    RAISE EXCEPTION 'plan_key_exists';
  END IF;

  INSERT INTO plans (
    name, key, description, price_cents, currency, interval, trial_days, limits, sort_order, is_active
  ) VALUES (
    p_name, p_key, p_description, p_price_cents, p_currency, p_interval::plan_interval,
    p_trial_days, COALESCE(p_limits, '{}'::json), p_sort_order, true
  )
  RETURNING id INTO v_id;

  INSERT INTO activity_logs (user_id, workspace_id, action, description, resource_id, resource_type, metadata)
  VALUES (
    auth.uid(), NULL, 'admin_action'::activity_action,
    'Created plan ' || p_name, v_id, 'plan',
    jsonb_build_object('name', p_name, 'key', p_key, 'price_cents', p_price_cents)
  );

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- A4) Update plan
CREATE OR REPLACE FUNCTION admin_update_plan(
  p_plan_id uuid,
  p_name text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_price_cents int DEFAULT NULL,
  p_currency text DEFAULT NULL,
  p_interval text DEFAULT NULL,
  p_trial_days int DEFAULT NULL,
  p_limits json DEFAULT NULL,
  p_sort_order int DEFAULT NULL
)
RETURNS void AS $$
DECLARE
  v_old json;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;

  SELECT to_jsonb(p) INTO v_old FROM plans p WHERE id = p_plan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'plan_not_found';
  END IF;

  UPDATE plans SET
    name = COALESCE(p_name, name),
    description = COALESCE(p_description, description),
    price_cents = COALESCE(p_price_cents, price_cents),
    currency = COALESCE(p_currency, currency),
    interval = COALESCE(p_interval::plan_interval, interval),
    trial_days = COALESCE(p_trial_days, trial_days),
    limits = COALESCE(p_limits, limits),
    sort_order = COALESCE(p_sort_order, sort_order),
    updated_at = now()
  WHERE id = p_plan_id;

  INSERT INTO activity_logs (user_id, workspace_id, action, description, resource_id, resource_type, metadata)
  VALUES (
    auth.uid(), NULL, 'admin_action'::activity_action,
    'Updated plan ' || p_plan_id, p_plan_id, 'plan',
    jsonb_build_object('old', v_old)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- A5) Toggle plan active state
CREATE OR REPLACE FUNCTION admin_toggle_plan(
  p_plan_id uuid,
  p_is_active boolean
)
RETURNS void AS $$
DECLARE
  v_name text;
  v_active_subs bigint;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;

  SELECT name INTO v_name FROM plans WHERE id = p_plan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'plan_not_found';
  END IF;

  -- منع تعطيل باقة عليها اشتراكات نشطة
  IF p_is_active = false THEN
    SELECT COUNT(*) INTO v_active_subs
    FROM subscriptions WHERE plan_id = p_plan_id AND status = 'active';
    IF v_active_subs > 0 THEN
      RAISE EXCEPTION 'plan_has_active_subscriptions';
    END IF;
  END IF;

  UPDATE plans SET is_active = p_is_active, updated_at = now() WHERE id = p_plan_id;

  INSERT INTO activity_logs (user_id, workspace_id, action, description, resource_id, resource_type, metadata)
  VALUES (
    auth.uid(), NULL, 'admin_action'::activity_action,
    CASE WHEN p_is_active THEN 'Activated plan ' ELSE 'Deactivated plan ' END || v_name,
    p_plan_id, 'plan', jsonb_build_object('is_active', p_is_active)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- A6) Reorder plans (batch update sort_order)
CREATE OR REPLACE FUNCTION admin_reorder_plans(
  p_orders json   -- [{id, sort_order}, ...]
)
RETURNS void AS $$
DECLARE
  v_item json;
  v_id uuid;
  v_sort int;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;

  FOR v_item IN SELECT * FROM json_array_elements(p_orders)
  LOOP
    v_id := (v_item->>'id')::uuid;
    v_sort := (v_item->>'sort_order')::int;
    UPDATE plans SET sort_order = v_sort, updated_at = now() WHERE id = v_id;
  END LOOP;

  INSERT INTO activity_logs (user_id, workspace_id, action, description, resource_id, resource_type)
  VALUES (auth.uid(), NULL, 'admin_action'::activity_action, 'Reordered plans', NULL, 'plan');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
