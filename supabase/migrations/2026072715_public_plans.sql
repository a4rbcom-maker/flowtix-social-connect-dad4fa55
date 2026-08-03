-- 1. Add new columns to plans table
ALTER TABLE plans ADD COLUMN IF NOT EXISTS features jsonb DEFAULT '[]'::jsonb;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS is_popular boolean DEFAULT false;

-- 2. Update admin_list_plans to include features and is_popular
DROP FUNCTION IF EXISTS public.admin_list_plans();

CREATE OR REPLACE FUNCTION public.admin_list_plans()
RETURNS TABLE(
  id uuid, key text, name text, description text, price_cents integer,
  currency text, plan_interval text, trial_days integer, limits jsonb,
  is_active boolean, sort_order integer, created_at timestamptz, updated_at timestamptz,
  active_subscriptions bigint, total_subscriptions bigint,
  features jsonb, is_popular boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;

  RETURN QUERY SELECT
    p.id, p.key, p.name, p.description, p.price_cents, p.currency,
    p."interval"::text, p.trial_days, p.limits, p.is_active, p.sort_order,
    p.created_at, p.updated_at,
    COALESCE((SELECT COUNT(*) FROM subscriptions WHERE plan_id = p.id AND status = 'active'), 0)::BIGINT,
    COALESCE((SELECT COUNT(*) FROM subscriptions WHERE plan_id = p.id), 0)::BIGINT,
    COALESCE(p.features, '[]'::jsonb),
    COALESCE(p.is_popular, false)
  FROM plans p
  ORDER BY p.sort_order ASC, p.created_at DESC;
END;
$$;

-- 3. Update admin_create_plan to add p_features and p_is_popular
DROP FUNCTION IF EXISTS public.admin_create_plan(text, text, integer, text, text, text, integer, jsonb, integer);

CREATE OR REPLACE FUNCTION public.admin_create_plan(
  p_name text, p_key text, p_price_cents integer,
  p_description text DEFAULT NULL,
  p_currency text DEFAULT 'USD',
  p_interval text DEFAULT 'monthly',
  p_trial_days integer DEFAULT 0,
  p_limits jsonb DEFAULT NULL,
  p_sort_order integer DEFAULT 0,
  p_features jsonb DEFAULT '[]'::jsonb,
  p_is_popular boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_id UUID;
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'insufficient_privileges'; END IF;
  IF p_key !~ '^[a-z0-9_-]+$' THEN RAISE EXCEPTION 'invalid_key'; END IF;
  IF EXISTS (SELECT 1 FROM plans WHERE key = p_key) THEN RAISE EXCEPTION 'key_exists'; END IF;
  IF p_interval NOT IN ('monthly', 'yearly') THEN RAISE EXCEPTION 'invalid_interval'; END IF;

  INSERT INTO plans (name, key, description, price_cents, currency, "interval", trial_days, limits, sort_order, is_active, features, is_popular)
  VALUES (p_name, p_key, p_description, p_price_cents, COALESCE(p_currency,'USD'),
    p_interval::plan_interval, p_trial_days, COALESCE(p_limits, '{}'::jsonb), p_sort_order, true,
    COALESCE(p_features, '[]'::jsonb), COALESCE(p_is_popular, false))
  RETURNING id INTO v_id;

  INSERT INTO activity_logs (user_id, workspace_id, action, resource_type, resource_id, description, metadata)
  VALUES (auth.uid(), NULL, 'admin_action', 'plan', v_id::text, 'Created plan: ' || p_name, jsonb_build_object('key', p_key, 'name', p_name));

  RETURN v_id;
END;
$$;

-- 4. Update admin_update_plan to add p_features and p_is_popular
DROP FUNCTION IF EXISTS public.admin_update_plan(uuid, text, text, integer, text, text, integer, jsonb, integer);

CREATE OR REPLACE FUNCTION public.admin_update_plan(
  p_plan_id uuid,
  p_name text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_price_cents integer DEFAULT NULL,
  p_currency text DEFAULT NULL,
  p_interval text DEFAULT NULL,
  p_trial_days integer DEFAULT NULL,
  p_limits jsonb DEFAULT NULL,
  p_sort_order integer DEFAULT NULL,
  p_features jsonb DEFAULT NULL,
  p_is_popular boolean DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'insufficient_privileges'; END IF;

  UPDATE plans SET
    name = COALESCE(p_name, name),
    description = p_description,
    price_cents = COALESCE(p_price_cents, price_cents),
    currency = COALESCE(p_currency, currency),
    "interval" = COALESCE(p_interval::plan_interval, "interval"),
    trial_days = COALESCE(p_trial_days, trial_days),
    limits = COALESCE(p_limits, limits),
    sort_order = COALESCE(p_sort_order, sort_order),
    features = COALESCE(p_features, features),
    is_popular = COALESCE(p_is_popular, is_popular),
    updated_at = now()
  WHERE id = p_plan_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'plan_not_found'; END IF;

  INSERT INTO activity_logs (user_id, workspace_id, action, resource_type, resource_id, description, metadata)
  VALUES (auth.uid(), NULL, 'admin_action', 'plan', p_plan_id::text, 'Updated plan', jsonb_build_object('name', p_name));
END;
$$;

-- 5. Create list_public_plans (accessible by anon)
CREATE OR REPLACE FUNCTION public.list_public_plans()
RETURNS TABLE(
  id uuid, key text, name text, description text, price_cents integer,
  currency text, plan_interval text, trial_days integer, limits jsonb,
  is_active boolean, sort_order integer,
  features jsonb, is_popular boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT p.id, p.key, p.name, p.description, p.price_cents, p.currency,
    p."interval"::text, p.trial_days, p.limits, p.is_active, p.sort_order,
    COALESCE(p.features, '[]'::jsonb), COALESCE(p.is_popular, false)
  FROM plans p
  WHERE p.is_active = true
  ORDER BY p.sort_order ASC;
$$;

-- 6. Grant permissions
GRANT EXECUTE ON FUNCTION public.admin_list_plans() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_plan(text, text, integer, text, text, text, integer, jsonb, integer, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_plan(uuid, text, text, integer, text, text, integer, jsonb, integer, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_public_plans() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';