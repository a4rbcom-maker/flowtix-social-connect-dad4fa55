
-- 1) Admin audit log
CREATE TABLE public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL,
  action text NOT NULL,
  target_user_id uuid,
  target_type text,
  target_id text,
  payload jsonb DEFAULT '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.admin_audit_log TO authenticated;
GRANT ALL ON public.admin_audit_log TO service_role;
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view audit log" ON public.admin_audit_log
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 2) Platform settings
CREATE TABLE public.platform_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.platform_settings TO authenticated;
GRANT ALL ON public.platform_settings TO service_role;
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone authenticated reads settings" ON public.platform_settings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage settings" ON public.platform_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.platform_settings (key, value, description) VALUES
  ('maintenance_mode', 'false'::jsonb, 'إيقاف الوصول لجميع المستخدمين عدا الأدمن'),
  ('signup_enabled',   'true'::jsonb,  'السماح بتسجيل حسابات جديدة'),
  ('default_plan',     '"free"'::jsonb, 'الباقة الافتراضية لكل مستخدم جديد'),
  ('default_ai_model', '"google/gemini-2.5-flash"'::jsonb, 'نموذج الذكاء الاصطناعي الافتراضي');

-- 3) Platform announcements
CREATE TABLE public.platform_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  level text NOT NULL DEFAULT 'info', -- info | warning | success | critical
  target_kind text NOT NULL DEFAULT 'all', -- all | plan | users
  target_plan text,
  target_user_ids uuid[] DEFAULT '{}'::uuid[],
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.platform_announcements TO authenticated;
GRANT ALL ON public.platform_announcements TO service_role;
ALTER TABLE public.platform_announcements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see relevant announcements" ON public.platform_announcements
  FOR SELECT TO authenticated USING (
    (ends_at IS NULL OR ends_at > now())
    AND starts_at <= now()
    AND (
      target_kind = 'all'
      OR (target_kind = 'users' AND auth.uid() = ANY(target_user_ids))
      OR (target_kind = 'plan' AND target_plan = (SELECT plan FROM public.profiles WHERE id = auth.uid()))
    )
  );
CREATE POLICY "Admins manage announcements" ON public.platform_announcements
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 4) Indexes
CREATE INDEX idx_admin_audit_created ON public.admin_audit_log(created_at DESC);
CREATE INDEX idx_admin_audit_target ON public.admin_audit_log(target_user_id);
CREATE INDEX idx_announcements_active ON public.platform_announcements(starts_at, ends_at);

-- 5) KPI snapshot RPC (admin-only inside function via has_role check)
CREATE OR REPLACE FUNCTION public.admin_kpi_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'users_total',          (SELECT count(*) FROM public.profiles),
    'users_new_7d',         (SELECT count(*) FROM public.profiles WHERE created_at > now() - interval '7 days'),
    'users_new_30d',        (SELECT count(*) FROM public.profiles WHERE created_at > now() - interval '30 days'),
    'fb_connections',       (SELECT count(*) FROM public.facebook_connections),
    'fb_bot_accounts',      (SELECT count(*) FROM public.fb_bot_accounts),
    'wa_sessions_total',    (SELECT count(*) FROM public.wa_sessions),
    'wa_sessions_active',   (SELECT count(*) FROM public.wa_sessions WHERE status = 'connected'),
    'contacts_total',       (SELECT count(*) FROM public.contacts),
    'fb_campaigns_total',   (SELECT count(*) FROM public.fb_campaigns),
    'fb_jobs_running',      (SELECT count(*) FROM public.fb_jobs WHERE status IN ('running','pending')),
    'bulk_jobs_running',    (SELECT count(*) FROM public.bulk_jobs WHERE status IN ('running','scheduled')),
    'messages_today',       (SELECT count(*) FROM public.wa_messages WHERE created_at > now() - interval '1 day'),
    'messages_7d',          (SELECT count(*) FROM public.wa_messages WHERE created_at > now() - interval '7 days'),
    'send_log_today',       (SELECT count(*) FROM public.send_log WHERE created_at > now() - interval '1 day'),
    'send_log_success_7d',  (SELECT count(*) FROM public.send_log WHERE created_at > now() - interval '7 days' AND status = 'sent'),
    'send_log_failed_7d',   (SELECT count(*) FROM public.send_log WHERE created_at > now() - interval '7 days' AND status = 'failed'),
    'ai_calls_7d',          (SELECT count(*) FROM public.wa_ai_logs WHERE created_at > now() - interval '7 days'),
    'ai_tokens_7d',         (SELECT COALESCE(SUM(COALESCE(tokens_in,0) + COALESCE(tokens_out,0)),0) FROM public.wa_ai_logs WHERE created_at > now() - interval '7 days'),
    'plans_distribution',   (SELECT jsonb_object_agg(COALESCE(plan,'free'), c) FROM (SELECT plan, count(*) c FROM public.profiles GROUP BY plan) t)
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_kpi_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_kpi_snapshot() TO authenticated;

-- 6) Daily timeseries (for charts)
CREATE OR REPLACE FUNCTION public.admin_daily_timeseries(_days int DEFAULT 30)
RETURNS TABLE(day date, new_users bigint, wa_messages bigint, send_success bigint, send_failed bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH days AS (
    SELECT generate_series((now() - (_days || ' days')::interval)::date, now()::date, '1 day')::date AS d
  )
  SELECT
    d.d AS day,
    (SELECT count(*) FROM public.profiles p WHERE p.created_at::date = d.d) AS new_users,
    (SELECT count(*) FROM public.wa_messages m WHERE m.created_at::date = d.d) AS wa_messages,
    (SELECT count(*) FROM public.send_log s WHERE s.created_at::date = d.d AND s.status = 'sent') AS send_success,
    (SELECT count(*) FROM public.send_log s WHERE s.created_at::date = d.d AND s.status = 'failed') AS send_failed
  FROM days d
  ORDER BY d.d;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_daily_timeseries(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_daily_timeseries(int) TO authenticated;

-- 7) Promote first registered user as admin (Eng. Khaled Abdulrahman)
INSERT INTO public.user_roles (user_id, role)
VALUES ('3aea1038-181a-492c-abd7-af9ed7c6e18f', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;
