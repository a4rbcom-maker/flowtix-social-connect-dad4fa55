-- Integration test for the fb_campaigns_validate_account_source trigger.
-- Verifies:
--   1. INSERT with posting_mode='bot_worker' and NULL account_id is rejected.
--   2. INSERT with posting_mode='graph_api'  and NULL graph_connection_id is rejected.
--   3. Valid INSERTs succeed for both posting modes.
--   4. Status-only UPDATEs on orphaned campaigns (both source columns NULL)
--      succeed — the trigger only re-validates when a source column changes.
--   5. UPDATE that changes posting_mode without providing the matching source
--      column is rejected.
--   6. UPDATE that nulls a source column (simulating FK ON DELETE SET NULL
--      cascade) succeeds and produces an orphaned campaign.
--
-- Runs inside a single transaction and ROLLBACKs so no rows persist.

\set ON_ERROR_STOP on

BEGIN;

DO $test$
DECLARE
  v_user_id           uuid;
  v_bot_account_id    uuid;
  v_graph_conn_id     uuid;
  v_campaign_id       uuid;
  v_orphan_id         uuid;
  v_errcode           text;
  v_expected_failures int := 0;
  v_seen_failures     int := 0;
BEGIN
  SELECT id INTO v_user_id FROM public.profiles LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'test fixture: no profile row available';
  END IF;

  SELECT id INTO v_bot_account_id
  FROM public.fb_bot_accounts WHERE user_id = v_user_id LIMIT 1;
  IF v_bot_account_id IS NULL THEN
    SELECT id INTO v_bot_account_id FROM public.fb_bot_accounts LIMIT 1;
  END IF;

  SELECT id INTO v_graph_conn_id
  FROM public.facebook_connections WHERE user_id = v_user_id LIMIT 1;
  IF v_graph_conn_id IS NULL THEN
    SELECT id INTO v_graph_conn_id FROM public.facebook_connections LIMIT 1;
  END IF;

  -- ─── 1. INSERT bot_worker without account_id → must fail ────────────────
  v_expected_failures := v_expected_failures + 1;
  BEGIN
    INSERT INTO public.fb_campaigns (user_id, name, posting_mode, account_id)
    VALUES (v_user_id, 't1_bot_no_account', 'bot_worker', NULL);
    RAISE EXCEPTION 'FAIL(1): bot_worker+NULL account_id was accepted';
  EXCEPTION WHEN check_violation THEN
    v_seen_failures := v_seen_failures + 1;
  END;

  -- ─── 2. INSERT graph_api without graph_connection_id → must fail ────────
  v_expected_failures := v_expected_failures + 1;
  BEGIN
    INSERT INTO public.fb_campaigns (user_id, name, posting_mode, graph_connection_id)
    VALUES (v_user_id, 't2_graph_no_conn', 'graph_api', NULL);
    RAISE EXCEPTION 'FAIL(2): graph_api+NULL graph_connection_id was accepted';
  EXCEPTION WHEN check_violation THEN
    v_seen_failures := v_seen_failures + 1;
  END;

  IF v_seen_failures <> v_expected_failures THEN
    RAISE EXCEPTION 'FAIL: expected % rejections, got %', v_expected_failures, v_seen_failures;
  END IF;

  -- ─── 3a. Valid bot_worker INSERT ────────────────────────────────────────
  IF v_bot_account_id IS NOT NULL THEN
    INSERT INTO public.fb_campaigns (user_id, name, posting_mode, account_id, status)
    VALUES (v_user_id, 't3a_bot_ok', 'bot_worker', v_bot_account_id, 'draft')
    RETURNING id INTO v_campaign_id;

    -- ─── 4. Status-only UPDATE on a valid campaign → must succeed ─────────
    UPDATE public.fb_campaigns
       SET status = 'running', done_targets = 1, success_count = 1
     WHERE id = v_campaign_id;

    -- ─── 6. Simulate FK cascade nulling account_id → must succeed ─────────
    UPDATE public.fb_campaigns SET account_id = NULL WHERE id = v_campaign_id;
    v_orphan_id := v_campaign_id;

    -- ─── 4b. Status/counter UPDATE on an ORPHANED campaign → must succeed ─
    UPDATE public.fb_campaigns
       SET status = 'failed', failed_count = failed_count + 1, done_targets = done_targets + 1
     WHERE id = v_orphan_id;

    -- ─── 5. UPDATE that changes posting_mode without matching source ──────
    BEGIN
      UPDATE public.fb_campaigns
         SET posting_mode = 'graph_api'
       WHERE id = v_orphan_id;
      RAISE EXCEPTION 'FAIL(5): posting_mode switch without graph_connection_id was accepted';
    EXCEPTION WHEN check_violation THEN
      NULL; -- expected
    END;
  END IF;

  -- ─── 3b. Valid graph_api INSERT ─────────────────────────────────────────
  IF v_graph_conn_id IS NOT NULL THEN
    INSERT INTO public.fb_campaigns (user_id, name, posting_mode, graph_connection_id)
    VALUES (v_user_id, 't3b_graph_ok', 'graph_api', v_graph_conn_id)
    RETURNING id INTO v_campaign_id;

    -- Status-only UPDATE succeeds
    UPDATE public.fb_campaigns SET status = 'running' WHERE id = v_campaign_id;

    -- Cascade null → orphan → status UPDATE still succeeds
    UPDATE public.fb_campaigns SET graph_connection_id = NULL WHERE id = v_campaign_id;
    UPDATE public.fb_campaigns
       SET status = 'completed', done_targets = done_targets + 1
     WHERE id = v_campaign_id;
  END IF;

  RAISE NOTICE 'fb_campaigns_validate_account_source: ALL CHECKS PASSED';
END
$test$;

ROLLBACK;
