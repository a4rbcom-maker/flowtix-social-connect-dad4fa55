-- Fix admin_list_subscriptions: use LEFT JOIN auth.users, explicit type casts
CREATE OR REPLACE FUNCTION public.admin_list_subscriptions(
  p_search text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  user_id uuid,
  user_email text,
  user_name text,
  plan_id uuid,
  plan_name text,
  plan_interval text,
  plan_price_cents bigint,
  plan_currency text,
  status text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_end timestamptz,
  canceled_at timestamptz,
  days_remaining bigint,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT is_super_admin() THEN RAISE EXCEPTION 'insufficient_privileges'; END IF;
  RETURN QUERY
  SELECT
    s.id,
    s.user_id,
    u.email::text,
    COALESCE(p.full_name, '')::text,
    s.plan_id,
    pl.name,
    pl."interval"::text,
    pl.price_cents::bigint,
    COALESCE(pl.currency, 'usd')::text,
    s.status::text,
    s.current_period_start,
    s.current_period_end,
    s.trial_end,
    s.canceled_at,
    CASE WHEN s.current_period_end IS NOT NULL
      THEN GREATEST(0, EXTRACT(EPOCH FROM (s.current_period_end - now())) / 86400)::bigint
      ELSE NULL END,
    s.created_at
  FROM subscriptions s
  LEFT JOIN auth.users u ON u.id = s.user_id
  LEFT JOIN profiles p ON p.user_id = s.user_id
  JOIN plans pl ON pl.id = s.plan_id
  WHERE
    (p_search IS NULL
      OR u.email ILIKE '%' || p_search || '%'
      OR p.full_name ILIKE '%' || p_search || '%'
      OR pl.name ILIKE '%' || p_search || '%')
    AND (p_status IS NULL OR s.status::text = p_status)
  ORDER BY s.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$function$;
