-- Fix admin_create_subscription: cast p_status (text) to subscription_status enum
-- Compatible with 2026072716_remove_workspaces schema (workspace_id nullable)
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
DECLARE v_id uuid; v_plan RECORD;
BEGIN
  IF NOT is_super_admin() THEN RAISE EXCEPTION 'insufficient_privileges'; END IF;

  SELECT * INTO v_plan FROM plans WHERE id = p_plan_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'plan_not_found'; END IF;

  IF p_workspace_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM workspaces WHERE id = p_workspace_id) THEN
    RAISE EXCEPTION 'workspace_not_found';
  END IF;

  IF EXISTS (SELECT 1 FROM subscriptions WHERE workspace_id IS NOT DISTINCT FROM p_workspace_id AND plan_id = p_plan_id AND status = 'active') THEN
    RAISE EXCEPTION 'already_subscribed';
  END IF;

  INSERT INTO subscriptions (workspace_id, plan_id, status, current_period_start, current_period_end, metadata)
  VALUES (p_workspace_id, p_plan_id, p_status::subscription_status, now(),
    CASE WHEN v_plan."interval" = 'yearly' THEN now() + INTERVAL '1 year' ELSE now() + INTERVAL '1 month' END,
    '{}'::jsonb)
  RETURNING id INTO v_id;

  INSERT INTO activity_logs (user_id, workspace_id, action, resource_type, resource_id, description, metadata)
  VALUES (auth.uid(), p_workspace_id, 'admin_action', 'subscription', v_id::text,
    'Created subscription: ' || v_plan.name,
    jsonb_build_object('plan', v_plan.name, 'workspace', p_workspace_id));

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_create_subscription(uuid, uuid, text) TO authenticated;
NOTIFY pgrst, 'reload schema';
