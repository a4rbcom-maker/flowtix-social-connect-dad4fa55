
REVOKE EXECUTE ON FUNCTION public.assert_fb_campaigns_account_source_trigger_ok() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.assert_fb_campaigns_account_source_trigger_ok() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_fb_campaigns_account_source_trigger_ok() TO service_role;
