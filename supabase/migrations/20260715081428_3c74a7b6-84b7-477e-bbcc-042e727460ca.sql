
REVOKE ALL ON FUNCTION public.wa_enforce_session_limit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wa_promote_next_primary() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wa_user_session_limit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wa_user_session_limit(uuid) TO authenticated;
