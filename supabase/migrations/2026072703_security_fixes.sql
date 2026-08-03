-- ╔══════════════════════════════════════════════════════════════╗
-- ║  FlowTix — Security Patch v1.0                                ║
-- ║  Fixes: RLS bypass + missing policies + auth checks           ║
-- ╚══════════════════════════════════════════════════════════════╝

-- ============================================================
-- 1️⃣  إصلاح حرج: current_workspace_id() كانت ترجع workspace عشوائي
--    للمستخدمين في أكثر من workspace → تستخدم profiles الآن
-- ============================================================

CREATE OR REPLACE FUNCTION current_workspace_id()
RETURNS UUID AS $$
DECLARE
    v_ws UUID;
BEGIN
    SELECT workspace_id INTO v_ws
    FROM profiles
    WHERE user_id = auth.uid()
    LIMIT 1;
    RETURN v_ws;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = '';

-- ============================================================
-- 2️⃣  إصلاح حرج: is_super_admin() — إنشائها إذا لم تكن موجودة
--    (كل admin RPCs تعتمد على هذه الدالة)
-- ============================================================

CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS boolean AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = auth.uid()
        AND r.key = 'super_admin'
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = '';

-- ============================================================
-- 3️⃣  إصلاح حرج: soft_delete_fb_session — إضافة تحقق الصلاحية
--    (كانت SECURITY DEFINER بدون أي تحقق → أي مستخدم يحذف أي جلسة)
-- ============================================================

DROP FUNCTION IF EXISTS soft_delete_fb_session(UUID, UUID);
DROP FUNCTION IF EXISTS soft_delete_fb_session(p_session_id UUID, p_user_id UUID);

CREATE OR REPLACE FUNCTION soft_delete_fb_session(p_session_id UUID)
RETURNS void AS $$
DECLARE
    v_session_workspace_id UUID;
    v_user_workspace_id   UUID;
BEGIN
    -- تحديد workspace_id للجلسة
    SELECT workspace_id INTO v_session_workspace_id
    FROM fb_sessions
    WHERE id = p_session_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'session_not_found';
    END IF;

    -- تحديد workspace_id للمستخدم الحالي
    SELECT workspace_id INTO v_user_workspace_id
    FROM profiles
    WHERE user_id = auth.uid()
    LIMIT 1;

    -- التحقق: المستخدم هو صاحب الجلسة أو super_admin
    IF NOT is_super_admin() AND v_user_workspace_id IS DISTINCT FROM v_session_workspace_id THEN
        RAISE EXCEPTION 'insufficient_privileges';
    END IF;

    -- Soft delete
    UPDATE fb_sessions
    SET deleted_at   = now(),
        deleted_by   = auth.uid(),
        status       = 'disconnected',
        updated_at   = now()
    WHERE id = p_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = '';

-- ============================================================
-- 4️⃣  إصلاح: get_ai_cost_today — إزالة SECURITY DEFINER
--    (كانت تسمح لأي مستخدم برؤية تكلفة أي workspace)
-- ============================================================

DROP FUNCTION IF EXISTS get_ai_cost_today(UUID);

