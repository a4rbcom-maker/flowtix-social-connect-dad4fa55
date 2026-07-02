REVOKE EXECUTE ON FUNCTION public.wa_sync_conversation_last_message() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.wa_reconcile_conversation_order(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_reconcile_conversation_order(uuid) TO service_role;
