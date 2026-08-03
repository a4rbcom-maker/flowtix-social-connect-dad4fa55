-- Fix RLS policies after workspace_id removal (migration 2026072716)
-- The original RLS policies were created outside project and reference
-- workspace_id via current_workspace_id(). This migration replaces all
-- of them with user_id-based policies.

-- ============================================================
-- 1. Recreate current_workspace_id() — profiles.workspace_id was dropped.
--    Now returns auth.uid() since all tables use user_id for ownership.
-- ============================================================
DROP FUNCTION IF EXISTS current_workspace_id() CASCADE;
CREATE OR REPLACE FUNCTION current_workspace_id()
RETURNS UUID AS $$
BEGIN
    RETURN auth.uid();
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = '';

DROP FUNCTION IF EXISTS _current_workspace_id() CASCADE;
CREATE OR REPLACE FUNCTION _current_workspace_id()
RETURNS UUID AS $$
BEGIN
    RETURN auth.uid();
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = '';

-- ============================================================
-- 2. fb_sessions RLS → user_id
-- ============================================================
DROP POLICY IF EXISTS select_own_fb_sessions ON public.fb_sessions;
DROP POLICY IF EXISTS insert_own_fb_sessions ON public.fb_sessions;
DROP POLICY IF EXISTS update_own_fb_sessions ON public.fb_sessions;
DROP POLICY IF EXISTS delete_own_fb_sessions ON public.fb_sessions;

CREATE POLICY select_own_fb_sessions ON public.fb_sessions
  FOR SELECT USING (user_id = auth.uid() OR is_super_admin());

CREATE POLICY insert_own_fb_sessions ON public.fb_sessions
  FOR INSERT WITH CHECK (user_id = auth.uid() OR is_super_admin());

CREATE POLICY update_own_fb_sessions ON public.fb_sessions
  FOR UPDATE
  USING (user_id = auth.uid() OR is_super_admin())
  WITH CHECK (user_id = auth.uid() OR is_super_admin());

CREATE POLICY delete_own_fb_sessions ON public.fb_sessions
  FOR DELETE USING (user_id = auth.uid() OR is_super_admin());

-- ============================================================
-- 3. fb_browser_profiles RLS → user_id
-- ============================================================
DROP POLICY IF EXISTS select_own_browser_profiles ON public.fb_browser_profiles;
DROP POLICY IF EXISTS insert_own_browser_profiles ON public.fb_browser_profiles;
DROP POLICY IF EXISTS update_own_browser_profiles ON public.fb_browser_profiles;
DROP POLICY IF EXISTS delete_own_browser_profiles ON public.fb_browser_profiles;

CREATE POLICY select_own_browser_profiles ON public.fb_browser_profiles
  FOR SELECT USING (user_id = auth.uid() OR is_super_admin());

CREATE POLICY insert_own_browser_profiles ON public.fb_browser_profiles
  FOR INSERT WITH CHECK (user_id = auth.uid() OR is_super_admin());

CREATE POLICY update_own_browser_profiles ON public.fb_browser_profiles
  FOR UPDATE
  USING (user_id = auth.uid() OR is_super_admin())
  WITH CHECK (user_id = auth.uid() OR is_super_admin());

CREATE POLICY delete_own_browser_profiles ON public.fb_browser_profiles
  FOR DELETE USING (user_id = auth.uid() OR is_super_admin());

-- ============================================================
-- 4. fb_session_activity, fb_session_events, fb_session_status_history
--    fb_connection_attempts, session_lifecycle_logs → user_id
-- ============================================================
DROP POLICY IF EXISTS select_own_activity ON public.fb_session_activity;
DROP POLICY IF EXISTS insert_own_activity ON public.fb_session_activity;
CREATE POLICY select_own_activity ON public.fb_session_activity
  FOR SELECT USING (user_id = auth.uid() OR is_super_admin());
CREATE POLICY insert_own_activity ON public.fb_session_activity
  FOR INSERT WITH CHECK (user_id = auth.uid() OR is_super_admin());

