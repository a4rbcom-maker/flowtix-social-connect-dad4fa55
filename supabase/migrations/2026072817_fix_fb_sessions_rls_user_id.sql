-- Fix RLS policies after workspace_id removal (migration 2026072716)
-- The original RLS policies were created outside project and reference
-- workspace_id via current_workspace_id(). This migration replaces all
-- of them with user_id-based policies.

-- ============================================================
-- 1. Recreate current_workspace_id() — profiles.workspace_id was dropped.
--    Now returns auth.uid() since all tables use user_id for ownership.
-- ============================================================
DROP FUNCTION IF EXISTS current_workspace_id();
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
-- 5. Facebook accounts & pages → user_id
-- ============================================================
DROP POLICY IF EXISTS select_own_facebook ON public.facebook_accounts;
DROP POLICY IF EXISTS insert_own_facebook ON public.facebook_accounts;
DROP POLICY IF EXISTS update_own_facebook ON public.facebook_accounts;
DROP POLICY IF EXISTS delete_own_facebook ON public.facebook_accounts;
CREATE POLICY select_own_facebook ON public.facebook_accounts
  FOR SELECT USING (user_id = auth.uid() OR is_super_admin());
CREATE POLICY insert_own_facebook ON public.facebook_accounts
  FOR INSERT WITH CHECK (user_id = auth.uid() OR is_super_admin());
CREATE POLICY update_own_facebook ON public.facebook_accounts
  FOR UPDATE
  USING (user_id = auth.uid() OR is_super_admin())
  WITH CHECK (user_id = auth.uid() OR is_super_admin());
CREATE POLICY delete_own_facebook ON public.facebook_accounts
  FOR DELETE USING (user_id = auth.uid() OR is_super_admin());

DROP POLICY IF EXISTS select_own_pages ON public.facebook_pages;
DROP POLICY IF EXISTS insert_own_pages ON public.facebook_pages;
DROP POLICY IF EXISTS update_own_pages ON public.facebook_pages;
DROP POLICY IF EXISTS delete_own_pages ON public.facebook_pages;
CREATE POLICY select_own_pages ON public.facebook_pages
  FOR SELECT USING (user_id = auth.uid() OR is_super_admin());
CREATE POLICY insert_own_pages ON public.facebook_pages
  FOR INSERT WITH CHECK (user_id = auth.uid() OR is_super_admin());
CREATE POLICY update_own_pages ON public.facebook_pages
  FOR UPDATE
  USING (user_id = auth.uid() OR is_super_admin())
  WITH CHECK (user_id = auth.uid() OR is_super_admin());
CREATE POLICY delete_own_pages ON public.facebook_pages
  FOR DELETE USING (user_id = auth.uid() OR is_super_admin());

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
        IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = tbl) THEN
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
