-- Manual invocation of the campaign-trigger regression test.
--
-- The heavy lifting (INSERT/UPDATE assertions, sub-transaction rollback of
-- fixture rows) lives inside the SECURITY DEFINER function
-- `regression.assert_fb_campaigns_account_source_trigger_ok()`.
--
-- Requires a role with USAGE on the `regression` schema (e.g. `service_role`
-- or `postgres`). The Supabase sandbox user does NOT have access; run this
-- against SUPABASE_DB_URL (superuser) or from backend code that authenticates
-- as `service_role`.
--
-- Expected output: a single row containing the text 'ok'.

\set ON_ERROR_STOP on
SELECT regression.assert_fb_campaigns_account_source_trigger_ok() AS result;
