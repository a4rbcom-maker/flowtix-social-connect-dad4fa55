
CREATE OR REPLACE FUNCTION public.assert_fb_campaigns_account_source_trigger_ok()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_user_id        uuid;
  v_bot_account_id uuid;
  v_graph_conn_id  uuid;
  v_campaign_id    uuid;
  v_orphan_id      uuid;
  v_rejected       boolean;
BEGIN
  SELECT id INTO v_user_id FROM public.profiles LIMIT 1;
  IF v_user_id IS NULL THEN
    RETURN 'skip: no profile fixture';
  END IF;

  SELECT id INTO v_bot_account_id FROM public.fb_bot_accounts LIMIT 1;
  SELECT id INTO v_graph_conn_id  FROM public.facebook_connections LIMIT 1;

  --------------------------------------------------------------------
  -- Case 1: INSERT posting_mode='bot_worker' with NULL account_id
  --         must be REJECTED by the trigger.
  --------------------------------------------------------------------
  v_rejected := false;
  BEGIN
    INSERT INTO public.fb_campaigns (user_id, name, posting_mode, account_id)
    VALUES (v_user_id, '__assert_bot_no_account__', 'bot_worker', NULL);
  EXCEPTION WHEN check_violation THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'assert(1) failed: bot_worker + NULL account_id was accepted';
  END IF;

  --------------------------------------------------------------------
  -- Case 2: INSERT posting_mode='graph_api' with NULL graph_connection_id
  --         must be REJECTED by the trigger.
  --------------------------------------------------------------------
  v_rejected := false;
  BEGIN
    INSERT INTO public.fb_campaigns (user_id, name, posting_mode, graph_connection_id)
    VALUES (v_user_id, '__assert_graph_no_conn__', 'graph_api', NULL);
  EXCEPTION WHEN check_violation THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'assert(2) failed: graph_api + NULL graph_connection_id was accepted';
  END IF;

  --------------------------------------------------------------------
  -- Cases 3-6 need a real bot account fixture. Wrap in a sub-transaction
  -- whose EXCEPTION handler is guaranteed to roll everything back.
  --------------------------------------------------------------------
  IF v_bot_account_id IS NOT NULL THEN
    BEGIN
      INSERT INTO public.fb_campaigns (user_id, name, posting_mode, account_id, status)
      VALUES (v_user_id, '__assert_bot_ok__', 'bot_worker', v_bot_account_id, 'draft')
      RETURNING id INTO v_campaign_id;

      -- Case 3: status-only UPDATE on a valid campaign — trigger must NOT fire strict path.
      UPDATE public.fb_campaigns
         SET status = 'running', done_targets = 1, success_count = 1
       WHERE id = v_campaign_id;

      -- Case 4: simulate FK ON DELETE SET NULL cascade — clearing account_id must succeed.
      UPDATE public.fb_campaigns SET account_id = NULL WHERE id = v_campaign_id;
      v_orphan_id := v_campaign_id;

      -- Case 5: status/counter UPDATE on an ORPHAN (both sources NULL) must succeed.
      UPDATE public.fb_campaigns
         SET status        = 'failed',
             failed_count  = failed_count  + 1,
             done_targets  = done_targets  + 1
       WHERE id = v_orphan_id;

      -- Case 6: switching posting_mode without the matching source must be REJECTED.
      v_rejected := false;
      BEGIN
        UPDATE public.fb_campaigns
           SET posting_mode = 'graph_api'
         WHERE id = v_orphan_id;
      EXCEPTION WHEN check_violation THEN
        v_rejected := true;
      END;
      IF NOT v_rejected THEN
        RAISE EXCEPTION 'assert(6) failed: posting_mode switch without graph_connection_id was accepted';
      END IF;

      -- Force rollback of all bot-worker fixture rows via a sentinel exception.
      RAISE EXCEPTION '__ROLLBACK_BOT_FIXTURES__';
    EXCEPTION
      WHEN raise_exception THEN
        IF SQLERRM <> '__ROLLBACK_BOT_FIXTURES__' THEN RAISE; END IF;
    END;
  END IF;

  IF v_graph_conn_id IS NOT NULL THEN
    BEGIN
      INSERT INTO public.fb_campaigns (user_id, name, posting_mode, graph_connection_id)
      VALUES (v_user_id, '__assert_graph_ok__', 'graph_api', v_graph_conn_id)
      RETURNING id INTO v_campaign_id;

      -- Status-only UPDATE on valid graph_api campaign.
      UPDATE public.fb_campaigns SET status = 'running' WHERE id = v_campaign_id;

      -- Cascade-null → orphan → status UPDATE must still succeed.
      UPDATE public.fb_campaigns SET graph_connection_id = NULL WHERE id = v_campaign_id;
      UPDATE public.fb_campaigns
         SET status = 'completed', done_targets = done_targets + 1
       WHERE id = v_campaign_id;

      RAISE EXCEPTION '__ROLLBACK_GRAPH_FIXTURES__';
    EXCEPTION
      WHEN raise_exception THEN
        IF SQLERRM <> '__ROLLBACK_GRAPH_FIXTURES__' THEN RAISE; END IF;
    END;
  END IF;

  RETURN 'ok';
END;
$fn$;

REVOKE ALL ON FUNCTION public.assert_fb_campaigns_account_source_trigger_ok() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_fb_campaigns_account_source_trigger_ok() TO authenticated, service_role;