DROP POLICY IF EXISTS select_own_events ON public.fb_session_events;
DROP POLICY IF EXISTS insert_own_events ON public.fb_session_events;
CREATE POLICY select_own_events ON public.fb_session_events
  FOR SELECT USING (user_id = auth.uid() OR is_super_admin());
CREATE POLICY insert_own_events ON public.fb_session_events
  FOR INSERT WITH CHECK (user_id = auth.uid() OR is_super_admin());

DROP POLICY IF EXISTS select_own_history ON public.fb_session_status_history;
DROP POLICY IF EXISTS insert_own_history ON public.fb_session_status_history;
CREATE POLICY select_own_history ON public.fb_session_status_history
  FOR SELECT USING (user_id = auth.uid() OR is_super_admin());
CREATE POLICY insert_own_history ON public.fb_session_status_history
  FOR INSERT WITH CHECK (user_id = auth.uid() OR is_super_admin());

DROP POLICY IF EXISTS select_own_attempts ON public.fb_connection_attempts;
DROP POLICY IF EXISTS insert_own_attempts ON public.fb_connection_attempts;
CREATE POLICY select_own_attempts ON public.fb_connection_attempts
  FOR SELECT USING (user_id = auth.uid() OR is_super_admin());
CREATE POLICY insert_own_attempts ON public.fb_connection_attempts
  FOR INSERT WITH CHECK (user_id = auth.uid() OR is_super_admin());

DROP POLICY IF EXISTS select_own_lifecycle ON public.session_lifecycle_logs;
DROP POLICY IF EXISTS insert_own_lifecycle ON public.session_lifecycle_logs;
CREATE POLICY select_own_lifecycle ON public.session_lifecycle_logs
  FOR SELECT USING (user_id = auth.uid() OR is_super_admin());
CREATE POLICY insert_own_lifecycle ON public.session_lifecycle_logs
  FOR INSERT WITH CHECK (user_id = auth.uid() OR is_super_admin());

-- ============================================================
-- 5. Facebook accounts & pages → user_id (conditional, some tables lack it)
-- ============================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='facebook_accounts' AND column_name='user_id') THEN
    DROP POLICY IF EXISTS select_own_facebook ON facebook_accounts;
    DROP POLICY IF EXISTS insert_own_facebook ON facebook_accounts;
    DROP POLICY IF EXISTS update_own_facebook ON facebook_accounts;
    DROP POLICY IF EXISTS delete_own_facebook ON facebook_accounts;
    CREATE POLICY select_own_facebook ON facebook_accounts FOR SELECT USING (user_id = auth.uid() OR is_super_admin());
    CREATE POLICY insert_own_facebook ON facebook_accounts FOR INSERT WITH CHECK (user_id = auth.uid() OR is_super_admin());
    CREATE POLICY update_own_facebook ON facebook_accounts FOR UPDATE USING (user_id = auth.uid() OR is_super_admin()) WITH CHECK (user_id = auth.uid() OR is_super_admin());
    CREATE POLICY delete_own_facebook ON facebook_accounts FOR DELETE USING (user_id = auth.uid() OR is_super_admin());
  END IF;
END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='facebook_pages' AND column_name='user_id') THEN
    DROP POLICY IF EXISTS select_own_pages ON facebook_pages;
    DROP POLICY IF EXISTS insert_own_pages ON facebook_pages;
    DROP POLICY IF EXISTS update_own_pages ON facebook_pages;
    DROP POLICY IF EXISTS delete_own_pages ON facebook_pages;
    CREATE POLICY select_own_pages ON facebook_pages FOR SELECT USING (user_id = auth.uid() OR is_super_admin());
    CREATE POLICY insert_own_pages ON facebook_pages FOR INSERT WITH CHECK (user_id = auth.uid() OR is_super_admin());
    CREATE POLICY update_own_pages ON facebook_pages FOR UPDATE USING (user_id = auth.uid() OR is_super_admin()) WITH CHECK (user_id = auth.uid() OR is_super_admin());
    CREATE POLICY delete_own_pages ON facebook_pages FOR DELETE USING (user_id = auth.uid() OR is_super_admin());
  END IF;
END $$;

