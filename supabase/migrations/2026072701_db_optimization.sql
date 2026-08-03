-- ╔══════════════════════════════════════════════════════════════════╗
-- ║  FlowTix — Database Performance Optimization v1.0                 ║
-- ║  Cleanup + Indexes + BRIN + Materialized Views + Maintenance      ║
-- ╚══════════════════════════════════════════════════════════════════╝

-- ============================================================
-- 1️⃣  CLEANUP: إزالة الدوال المكررة
--    (النسخ القديمة من admin_plans.sql تم استبدالها بـ
--     2026072610_admin_plan_rpcs.sql)
-- ============================================================

-- دوال `admin_plans.sql` القديمة تم استبدالها بـ CREATE OR REPLACE
-- في الملف الأحدث. لا حاجة لحذفها يدوياً — لكن نوثّق هنا للإشارة.
-- لو أردت حذفها صراحةً:
-- DROP FUNCTION IF EXISTS admin_create_plan CASCADE;
-- (لكن CREATE OR REPLACE في الملف الأحدث قام بالكتابة فوقها)

-- ============================================================
-- 2️⃣  HIGH-IMPACT INDEXES: الفهارس الأكثر تأثيراً على الأداء
--    Composite indexes لأنماط الاستعلام الشائعة
-- ============================================================

-- fb_sessions: التصفية حسب workspace + status + soft-delete
CREATE INDEX IF NOT EXISTS idx_fb_sessions_ws_status
    ON fb_sessions (workspace_id, status)
    WHERE deleted_at IS NULL;

-- fb_sessions: آخر نشاط (للترتيب)
CREATE INDEX IF NOT EXISTS idx_fb_sessions_ws_activity
    ON fb_sessions (workspace_id, last_activity DESC)
    WHERE deleted_at IS NULL;

