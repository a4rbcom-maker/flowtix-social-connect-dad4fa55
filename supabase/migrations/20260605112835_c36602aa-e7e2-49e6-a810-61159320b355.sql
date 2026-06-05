-- Revoke column-level SELECT on sensitive credential columns from end-user roles.
-- These tokens are only needed in server-side code paths (which now use the service-role client).
REVOKE SELECT (access_token) ON public.facebook_connections FROM authenticated, anon;
REVOKE SELECT (encrypted_payload) ON public.fb_bot_accounts FROM authenticated, anon;
REVOKE SELECT (meta_access_token, meta_verify_token) ON public.whatsapp_settings FROM authenticated, anon;

-- Lock down SECURITY DEFINER admin reporting functions: only the service role should call them.
REVOKE EXECUTE ON FUNCTION public.admin_kpi_snapshot() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_daily_timeseries(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_kpi_snapshot() TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_daily_timeseries(integer) TO service_role;