-- ============================================================
-- 6. WA tables → user_id
-- ============================================================
DROP POLICY IF EXISTS select_own_wa_sessions ON public.wa_sessions;
DROP POLICY IF EXISTS insert_own_wa_sessions ON public.wa_sessions;
DROP POLICY IF EXISTS update_own_wa_sessions ON public.wa_sessions;
DROP POLICY IF EXISTS delete_own_wa_sessions ON public.wa_sessions;
CREATE POLICY select_own_wa_sessions ON public.wa_sessions
  FOR SELECT USING (user_id = auth.uid() OR is_super_admin());
CREATE POLICY insert_own_wa_sessions ON public.wa_sessions
  FOR INSERT WITH CHECK (user_id = auth.uid() OR is_super_admin());
CREATE POLICY update_own_wa_sessions ON public.wa_sessions
  FOR UPDATE
  USING (user_id = auth.uid() OR is_super_admin())
  WITH CHECK (user_id = auth.uid() OR is_super_admin());
CREATE POLICY delete_own_wa_sessions ON public.wa_sessions
  FOR DELETE USING (user_id = auth.uid() OR is_super_admin());

-- Generic fallback for other WA tables (wa_conversations, wa_messages, wa_contacts, wa_campaigns, wa_templates, wa_keyword_rules, wa_workflows, wa_workflow_steps, wa_notes)
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN SELECT unnest(ARRAY[
        'wa_conversations', 'wa_messages', 'wa_contacts',
        'wa_campaigns', 'wa_templates', 'wa_keyword_rules',
        'wa_workflows', 'wa_workflow_steps', 'wa_notes'
    ]) LOOP
        IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = tbl)
           AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=tbl AND column_name='user_id')
        THEN
            EXECUTE format('DROP POLICY IF EXISTS select_own_%I ON public.%I', replace(tbl, '_', '_'), tbl);
            EXECUTE format('DROP POLICY IF EXISTS insert_own_%I ON public.%I', replace(tbl, '_', '_'), tbl);
            EXECUTE format('DROP POLICY IF EXISTS update_own_%I ON public.%I', replace(tbl, '_', '_'), tbl);
            EXECUTE format('DROP POLICY IF EXISTS delete_own_%I ON public.%I', replace(tbl, '_', '_'), tbl);
            EXECUTE format('CREATE POLICY select_own_%I ON public.%I FOR SELECT USING (user_id = auth.uid() OR is_super_admin())', replace(tbl, '_', '_'), tbl);
            EXECUTE format('CREATE POLICY insert_own_%I ON public.%I FOR INSERT WITH CHECK (user_id = auth.uid() OR is_super_admin())', replace(tbl, '_', '_'), tbl);
            EXECUTE format('CREATE POLICY update_own_%I ON public.%I FOR UPDATE USING (user_id = auth.uid() OR is_super_admin()) WITH CHECK (user_id = auth.uid() OR is_super_admin())', replace(tbl, '_', '_'), tbl);
            EXECUTE format('CREATE POLICY delete_own_%I ON public.%I FOR DELETE USING (user_id = auth.uid() OR is_super_admin())', replace(tbl, '_', '_'), tbl);
        END IF;
    END LOOP;
END;
$$;

-- ============================================================
-- 7. Extraction tables → user_id
-- ============================================================
DROP POLICY IF EXISTS select_own_extraction_jobs ON public.extraction_jobs;
DROP POLICY IF EXISTS insert_own_extraction_jobs ON public.extraction_jobs;
DROP POLICY IF EXISTS update_own_extraction_jobs ON public.extraction_jobs;
DROP POLICY IF EXISTS delete_own_extraction_jobs ON public.extraction_jobs;
CREATE POLICY select_own_extraction_jobs ON public.extraction_jobs
  FOR SELECT USING (user_id = auth.uid() OR is_super_admin());
CREATE POLICY insert_own_extraction_jobs ON public.extraction_jobs
  FOR INSERT WITH CHECK (user_id = auth.uid() OR is_super_admin());
CREATE POLICY update_own_extraction_jobs ON public.extraction_jobs
  FOR UPDATE
  USING (user_id = auth.uid() OR is_super_admin())
  WITH CHECK (user_id = auth.uid() OR is_super_admin());