-- extraction_jobs: تصفية المهام
CREATE INDEX IF NOT EXISTS idx_extraction_jobs_ws_status
    ON extraction_jobs (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_extraction_jobs_ws_type
    ON extraction_jobs (workspace_id, type);
CREATE INDEX IF NOT EXISTS idx_extraction_jobs_ws_created
    ON extraction_jobs (workspace_id, created_at DESC);

-- extraction_results: الانضمام مع jobs
CREATE INDEX IF NOT EXISTS idx_extraction_results_job_id
    ON extraction_results (job_id);
CREATE INDEX IF NOT EXISTS idx_extraction_results_ws_created
    ON extraction_results (workspace_id, created_at DESC);

-- wa_sessions: تصفية الجلسات
CREATE INDEX IF NOT EXISTS idx_wa_sessions_ws_status
    ON wa_sessions (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_wa_sessions_ws_created
    ON wa_sessions (workspace_id, created_at DESC);

-- wa_messages: جدول كبير جداً — فهرس مركب للاستعلامات
CREATE INDEX IF NOT EXISTS idx_wa_messages_ws_created
    ON wa_messages (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_messages_conversation
    ON wa_messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_messages_status
    ON wa_messages (status);
CREATE INDEX IF NOT EXISTS idx_wa_messages_sent_by_ai
    ON wa_messages (sent_by_ai)
    WHERE sent_by_ai = true;

-- wa_contacts: تصفية جهات الاتصال
CREATE INDEX IF NOT EXISTS idx_wa_contacts_ws
    ON wa_contacts (workspace_id);
CREATE INDEX IF NOT EXISTS idx_wa_contacts_ws_updated
    ON wa_contacts (workspace_id, updated_at DESC);

-- wa_conversations
CREATE INDEX IF NOT EXISTS idx_wa_conversations_ws_updated
    ON wa_conversations (workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_conversations_session
    ON wa_conversations (wa_session_id);

-- wa_campaigns
CREATE INDEX IF NOT EXISTS idx_wa_campaigns_ws_status
    ON wa_campaigns (workspace_id, status);

-- wa_campaign_recipients: تتبع الإرسال
CREATE INDEX IF NOT EXISTS idx_wa_campaign_recipients_campaign
    ON wa_campaign_recipients (campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_wa_campaign_recipients_contact
    ON wa_campaign_recipients (contact_id);

-- notifications: إشعارات المستخدم غير المقروءة
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
    ON notifications (user_id, read_at)
    WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_ws_created
    ON notifications (workspace_id, created_at DESC);

-- activity_logs: سجل النشاط
CREATE INDEX IF NOT EXISTS idx_activity_logs_ws_created
    ON activity_logs (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_created
    ON activity_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action
    ON activity_logs (action);

-- subscriptions: البحث عن الاشتراكات النشطة
CREATE INDEX IF NOT EXISTS idx_subscriptions_ws_status
    ON subscriptions (workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_plan
    ON subscriptions (plan_id);

-- invoices
CREATE INDEX IF NOT EXISTS idx_invoices_ws_created
    ON invoices (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_subscription
    ON invoices (subscription_id);

-- exports: ملفات التصدير
CREATE INDEX IF NOT EXISTS idx_exports_ws_created
    ON exports (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exports_ws_status
    ON exports (workspace_id, status);

-- facebook_accounts
CREATE INDEX IF NOT EXISTS idx_facebook_accounts_ws
    ON facebook_accounts (workspace_id);

-- facebook_pages
CREATE INDEX IF NOT EXISTS idx_facebook_pages_ws
    ON facebook_pages (workspace_id);
CREATE INDEX IF NOT EXISTS idx_facebook_pages_account
    ON facebook_pages (facebook_account_id);

-- profiles
CREATE INDEX IF NOT EXISTS idx_profiles_user_id
    ON profiles (user_id);
CREATE INDEX IF NOT EXISTS idx_profiles_email
    ON profiles (email);

-- user_roles
CREATE INDEX IF NOT EXISTS idx_user_roles_user_ws
    ON user_roles (user_id, workspace_id);

-- ============================================================
-- 3️⃣  PARTIAL INDEXES: فهارس جزئية لـ soft-delete
--    معظم الجداول تستخدم deleted_at للـ soft-delete
-- ============================================================

-- fb_sessions: معظم الاستعلامات تستثني المحذوفة
-- (مدمج في idx_fb_sessions_ws_status أعلاه)

-- ============================================================
-- 4️⃣  BRIN INDEXES: للجداول الزمنية الكبيرة جداً
--    BRIN أصغر بـ 100x من B-tree ومناسب للـ append-only tables
-- ============================================================

-- activity_logs (متوقع: ملايين الصفوف)
CREATE INDEX IF NOT EXISTS brin_activity_logs_created
    ON activity_logs USING BRIN (created_at)
    WITH (pages_per_range = 32);

-- extraction_results (متوقع: ملايين الصفوف)
CREATE INDEX IF NOT EXISTS brin_extraction_results_created
    ON extraction_results USING BRIN (created_at)
    WITH (pages_per_range = 32);

-- fb_session_events
CREATE INDEX IF NOT EXISTS brin_fb_session_events_created
    ON fb_session_events USING BRIN (created_at)
    WITH (pages_per_range = 32);

-- fb_session_activity
CREATE INDEX IF NOT EXISTS brin_fb_session_activity_created
    ON fb_session_activity USING BRIN (created_at)
    WITH (pages_per_range = 32);

-- fb_connection_attempts
CREATE INDEX IF NOT EXISTS brin_fb_connection_attempts_created
    ON fb_connection_attempts USING BRIN (created_at)
    WITH (pages_per_range = 32);

-- wa_messages (أكبر جدول في النظام)
CREATE INDEX IF NOT EXISTS brin_wa_messages_created
    ON wa_messages USING BRIN (created_at)
    WITH (pages_per_range = 32);

-- wa_connection_attempts
CREATE INDEX IF NOT EXISTS brin_wa_connection_attempts_created
    ON wa_connection_attempts USING BRIN (created_at)
    WITH (pages_per_range = 32);

-- wa_automation_logs
CREATE INDEX IF NOT EXISTS brin_wa_automation_logs_created
    ON wa_automation_logs USING BRIN (created_at)
    WITH (pages_per_range = 32);

-- ai_invocations
CREATE INDEX IF NOT EXISTS brin_ai_invocations_created
    ON ai_invocations USING BRIN (created_at)
    WITH (pages_per_range = 32);

-- ============================================================
-- 5️⃣  MATERIALIZED VIEW: إحصائيات يومية لـ Dashboard Overview
--    تُحدَّث دورياً (كل 5 دقائق) بدلاً من حسابها في كل طلب
-- ============================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_dashboard_stats AS
SELECT
    ws.id AS workspace_id,
    COUNT(DISTINCT fs.id) FILTER (WHERE fs.status = 'connected' AND fs.deleted_at IS NULL) AS fb_sessions_connected,
    COUNT(DISTINCT fs.id) FILTER (WHERE fs.deleted_at IS NULL) AS fb_sessions_total,
    COUNT(DISTINCT ej.id) FILTER (WHERE ej.status = 'running') AS extraction_jobs_running,
    COUNT(DISTINCT ej.id) FILTER (WHERE ej.status = 'completed') AS extraction_jobs_completed,
    COUNT(DISTINCT ej.id) FILTER (WHERE ej.created_at > now() - interval '24 hours') AS extraction_jobs_24h,
    COUNT(DISTINCT wsess.id) FILTER (WHERE wsess.status = 'connected') AS wa_sessions_connected,
    COUNT(DISTINCT wsess.id) AS wa_sessions_total,
    COALESCE(SUM(wm.cnt) FILTER (WHERE wm.created_at > now() - interval '24 hours'), 0) AS wa_messages_24h,
    COALESCE(SUM(ai.cost_usd) FILTER (WHERE ai.created_at > now() - interval '24 hours'), 0) AS ai_cost_24h
FROM workspaces ws
LEFT JOIN fb_sessions fs ON fs.workspace_id = ws.id
LEFT JOIN extraction_jobs ej ON ej.workspace_id = ws.id
LEFT JOIN wa_sessions wsess ON wsess.workspace_id = ws.id
LEFT JOIN (
    SELECT workspace_id, created_at, COUNT(*) AS cnt
    FROM wa_messages
    GROUP BY workspace_id, created_at
) wm ON wm.workspace_id = ws.id
LEFT JOIN ai_invocations ai ON ai.workspace_id = ws.id
GROUP BY ws.id;

CREATE UNIQUE INDEX IF NOT EXISTS mv_dashboard_stats_ws
    ON mv_dashboard_stats (workspace_id);

-- ============================================================
-- 6️⃣  MAINTENANCE FUNCTION: دالة صيانة دورية
--    تُشغَّل عبر pg_cron أو Supabase scheduled function
-- ============================================================

CREATE OR REPLACE FUNCTION fn_maintenance_run()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    result text := '';
BEGIN
    -- تحديث الإحصائيات المجمّعة
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dashboard_stats;
    result := result || 'mv_dashboard_stats refreshed; ';

    -- تحليل الجداول الأكثر استخداماً لتحديث إحصائيات الـ query planner
    ANALYZE fb_sessions;
    ANALYZE extraction_jobs;
    ANALYZE extraction_results;
    ANALYZE wa_messages;
    ANALYZE wa_sessions;
    ANALYZE wa_contacts;
    ANALYZE activity_logs;
    ANALYZE notifications;
    result := result || 'ANALYZE completed; ';

    RETURN result;
END;
$$;

-- ============================================================
-- 7️⃣  TABLE COMPRESSION TUNING: ضبط إعدادات التخزين
--    (للجداول التي تُكتب كثيراً وتُقرأ قليلاً)
-- ============================================================

-- تعيين fillfactor منخفض للجداول كثيرة التحديث
ALTER TABLE fb_sessions SET (fillfactor = 80);
ALTER TABLE wa_sessions SET (fillfactor = 80);
ALTER TABLE wa_messages SET (fillfactor = 90);
ALTER TABLE notifications SET (fillfactor = 85);
ALTER TABLE extraction_jobs SET (fillfactor = 85);
ALTER TABLE activity_logs SET (fillfactor = 90);

-- ============================================================
-- 8️⃣  VACUUM TUNING: إعدادات أفضل للـ autovacuum
--    (للجداول التي تكبر بسرعة)
-- ============================================================

ALTER TABLE wa_messages SET (
    autovacuum_vacuum_scale_factor = 0.05,
    autovacuum_analyze_scale_factor = 0.02
);

ALTER TABLE activity_logs SET (
    autovacuum_vacuum_scale_factor = 0.05,
    autovacuum_analyze_scale_factor = 0.02
);

ALTER TABLE extraction_results SET (
    autovacuum_vacuum_scale_factor = 0.05,
    autovacuum_analyze_scale_factor = 0.02
);

ALTER TABLE fb_session_events SET (
    autovacuum_vacuum_scale_factor = 0.05,
    autovacuum_analyze_scale_factor = 0.02
);

ALTER TABLE ai_invocations SET (
    autovacuum_vacuum_scale_factor = 0.05,
    autovacuum_analyze_scale_factor = 0.02
);

-- ============================================================
-- 9️⃣  FINAL ANALYZE: تحديث إحصائيات الـ planner بعد كل التغييرات
-- ============================================================

ANALYZE;