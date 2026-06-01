
REVOKE EXECUTE ON FUNCTION public.admin_kpi_snapshot() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_daily_timeseries(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_kpi_snapshot() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_daily_timeseries(integer) TO service_role;