CREATE POLICY delete_own_extraction_jobs ON public.extraction_jobs
  FOR DELETE USING (user_id = auth.uid() OR is_super_admin());

DROP POLICY IF EXISTS select_own_extraction_results ON public.extraction_results;
DROP POLICY IF EXISTS insert_own_extraction_results ON public.extraction_results;
CREATE POLICY select_own_extraction_results ON public.extraction_results
  FOR SELECT USING (user_id = auth.uid() OR is_super_admin());
CREATE POLICY insert_own_extraction_results ON public.extraction_results
  FOR INSERT WITH CHECK (user_id = auth.uid() OR is_super_admin());

-- ============================================================
-- 8. exports → user_id
-- ============================================================
DROP POLICY IF EXISTS select_own_exports ON public.exports;
DROP POLICY IF EXISTS insert_own_exports ON public.exports;
DROP POLICY IF EXISTS update_own_exports ON public.exports;
DROP POLICY IF EXISTS delete_own_exports ON public.exports;
CREATE POLICY select_own_exports ON public.exports
  FOR SELECT USING (user_id = auth.uid() OR is_super_admin());
CREATE POLICY insert_own_exports ON public.exports
  FOR INSERT WITH CHECK (user_id = auth.uid() OR is_super_admin());
CREATE POLICY update_own_exports ON public.exports
  FOR UPDATE
  USING (user_id = auth.uid() OR is_super_admin())
  WITH CHECK (user_id = auth.uid() OR is_super_admin());
CREATE POLICY delete_own_exports ON public.exports
  FOR DELETE USING (user_id = auth.uid() OR is_super_admin());

-- ============================================================
-- 9. activity_logs → user_id
-- ============================================================
DROP POLICY IF EXISTS activity_logs_select_ws ON activity_logs;
DROP POLICY IF EXISTS activity_logs_insert ON activity_logs;
CREATE POLICY activity_logs_select_own ON activity_logs
  FOR SELECT USING (user_id = auth.uid() OR is_super_admin());
CREATE POLICY activity_logs_insert_own ON activity_logs
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 10. ai_provider_accounts → user_id
-- ============================================================
DROP POLICY IF EXISTS ai_provider_accounts_admin ON ai_provider_accounts;
CREATE POLICY ai_provider_accounts_admin ON ai_provider_accounts
  FOR ALL
  USING (is_super_admin() OR user_id = auth.uid())
  WITH CHECK (is_super_admin() OR user_id = auth.uid());

-- ============================================================
-- 11. Fix soft_delete_fb_session — uses user_id not workspace_id
-- ============================================================
DROP FUNCTION IF EXISTS soft_delete_fb_session(p_session_id UUID);
DROP FUNCTION IF EXISTS soft_delete_fb_session(UUID);

CREATE OR REPLACE FUNCTION soft_delete_fb_session(p_session_id UUID)
RETURNS void AS $$
DECLARE
    v_session_user_id UUID;
BEGIN
    SELECT user_id INTO v_session_user_id
    FROM fb_sessions
    WHERE id = p_session_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'session_not_found';
    END IF;
    IF NOT is_super_admin() AND v_session_user_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'insufficient_privileges';
    END IF;
    UPDATE fb_sessions
    SET deleted_at = now(),
        deleted_by = auth.uid(),
        status     = 'disconnected',
        updated_at = now()
    WHERE id = p_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

