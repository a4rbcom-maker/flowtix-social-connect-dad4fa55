-- Revoke EXECUTE on SECURITY DEFINER functions from signed-in users.
-- has_role is intentionally callable by authenticated (used in RLS policies) — leave it alone.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_kpi_snapshot() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_daily_timeseries(integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.admin_kpi_snapshot() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_daily_timeseries(integer) TO service_role;
-- handle_new_user runs as a trigger on auth.users; no role needs direct EXECUTE.