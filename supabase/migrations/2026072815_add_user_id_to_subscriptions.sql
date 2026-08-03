-- 1. Drop workspace_id, add user_id to subscriptions
ALTER TABLE subscriptions DROP COLUMN IF EXISTS workspace_id CASCADE;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);

-- 2. Drop all old overloads of admin_create_subscription
DROP FUNCTION IF EXISTS public.admin_create_subscription(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.admin_create_subscription(uuid, text);

-- 3. Recreate with user_id instead of workspace_id
CREATE OR REPLACE FUNCTION public.admin_create_subscription(
  p_user_id uuid,
  p_plan_id uuid,
  p_status text DEFAULT 'active'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_id uuid; v_plan RECORD;
BEGIN
  IF NOT is_super_admin() THEN RAISE EXCEPTION 'insufficient_privileges'; END IF;

  SELECT * INTO v_plan FROM plans WHERE id = p_plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'plan_not_found'; END IF;

  IF EXISTS (SELECT 1 FROM subscriptions WHERE user_id = p_user_id AND plan_id = p_plan_id AND status = 'active') THEN
    RAISE EXCEPTION 'already_subscribed';
  END IF;

  INSERT INTO subscriptions (user_id, plan_id, status, current_period_start, current_period_end, metadata)
  VALUES (p_user_id, p_plan_id, p_status::subscription_status, now(),
    CASE WHEN v_plan."interval" = 'yearly' THEN now() + INTERVAL '1 year' ELSE now() + INTERVAL '1 month' END,
    '{}'::jsonb)
  RETURNING id INTO v_id;

  INSERT INTO activity_logs (user_id, action, resource_type, resource_id, description, metadata)
  VALUES (auth.uid(), 'admin_action', 'subscription', v_id::text,
    'Created subscription: ' || v_plan.name,
    jsonb_build_object('plan', v_plan.name));

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_subscription(uuid, uuid, text) TO authenticated;

-- 4. Update admin_list_subscriptions to select user info
DROP FUNCTION IF EXISTS public.admin_list_subscriptions(text, text, integer, integer);
DROP FUNCTION IF EXISTS public.admin_list_subscriptions(text, text, integer, integer, text);

CREATE OR REPLACE FUNCTION public.admin_list_subscriptions(
  p_search text DEFAULT NULL::text,
  p_status text DEFAULT NULL::text,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid, user_id uuid, user_email text, user_name text,
  plan_id uuid, plan_name text, plan_interval text, plan_price_cents integer, plan_currency text,
  status text, current_period_start timestamptz, current_period_end timestamptz,
  trial_end timestamptz, canceled_at timestamptz,
  days_remaining bigint, created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT is_super_admin() THEN RAISE EXCEPTION 'insufficient_privileges'; END IF;
  RETURN QUERY
  SELECT
    s.id, s.user_id, COALESCE(u.email::TEXT, '—'), COALESCE(p.full_name, ''),
    s.plan_id, pl.name, pl."interval"::TEXT, pl.price_cents, COALESCE(pl.currency, 'usd'),
    s.status::TEXT, s.current_period_start, s.current_period_end,
    s.trial_end, s.canceled_at,
    CASE WHEN s.current_period_end IS NOT NULL THEN GREATEST(0, EXTRACT(EPOCH FROM s.current_period_end - now()) / 86400)::BIGINT ELSE NULL::BIGINT END,
    s.created_at
  FROM subscriptions s
  LEFT JOIN auth.users u ON u.id = s.user_id
  LEFT JOIN profiles p ON p.user_id = s.user_id
  JOIN plans pl ON pl.id = s.plan_id
  WHERE
    (p_search IS NULL OR u.email ILIKE '%' || p_search || '%' OR p.full_name ILIKE '%' || p_search || '%' OR pl.name ILIKE '%' || p_search || '%')
    AND (p_status IS NULL OR s.status::TEXT = p_status)
  ORDER BY s.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_list_subscriptions(text, text, integer, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';