CREATE OR REPLACE FUNCTION get_ai_cost_today(p_workspace_id UUID)
RETURNS numeric AS $$
BEGIN
    -- تحقق من الصلاحية
    IF NOT is_super_admin() AND p_workspace_id IS DISTINCT FROM current_workspace_id() THEN
        RAISE EXCEPTION 'insufficient_privileges';
    END IF;

    RETURN (
        SELECT COALESCE(sum(cost_usd), 0)
        FROM ai_invocations
        WHERE workspace_id = p_workspace_id
        AND created_at >= date_trunc('day', now())
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = '';

-- ============================================================
-- 5️⃣  إضافة سياسات DELETE للجداول الناقصة
--    (نتخطى الجداول غير الموجودة)
-- ============================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ai_provider_configs') THEN
    DROP POLICY IF EXISTS "delete_ai_cfg" ON ai_provider_configs;
    CREATE POLICY "delete_ai_cfg" ON ai_provider_configs FOR DELETE
        USING (workspace_id = current_workspace_id() OR is_super_admin());
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ai_conversation_memory') THEN
    DROP POLICY IF EXISTS "delete_ai_memory" ON ai_conversation_memory;
    CREATE POLICY "delete_ai_memory" ON ai_conversation_memory FOR DELETE
        USING (workspace_id = current_workspace_id() OR is_super_admin());
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ai_invocations') THEN
    DROP POLICY IF EXISTS "delete_ai_invoc" ON ai_invocations;
    CREATE POLICY "delete_ai_invoc" ON ai_invocations FOR DELETE
        USING (workspace_id = current_workspace_id() OR is_super_admin());
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ai_knowledge_base') THEN
    DROP POLICY IF EXISTS "delete_ai_kb" ON ai_knowledge_base;
    CREATE POLICY "delete_ai_kb" ON ai_knowledge_base FOR DELETE
        USING (workspace_id = current_workspace_id() OR is_super_admin());
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ai_router_rules') THEN
    DROP POLICY IF EXISTS "delete_aires" ON ai_router_rules;
    CREATE POLICY "delete_aires" ON ai_router_rules FOR DELETE
        USING (workspace_id = current_workspace_id() OR is_super_admin());
  END IF;
END $$;

-- ============================================================
-- 6️⃣  تمكين RLS على الجداول الناقصة (إن لم تكن مفعّلة مسبقاً)
--    وضمان وجود سياسات أساسية
-- ============================================================

-- profiles
ALTER TABLE IF EXISTS profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
CREATE POLICY "profiles_select_own" ON profiles FOR SELECT
    USING (user_id = auth.uid() OR is_super_admin());

DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE
    USING (user_id = auth.uid() OR is_super_admin())
    WITH CHECK (user_id = auth.uid() OR is_super_admin());

-- user_roles
ALTER TABLE IF EXISTS user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_roles_select" ON user_roles;
CREATE POLICY "user_roles_select" ON user_roles FOR SELECT
    USING (user_id = auth.uid() OR is_super_admin());

-- system_settings
ALTER TABLE IF EXISTS system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "system_settings_public_read" ON system_settings;
CREATE POLICY "system_settings_public_read" ON system_settings FOR SELECT
    USING (is_public = true OR is_super_admin());

DROP POLICY IF EXISTS "system_settings_admin_write" ON system_settings;
CREATE POLICY "system_settings_admin_write" ON system_settings FOR ALL
    USING (is_super_admin())
    WITH CHECK (is_super_admin());

-- ============================================================
-- 7️⃣  إضافة سياق session للتحقق من المستخدم في audit trail
-- ============================================================

-- policy لـ activity_logs: المستخدم يرى سجلات workspace الخاص به فقط
ALTER TABLE IF EXISTS activity_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activity_logs_select_ws" ON activity_logs;
CREATE POLICY "activity_logs_select_ws" ON activity_logs FOR SELECT
    USING (workspace_id = current_workspace_id() OR is_super_admin());

DROP POLICY IF EXISTS "activity_logs_insert" ON activity_logs;
CREATE POLICY "activity_logs_insert" ON activity_logs FOR INSERT
    WITH CHECK (workspace_id = current_workspace_id());

-- ============================================================
-- 8️⃣  منع الإدراج المباشر في ai_provider_accounts من المستخدمين العاديين
--    (فقط super_admin يمكنه الإضافة عبر RPC)
-- ============================================================

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ai_provider_accounts') THEN
    ALTER TABLE ai_provider_accounts ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "ai_provider_accounts_admin" ON ai_provider_accounts;
    CREATE POLICY "ai_provider_accounts_admin" ON ai_provider_accounts FOR ALL
        USING (is_super_admin() OR workspace_id = current_workspace_id())
        WITH CHECK (is_super_admin() OR workspace_id = current_workspace_id());
  END IF;
END $$;

-- ============================================================
-- 9️⃣  Wrapper للدالة القديمة _current_workspace_id() للتوافق العكسي
--    (الـ analytics functions تستخدم الاسم القديم)
-- ============================================================

CREATE OR REPLACE FUNCTION _current_workspace_id()
RETURNS UUID AS $$
BEGIN
    RETURN current_workspace_id();
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = '';

-- ============================================================
-- 🔟  إنشاء admin_security_overview() — تغذي صفحة AdminSecurity
-- ============================================================

CREATE OR REPLACE FUNCTION admin_security_overview()
RETURNS JSONB AS $$
DECLARE
    rls_result JSONB;
    ext_result JSONB;
    usr_result JSONB;
    evt_result JSONB;
BEGIN
    -- RLS coverage
    WITH rls_stats AS (
        SELECT
            count(*) AS total_tables,
            count(*) FILTER (WHERE rowsecurity = true) AS rls_enabled,
            coalesce(jsonb_agg(tablename) FILTER (WHERE rowsecurity = false), '[]'::JSONB) AS tables_without
        FROM pg_tables
        WHERE schemaname = 'public'
        AND tablename NOT IN ('_prisma_migrations', 'schema_migrations', 'pg_stat_statements')
    )
    SELECT jsonb_build_object(
        'total_tables', total_tables,
        'rls_enabled', rls_enabled,
        'coverage_pct', CASE WHEN total_tables = 0 THEN 100 ELSE round((rls_enabled::numeric / total_tables * 100)::numeric, 1) END,
        'tables_without_rls', COALESCE(tables_without, '[]'::JSONB)
    ) INTO rls_result FROM rls_stats;

    -- Extensions in public schema
    SELECT jsonb_build_object(
        'in_public_schema', count(*),
        'names', coalesce(jsonb_agg(extname), '[]'::JSONB)
    ) INTO ext_result
    FROM pg_extension;

    -- User stats
    SELECT jsonb_build_object(
        'total', count(*),
        'suspended', count(*) FILTER (WHERE status = 'suspended'),
        'admins', count(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
            WHERE ur.user_id = profiles.user_id AND r.key IN ('admin', 'super_admin')
        ))
    ) INTO usr_result
    FROM profiles;

    -- Events in last 24 hours
    SELECT jsonb_build_object(
        'logins', count(*) FILTER (WHERE action = 'login'),
        'suspensions', count(*) FILTER (WHERE action IN ('user_suspended', 'user_deactivated', 'user_activated')),
        'role_changes', count(*) FILTER (WHERE action = 'role_changed'),
        'password_changes', count(*) FILTER (WHERE action = 'password_reset' OR action = 'password_changed'),
        'admin_actions', count(*) FILTER (WHERE action IN ('user_suspended', 'user_deactivated', 'user_activated', 'role_changed', 'setting_updated', 'plan_created', 'plan_updated', 'plan_deleted', 'flag_toggled', 'settings_edited')),
        'unique_ips', count(DISTINCT ip)
    ) INTO evt_result
    FROM activity_logs
    WHERE created_at > now() - interval '24 hours';

    RETURN jsonb_build_object(
        'rls', rls_result,
        'extensions', ext_result,
        'users', usr_result,
        'events_24h', evt_result
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = '';
