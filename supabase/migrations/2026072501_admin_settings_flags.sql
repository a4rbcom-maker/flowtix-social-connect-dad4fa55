-- ============================================================
-- ADMIN TASK 6: System Settings + Feature Flags
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- PART 1: Feature Flags Table (NEW)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.feature_flags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT NOT NULL UNIQUE,
  name        JSONB NOT NULL DEFAULT '{}'::jsonb,
  description JSONB NOT NULL DEFAULT '{}'::jsonb,
  category    TEXT NOT NULL DEFAULT 'general',
  is_enabled  BOOLEAN NOT NULL DEFAULT false,
  plan_key    TEXT REFERENCES plans(key) ON DELETE SET NULL,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_feature_flags_key ON public.feature_flags(key);
CREATE INDEX IF NOT EXISTS idx_feature_flags_category ON public.feature_flags(category);
CREATE INDEX IF NOT EXISTS idx_feature_flags_enabled ON public.feature_flags(is_enabled);

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON public.feature_flags
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "authenticated_read_enabled" ON public.feature_flags
  FOR SELECT TO authenticated USING (is_enabled = true);

INSERT INTO public.feature_flags (key, name, description, category, is_enabled, plan_key, metadata) VALUES
  ('ai_chatbot', '{"en":"AI Chatbot","ar":"روبوت المحادثات"}', '{"en":"Enable AI-powered auto-reply chatbot for WhatsApp","ar":"تفعيل روبوت المحادثات التلقائي للواتساب"}', 'ai', true, NULL, '{"rollout_percentage":100}'::jsonb),
  ('bulk_messaging', '{"en":"Bulk Messaging","ar":"الرسائل الجماعية"}', '{"en":"Send bulk messages to contacts and lists","ar":"إرسال رسائل جماعية للجهات والقوائم"}', 'whatsapp', true, NULL, '{}'::jsonb),
  ('wa_templates', '{"en":"WhatsApp Templates","ar":"قوالب واتساب"}', '{"en":"Use pre-approved WhatsApp message templates","ar":"استخدام قوالب رسائل واتساب المعتمدة"}', 'whatsapp', true, NULL, '{}'::jsonb),
  ('wa_campaigns', '{"en":"WhatsApp Campaigns","ar":"حملات واتساب"}', '{"en":"Create and manage marketing campaigns","ar":"إنشاء وإدارة الحملات التسويقية"}', 'whatsapp', true, NULL, '{}'::jsonb),
  ('ai_knowledge_base', '{"en":"AI Knowledge Base","ar":"قاعدة المعرفة"}', '{"en":"Train AI with custom knowledge documents","ar":"تدريب الذكاء الاصطناعي بمستندات معرفة مخصصة"}', 'ai', true, 'pro', '{}'::jsonb),
  ('ai_multi_model', '{"en":"AI Multi-Model Routing","ar":"توجيه متعدد النماذج"}', '{"en":"Route AI requests across multiple models (L1/L2/L3)","ar":"توجيه طلبات الذكاء الاصطناعي عبر نماذج متعددة"}', 'ai', false, 'pro', '{}'::jsonb),
  ('dark_mode', '{"en":"Dark Mode","ar":"الوضع الداكن"}', '{"en":"Enable dark mode theme","ar":"تفعيل سمة الوضع الداكن"}', 'general', true, NULL, '{}'::jsonb),
  ('2fa', '{"en":"Two-Factor Auth","ar":"المصادقة الثنائية"}', '{"en":"Require 2FA for admin accounts","ar":"الطلب المصادقة الثنائية لحسابات المسؤولين"}', 'security', false, NULL, '{}'::jsonb),
  ('fb_groups_bulk', '{"en":"FB Groups Bulk Actions","ar":"إجراءات جماعية للمجموعات"}', '{"en":"Bulk extract and manage Facebook group members","ar":"استخراج وإدارة أعضاء مجموعة فيسبوك بشكل جماعي"}', 'facebook', true, NULL, '{}'::jsonb),
  ('analytics_v2', '{"en":"Advanced Analytics","ar":"تحليلات متقدمة"}', '{"en":"Enable advanced analytics dashboard with charts","ar":"تفعيل لوحة التحليلات المتقدمة بالرسوم البيانية"}', 'general', false, 'pro', '{"rollout_percentage":100}'::jsonb),
  ('support_tickets', '{"en":"Support Tickets","ar":"تذاكر الدعم"}', '{"en":"Enable support ticket system for users","ar":"تفعيل نظام تذاكر الدعم للمستخدمين"}', 'general', true, NULL, '{}'::jsonb),
  ('email_notifications', '{"en":"Email Notifications","ar":"إشعارات البريد"}', '{"en":"Send email notifications for important events","ar":"إرسال إشعارات بريدية للأحداث المهمة"}', 'general', true, NULL, '{}'::jsonb),
  ('whatsapp_auto_reply', '{"en":"WhatsApp Auto-Reply","ar":"الرد التلقائي"}', '{"en":"Auto-reply to incoming WhatsApp messages","ar":"الرد التلقائي على رسائل الواتساب الواردة"}', 'whatsapp', true, NULL, '{}'::jsonb),
  ('api_access', '{"en":"API Access","ar":"الوصول للـ API"}', '{"en":"Allow programmatic API access for the workspace","ar":"السماح بالوصول البرمجي للواجهة"}', 'security', false, 'pro', '{}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- PART 2: Settings RPCs
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_list_settings(p_category TEXT DEFAULT NULL)
RETURNS TABLE (
  key TEXT,
  value JSONB,
  description TEXT,
  is_public BOOLEAN,
  updated_at TIMESTAMPTZ,
  updated_by UUID
) AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;
  RETURN QUERY
  SELECT ss.key, ss.value, ss.description, ss.is_public, ss.updated_at, ss.updated_by
  FROM system_settings ss
  WHERE p_category IS NULL OR ss.key LIKE p_category || '.%'
  ORDER BY ss.key;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_get_setting(p_key TEXT)
RETURNS TABLE (
  key TEXT,
  value JSONB,
  description TEXT,
  is_public BOOLEAN,
  updated_at TIMESTAMPTZ,
  updated_by UUID
) AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;
  RETURN QUERY
  SELECT ss.key, ss.value, ss.description, ss.is_public, ss.updated_at, ss.updated_by
  FROM system_settings ss
  WHERE ss.key = p_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'setting_not_found';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_upsert_setting(
  p_key TEXT,
  p_value JSONB,
  p_description TEXT DEFAULT NULL,
  p_is_public BOOLEAN DEFAULT false
) RETURNS VOID AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;
  INSERT INTO system_settings (key, value, description, is_public, updated_by)
  VALUES (p_key, p_value, p_description, p_is_public, auth.uid())
  ON CONFLICT (key) DO UPDATE SET
    value = p_value,
    description = COALESCE(p_description, system_settings.description),
    is_public = COALESCE(p_is_public, system_settings.is_public),
    updated_at = now(),
    updated_by = auth.uid();
  INSERT INTO activity_logs (user_id, workspace_id, action, resource_type, resource_id, description, metadata)
  VALUES (auth.uid(), NULL, 'admin_action', 'system_setting', p_key,
    'Updated system setting: ' || p_key,
    jsonb_build_object('value', p_value, 'is_public', p_is_public));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_delete_setting(p_key TEXT) RETURNS VOID AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;
  DELETE FROM system_settings WHERE key = p_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'setting_not_found';
  END IF;
  INSERT INTO activity_logs (user_id, workspace_id, action, resource_type, resource_id, description, metadata)
  VALUES (auth.uid(), NULL, 'admin_action', 'system_setting', p_key, 'Deleted system setting: ' || p_key, '{}'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_bulk_upsert_settings(
  p_settings JSONB
) RETURNS VOID AS $$
DECLARE
  v_setting JSONB;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;
  FOR v_setting IN SELECT * FROM jsonb_array_elements(p_settings)
  LOOP
    INSERT INTO system_settings (key, value, description, is_public, updated_by)
    VALUES (
      v_setting->>'key',
      v_setting->'value',
      v_setting->>'description',
      COALESCE((v_setting->>'is_public')::boolean, false),
      auth.uid()
    )
    ON CONFLICT (key) DO UPDATE SET
      value = v_setting->'value',
      description = COALESCE(v_setting->>'description', system_settings.description),
      is_public = COALESCE((v_setting->>'is_public')::boolean, system_settings.is_public),
      updated_at = now(),
      updated_by = auth.uid();
  END LOOP;
  INSERT INTO activity_logs (user_id, workspace_id, action, resource_type, resource_id, description, metadata)
  VALUES (auth.uid(), NULL, 'admin_action', 'system_setting', NULL,
    'Bulk updated system settings', jsonb_build_object('count', jsonb_array_length(p_settings)));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ────────────────────────────────────────────────────────────
-- PART 3: Feature Flags RPCs
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_list_flags(p_category TEXT DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  key TEXT,
  name JSONB,
  description JSONB,
  category TEXT,
  is_enabled BOOLEAN,
  plan_key TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;
  RETURN QUERY
  SELECT ff.id, ff.key, ff.name, ff.description, ff.category,
    ff.is_enabled, ff.plan_key, ff.metadata, ff.created_at, ff.updated_at
  FROM feature_flags ff
  WHERE p_category IS NULL OR ff.category = p_category
  ORDER BY ff.category, ff.key;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_get_flag(p_flag_id UUID)
RETURNS TABLE (
  id UUID,
  key TEXT,
  name JSONB,
  description JSONB,
  category TEXT,
  is_enabled BOOLEAN,
  plan_key TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;
  RETURN QUERY
  SELECT ff.id, ff.key, ff.name, ff.description, ff.category,
    ff.is_enabled, ff.plan_key, ff.metadata, ff.created_at, ff.updated_at
  FROM feature_flags ff
  WHERE ff.id = p_flag_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'flag_not_found';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_toggle_flag(p_flag_id UUID, p_enabled BOOLEAN)
RETURNS VOID AS $$
DECLARE
  v_key TEXT;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;
  SELECT key INTO v_key FROM feature_flags WHERE id = p_flag_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'flag_not_found';
  END IF;
  UPDATE feature_flags
  SET is_enabled = p_enabled, updated_at = now(), updated_by = auth.uid()
  WHERE id = p_flag_id;
  INSERT INTO activity_logs (user_id, workspace_id, action, resource_type, resource_id, description, metadata)
  VALUES (auth.uid(), NULL, 'admin_action', 'feature_flag', p_flag_id::text,
    CASE WHEN p_enabled THEN 'Enabled feature flag: ' ELSE 'Disabled feature flag: ' END || v_key,
    jsonb_build_object('key', v_key, 'enabled', p_enabled));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_update_flag(
  p_flag_id UUID,
  p_name JSONB DEFAULT NULL,
  p_description JSONB DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_plan_key TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_key TEXT;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;
  SELECT key INTO v_key FROM feature_flags WHERE id = p_flag_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'flag_not_found';
  END IF;
  UPDATE feature_flags SET
    name        = COALESCE(p_name, name),
    description = COALESCE(p_description, description),
    category    = COALESCE(p_category, category),
    plan_key    = p_plan_key,
    metadata    = COALESCE(p_metadata, metadata),
    updated_at  = now(),
    updated_by  = auth.uid()
  WHERE id = p_flag_id;
  INSERT INTO activity_logs (user_id, workspace_id, action, resource_type, resource_id, description, metadata)
  VALUES (auth.uid(), NULL, 'admin_action', 'feature_flag', p_flag_id::text,
    'Updated feature flag: ' || v_key,
    jsonb_build_object('key', v_key, 'category', p_category, 'plan_key', p_plan_key));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_create_flag(
  p_key TEXT,
  p_name JSONB,
  p_description JSONB DEFAULT '{}'::jsonb,
  p_category TEXT DEFAULT 'general',
  p_is_enabled BOOLEAN DEFAULT false,
  p_plan_key TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;
  IF p_category NOT IN ('general', 'whatsapp', 'facebook', 'ai', 'billing', 'security', 'experimental') THEN
    RAISE EXCEPTION 'invalid_category';
  END IF;
  INSERT INTO feature_flags (key, name, description, category, is_enabled, plan_key, updated_by)
  VALUES (p_key, p_name, p_description, p_category, p_is_enabled, p_plan_key, auth.uid())
  RETURNING id INTO v_id;
  INSERT INTO activity_logs (user_id, workspace_id, action, resource_type, resource_id, description, metadata)
  VALUES (auth.uid(), NULL, 'admin_action', 'feature_flag', v_id::text,
    'Created feature flag: ' || p_key,
    jsonb_build_object('key', p_key, 'category', p_category, 'enabled', p_is_enabled));
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION admin_delete_flag(p_flag_id UUID) RETURNS VOID AS $$
DECLARE
  v_key TEXT;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'insufficient_privileges';
  END IF;
  SELECT key INTO v_key FROM feature_flags WHERE id = p_flag_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'flag_not_found';
  END IF;
  DELETE FROM feature_flags WHERE id = p_flag_id;
  INSERT INTO activity_logs (user_id, workspace_id, action, resource_type, resource_id, description, metadata)
  VALUES (auth.uid(), NULL, 'admin_action', 'feature_flag', p_flag_id::text,
    'Deleted feature flag: ' || v_key, jsonb_build_object('key', v_key));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