-- ============================================================
-- 12. Fix get_ai_cost_today → user_id
-- ============================================================
DROP FUNCTION IF EXISTS get_ai_cost_today(UUID);
CREATE OR REPLACE FUNCTION get_ai_cost_today(p_user_id UUID)
RETURNS numeric AS $$
BEGIN
    IF NOT is_super_admin() AND p_user_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'insufficient_privileges';
    END IF;
    RETURN (
        SELECT COALESCE(sum(cost_usd), 0)
        FROM ai_invocations
        WHERE user_id = p_user_id
        AND created_at >= date_trunc('day', now())
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = '';

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- 13. Recreate policies dropped by CASCADE from current_workspace_id()
--     Tables: roles, wa_session_*, wa_provider_configs, wa_smart_lists,
--     wa_contact_blocks, wa_campaign_recipients, wa_workflow_states,
--     wa_automation_logs, wa_contact_lists, wa_contact_list_members
-- ============================================================

-- roles
DROP POLICY IF EXISTS read_roles ON public.roles;
CREATE POLICY read_roles ON public.roles FOR SELECT USING (true);

-- wa_provider_configs
DROP POLICY IF EXISTS select_provider_configs ON public.wa_provider_configs;
DROP POLICY IF EXISTS insert_provider_configs ON public.wa_provider_configs;
DROP POLICY IF EXISTS update_provider_configs ON public.wa_provider_configs;
DROP POLICY IF EXISTS delete_provider_configs ON public.wa_provider_configs;
CREATE POLICY select_provider_configs ON public.wa_provider_configs FOR SELECT USING (user_id = auth.uid() OR is_super_admin());
CREATE POLICY insert_provider_configs ON public.wa_provider_configs FOR INSERT WITH CHECK (user_id = auth.uid() OR is_super_admin());
CREATE POLICY update_provider_configs ON public.wa_provider_configs FOR UPDATE USING (user_id = auth.uid() OR is_super_admin()) WITH CHECK (user_id = auth.uid() OR is_super_admin());
CREATE POLICY delete_provider_configs ON public.wa_provider_configs FOR DELETE USING (user_id = auth.uid() OR is_super_admin());

-- wa_session_events
DROP POLICY IF EXISTS insert_wa_session_events ON public.wa_session_events;
CREATE POLICY insert_wa_session_events ON public.wa_session_events FOR INSERT WITH CHECK (user_id = auth.uid());

-- wa_session_activity
DROP POLICY IF EXISTS insert_wa_session_activity ON public.wa_session_activity;
CREATE POLICY insert_wa_session_activity ON public.wa_session_activity FOR INSERT WITH CHECK (user_id = auth.uid());

-- wa_session_status_history
DROP POLICY IF EXISTS insert_wa_session_history ON public.wa_session_status_history;
CREATE POLICY insert_wa_session_history ON public.wa_session_status_history FOR INSERT WITH CHECK (user_id = auth.uid());

-- wa_connection_attempts
DROP POLICY IF EXISTS insert_wa_connection_attempts ON public.wa_connection_attempts;
CREATE POLICY insert_wa_connection_attempts ON public.wa_connection_attempts FOR INSERT WITH CHECK (user_id = auth.uid());

-- wa_session_lifecycle_logs
DROP POLICY IF EXISTS insert_wa_session_logs ON public.wa_session_lifecycle_logs;
CREATE POLICY insert_wa_session_logs ON public.wa_session_lifecycle_logs FOR INSERT WITH CHECK (user_id = auth.uid());

-- wa_smart_lists
DROP POLICY IF EXISTS select_wa_smart_lists ON public.wa_smart_lists;
DROP POLICY IF EXISTS insert_wa_smart_lists ON public.wa_smart_lists;
DROP POLICY IF EXISTS update_wa_smart_lists ON public.wa_smart_lists;
DROP POLICY IF EXISTS delete_wa_smart_lists ON public.wa_smart_lists;
CREATE POLICY select_wa_smart_lists ON public.wa_smart_lists FOR SELECT USING (user_id = auth.uid() OR is_super_admin());
CREATE POLICY insert_wa_smart_lists ON public.wa_smart_lists FOR INSERT WITH CHECK (user_id = auth.uid() OR is_super_admin());
CREATE POLICY update_wa_smart_lists ON public.wa_smart_lists FOR UPDATE USING (user_id = auth.uid() OR is_super_admin()) WITH CHECK (user_id = auth.uid() OR is_super_admin());
CREATE POLICY delete_wa_smart_lists ON public.wa_smart_lists FOR DELETE USING (user_id = auth.uid() OR is_super_admin());

-- wa_contact_blocks
DROP POLICY IF EXISTS select_wa_contact_blocks ON public.wa_contact_blocks;
DROP POLICY IF EXISTS insert_wa_contact_blocks ON public.wa_contact_blocks;
CREATE POLICY select_wa_contact_blocks ON public.wa_contact_blocks FOR SELECT USING (user_id = auth.uid() OR is_super_admin());
CREATE POLICY insert_wa_contact_blocks ON public.wa_contact_blocks FOR INSERT WITH CHECK (user_id = auth.uid() OR is_super_admin());

-- wa_campaign_recipients
DROP POLICY IF EXISTS select_wa_campaign_recipients ON public.wa_campaign_recipients;
DROP POLICY IF EXISTS insert_wa_campaign_recipients ON public.wa_campaign_recipients;
DROP POLICY IF EXISTS update_wa_campaign_recipients ON public.wa_campaign_recipients;
CREATE POLICY select_wa_campaign_recipients ON public.wa_campaign_recipients FOR SELECT USING (user_id = auth.uid() OR is_super_admin());
CREATE POLICY insert_wa_campaign_recipients ON public.wa_campaign_recipients FOR INSERT WITH CHECK (user_id = auth.uid() OR is_super_admin());
CREATE POLICY update_wa_campaign_recipients ON public.wa_campaign_recipients FOR UPDATE USING (user_id = auth.uid() OR is_super_admin()) WITH CHECK (user_id = auth.uid() OR is_super_admin());

-- wa_workflow_states
DROP POLICY IF EXISTS select_wf_states ON public.wa_workflow_states;
DROP POLICY IF EXISTS insert_wf_states ON public.wa_workflow_states;
DROP POLICY IF EXISTS update_wf_states ON public.wa_workflow_states;
CREATE POLICY select_wf_states ON public.wa_workflow_states FOR SELECT USING (user_id = auth.uid() OR is_super_admin());
CREATE POLICY insert_wf_states ON public.wa_workflow_states FOR INSERT WITH CHECK (user_id = auth.uid() OR is_super_admin());
CREATE POLICY update_wf_states ON public.wa_workflow_states FOR UPDATE USING (user_id = auth.uid() OR is_super_admin()) WITH CHECK (user_id = auth.uid() OR is_super_admin());

-- wa_automation_logs
DROP POLICY IF EXISTS select_auto_logs ON public.wa_automation_logs;
DROP POLICY IF EXISTS insert_auto_logs ON public.wa_automation_logs;
CREATE POLICY select_auto_logs ON public.wa_automation_logs FOR SELECT USING (user_id = auth.uid() OR is_super_admin());
CREATE POLICY insert_auto_logs ON public.wa_automation_logs FOR INSERT WITH CHECK (user_id = auth.uid() OR is_super_admin());

-- wa_contact_lists
DROP POLICY IF EXISTS wa_contact_lists_select ON public.wa_contact_lists;
DROP POLICY IF EXISTS wa_contact_lists_modify ON public.wa_contact_lists;
CREATE POLICY wa_contact_lists_select ON public.wa_contact_lists FOR SELECT USING (user_id = auth.uid() OR is_super_admin());
CREATE POLICY wa_contact_lists_modify ON public.wa_contact_lists FOR ALL USING (user_id = auth.uid() OR is_super_admin()) WITH CHECK (user_id = auth.uid() OR is_super_admin());

-- wa_contact_list_members
DROP POLICY IF EXISTS wa_contact_list_members_select ON public.wa_contact_list_members;
DROP POLICY IF EXISTS wa_contact_list_members_modify ON public.wa_contact_list_members;
CREATE POLICY wa_contact_list_members_select ON public.wa_contact_list_members FOR SELECT USING (user_id = auth.uid() OR is_super_admin());
CREATE POLICY wa_contact_list_members_modify ON public.wa_contact_list_members FOR ALL USING (user_id = auth.uid() OR is_super_admin()) WITH CHECK (user_id = auth.uid() OR is_super_admin());

-- session_lifecycle_logs (already defined above but CASCADE removed it)
DROP POLICY IF EXISTS insert_own_session_lifecycle_logs ON public.session_lifecycle_logs;
CREATE POLICY insert_own_session_lifecycle_logs ON public.session_lifecycle_logs FOR INSERT WITH CHECK (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
