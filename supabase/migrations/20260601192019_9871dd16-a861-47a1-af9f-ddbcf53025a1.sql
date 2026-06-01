CREATE OR REPLACE FUNCTION public.admin_daily_timeseries(_days integer DEFAULT 30)
 RETURNS TABLE(day date, new_users bigint, wa_messages bigint, send_success bigint, send_failed bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH days AS (
    SELECT generate_series((now() - (_days || ' days')::interval)::date, now()::date, '1 day')::date AS d
  )
  SELECT
    d.d AS day,
    (SELECT count(*) FROM public.profiles p WHERE p.created_at::date = d.d) AS new_users,
    (SELECT count(*) FROM public.wa_messages m WHERE m.created_at::date = d.d) AS wa_messages,
    (SELECT count(*) FROM public.send_log s WHERE s.created_at::date = d.d AND s.status = 'success'::send_status) AS send_success,
    (SELECT count(*) FROM public.send_log s WHERE s.created_at::date = d.d AND s.status = 'failed'::send_status) AS send_failed
  FROM days d
  ORDER BY d.d;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_kpi_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
BEGIN
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
    'send_log_success_7d',  (SELECT count(*) FROM public.send_log WHERE created_at > now() - interval '7 days' AND status = 'success'::send_status),
    'send_log_failed_7d',   (SELECT count(*) FROM public.send_log WHERE created_at > now() - interval '7 days' AND status = 'failed'::send_status),
    'ai_calls_7d',          (SELECT count(*) FROM public.wa_ai_logs WHERE created_at > now() - interval '7 days'),
    'ai_tokens_7d',         (SELECT COALESCE(SUM(COALESCE(tokens_in,0) + COALESCE(tokens_out,0)),0) FROM public.wa_ai_logs WHERE created_at > now() - interval '7 days'),
    'plans_distribution',   (SELECT jsonb_object_agg(COALESCE(plan,'free'), c) FROM (SELECT plan, count(*) c FROM public.profiles GROUP BY plan) t)
  ) INTO result;
  RETURN result;
END;
$function$;