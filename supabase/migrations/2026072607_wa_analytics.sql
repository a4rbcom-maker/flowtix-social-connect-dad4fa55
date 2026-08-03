-- ============================================================
-- TASK 12: WhatsApp Analytics RPCs
-- ============================================================

CREATE OR REPLACE FUNCTION _current_workspace_id()
RETURNS UUID AS $$
DECLARE v_ws UUID;
BEGIN
  SELECT workspace_id INTO v_ws FROM user_roles WHERE user_id = auth.uid() LIMIT 1;
  RETURN v_ws;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION wa_analytics_overview(p_days INT DEFAULT 30)
RETURNS TABLE (
  total_messages bigint, sent_messages bigint, received_messages bigint,
  delivered_count bigint, read_count bigint, failed_count bigint,
  delivery_rate numeric, read_rate numeric, failure_rate numeric,
  active_conversations bigint, total_contacts bigint, new_contacts_period bigint,
  avg_response_time_minutes numeric, ai_handled_count bigint, ai_cost_usd numeric, ai_escalation_rate numeric
) AS $$
DECLARE v_ws UUID := _current_workspace_id(); v_date_from TIMESTAMPTZ := NOW() - (p_days * INTERVAL '1 day');
BEGIN
  IF v_ws IS NULL THEN RAISE EXCEPTION 'no_workspace'; END IF;
  RETURN QUERY SELECT
    COUNT(*) FILTER (WHERE m.created_at >= v_date_from)::bigint,
    COUNT(*) FILTER (WHERE m.direction = 'outbound' AND m.created_at >= v_date_from)::bigint,
    COUNT(*) FILTER (WHERE m.direction = 'inbound' AND m.created_at >= v_date_from)::bigint,
    COUNT(*) FILTER (WHERE m.status = 'delivered' AND m.created_at >= v_date_from)::bigint,
    COUNT(*) FILTER (WHERE m.status = 'read' AND m.created_at >= v_date_from)::bigint,
    COUNT(*) FILTER (WHERE m.status = 'failed' AND m.created_at >= v_date_from)::bigint,
    CASE WHEN COUNT(*) FILTER (WHERE m.direction = 'outbound' AND m.created_at >= v_date_from) > 0
      THEN (COUNT(*) FILTER (WHERE m.status IN ('delivered', 'read') AND m.direction = 'outbound' AND m.created_at >= v_date_from)::numeric / COUNT(*) FILTER (WHERE m.direction = 'outbound' AND m.created_at >= v_date_from)::numeric * 100) ELSE 0 END,
    CASE WHEN COUNT(*) FILTER (WHERE m.direction = 'outbound' AND m.created_at >= v_date_from) > 0
      THEN (COUNT(*) FILTER (WHERE m.status = 'read' AND m.direction = 'outbound' AND m.created_at >= v_date_from)::numeric / COUNT(*) FILTER (WHERE m.direction = 'outbound' AND m.created_at >= v_date_from)::numeric * 100) ELSE 0 END,
    CASE WHEN COUNT(*) FILTER (WHERE m.direction = 'outbound' AND m.created_at >= v_date_from) > 0
      THEN (COUNT(*) FILTER (WHERE m.status = 'failed' AND m.direction = 'outbound' AND m.created_at >= v_date_from)::numeric / COUNT(*) FILTER (WHERE m.direction = 'outbound' AND m.created_at >= v_date_from)::numeric * 100) ELSE 0 END,
    (SELECT COUNT(*) FROM wa_conversations WHERE workspace_id = v_ws AND updated_at >= v_date_from)::bigint,
    (SELECT COUNT(*) FROM wa_contacts WHERE workspace_id = v_ws)::bigint,
    (SELECT COUNT(*) FROM wa_contacts WHERE workspace_id = v_ws AND created_at >= v_date_from)::bigint,
    0::numeric,
    COALESCE((SELECT COUNT(*) FROM ai_invocations WHERE workspace_id = v_ws AND created_at >= v_date_from), 0)::bigint,
    COALESCE((SELECT SUM(cost_usd) FROM ai_invocations WHERE workspace_id = v_ws AND created_at >= v_date_from), 0)::numeric,
    CASE WHEN COALESCE((SELECT COUNT(*) FROM ai_invocations WHERE workspace_id = v_ws AND created_at >= v_date_from), 0) > 0
      THEN (COALESCE((SELECT COUNT(*) FROM ai_invocations WHERE workspace_id = v_ws AND escalated_to_human = true AND created_at >= v_date_from), 0)::numeric / (SELECT COUNT(*) FROM ai_invocations WHERE workspace_id = v_ws AND created_at >= v_date_from)::numeric * 100) ELSE 0 END
  FROM wa_messages m WHERE m.workspace_id = v_ws;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION wa_analytics_message_trend(p_days INT DEFAULT 30)
RETURNS TABLE (date TEXT, sent bigint, received bigint, failed bigint) AS $$
DECLARE v_ws UUID := _current_workspace_id();
BEGIN
  IF v_ws IS NULL THEN RAISE EXCEPTION 'no_workspace'; END IF;
  RETURN QUERY SELECT TO_CHAR(d.day, 'YYYY-MM-DD') AS date,
    COALESCE(COUNT(m.id) FILTER (WHERE m.direction = 'outbound'), 0)::bigint AS sent,
    COALESCE(COUNT(m.id) FILTER (WHERE m.direction = 'inbound'), 0)::bigint AS received,
    COALESCE(COUNT(m.id) FILTER (WHERE m.status = 'failed'), 0)::bigint AS failed
  FROM generate_series(DATE_TRUNC('day', NOW()) - (p_days - 1) * INTERVAL '1 day', DATE_TRUNC('day', NOW()), INTERVAL '1 day') AS d(day)
  LEFT JOIN wa_messages m ON m.workspace_id = v_ws AND m.created_at >= d.day AND m.created_at < d.day + INTERVAL '1 day'
  GROUP BY d.day ORDER BY d.day;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION wa_analytics_status_distribution(p_days INT DEFAULT 30)
RETURNS TABLE (status TEXT, count bigint) AS $$
DECLARE v_ws UUID := _current_workspace_id(); v_date_from TIMESTAMPTZ := NOW() - (p_days * INTERVAL '1 day');
BEGIN
  IF v_ws IS NULL THEN RAISE EXCEPTION 'no_workspace'; END IF;
  RETURN QUERY SELECT m.status::text, COUNT(*)::bigint FROM wa_messages m WHERE m.workspace_id = v_ws AND m.created_at >= v_date_from GROUP BY m.status ORDER BY COUNT(*) DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION wa_analytics_type_distribution(p_days INT DEFAULT 30)
RETURNS TABLE (type TEXT, count bigint) AS $$
DECLARE v_ws UUID := _current_workspace_id(); v_date_from TIMESTAMPTZ := NOW() - (p_days * INTERVAL '1 day');
BEGIN
  IF v_ws IS NULL THEN RAISE EXCEPTION 'no_workspace'; END IF;
  RETURN QUERY SELECT m.type::text, COUNT(*)::bigint FROM wa_messages m WHERE m.workspace_id = v_ws AND m.created_at >= v_date_from GROUP BY m.type ORDER BY COUNT(*) DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION wa_analytics_top_contacts(p_limit INT DEFAULT 10, p_days INT DEFAULT 30)
RETURNS TABLE (contact_id UUID, contact_name TEXT, contact_phone TEXT, messages_count bigint, inbound_count bigint, outbound_count bigint, last_message_at TIMESTAMPTZ) AS $$
DECLARE v_ws UUID := _current_workspace_id(); v_date_from TIMESTAMPTZ := NOW() - (p_days * INTERVAL '1 day');
BEGIN
  IF v_ws IS NULL THEN RAISE EXCEPTION 'no_workspace'; END IF;
  RETURN QUERY SELECT c.id, COALESCE(c.name, c.phone_number) AS contact_name, c.phone_number AS contact_phone,
    COUNT(m.id)::bigint AS messages_count, COUNT(m.id) FILTER (WHERE m.direction = 'inbound')::bigint AS inbound_count,
    COUNT(m.id) FILTER (WHERE m.direction = 'outbound')::bigint AS outbound_count, MAX(m.created_at) AS last_message_at
  FROM wa_contacts c LEFT JOIN wa_messages m ON m.contact_id = c.id AND m.created_at >= v_date_from
  WHERE c.workspace_id = v_ws GROUP BY c.id, c.name, c.phone_number HAVING COUNT(m.id) > 0
  ORDER BY messages_count DESC LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION wa_analytics_campaigns(p_limit INT DEFAULT 10)
RETURNS TABLE (campaign_id UUID, campaign_name TEXT, status TEXT, type TEXT, total_recipients bigint, sent_count bigint, delivered_count bigint, read_count bigint, failed_count bigint, delivery_rate numeric, read_rate numeric, created_at TIMESTAMPTZ) AS $$
DECLARE v_ws UUID := _current_workspace_id();
BEGIN
  IF v_ws IS NULL THEN RAISE EXCEPTION 'no_workspace'; END IF;
  RETURN QUERY SELECT cmp.id AS campaign_id, cmp.name AS campaign_name, cmp.status::text, cmp.type::text,
    COUNT(cr.id)::bigint AS total_recipients, COUNT(cr.id) FILTER (WHERE cr.status = 'sent')::bigint,
    COUNT(cr.id) FILTER (WHERE cr.status = 'delivered')::bigint, COUNT(cr.id) FILTER (WHERE cr.status = 'read')::bigint,
    COUNT(cr.id) FILTER (WHERE cr.status = 'failed')::bigint,
    CASE WHEN COUNT(cr.id) > 0 THEN (COUNT(cr.id) FILTER (WHERE cr.status IN ('delivered', 'read'))::numeric / COUNT(cr.id)::numeric * 100) ELSE 0 END,
    CASE WHEN COUNT(cr.id) > 0 THEN (COUNT(cr.id) FILTER (WHERE cr.status = 'read')::numeric / COUNT(cr.id)::numeric * 100) ELSE 0 END,
    cmp.created_at
  FROM wa_campaigns cmp LEFT JOIN wa_campaign_recipients cr ON cr.campaign_id = cmp.id
  WHERE cmp.workspace_id = v_ws GROUP BY cmp.id, cmp.name, cmp.status, cmp.type, cmp.created_at ORDER BY cmp.created_at DESC LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION wa_analytics_ai_usage(p_days INT DEFAULT 30)
RETURNS TABLE (total_invocations bigint, successful bigint, failed bigint, escalated bigint, total_cost numeric, total_tokens bigint, avg_latency_ms numeric, by_level JSONB, by_model JSONB) AS $$
DECLARE v_ws UUID := _current_workspace_id(); v_date_from TIMESTAMPTZ := NOW() - (p_days * INTERVAL '1 day');
BEGIN
  IF v_ws IS NULL THEN RAISE EXCEPTION 'no_workspace'; END IF;
  RETURN QUERY SELECT COUNT(*)::bigint, COUNT(*) FILTER (WHERE i.success)::bigint, COUNT(*) FILTER (WHERE NOT i.success)::bigint,
    COUNT(*) FILTER (WHERE i.escalated_to_human)::bigint, COALESCE(SUM(i.cost_usd), 0)::numeric, COALESCE(SUM(i.total_tokens), 0)::bigint, COALESCE(AVG(i.latency_ms), 0)::numeric,
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('level', level, 'count', cnt)), '[]'::jsonb) FROM (SELECT level, COUNT(*) AS cnt FROM ai_invocations WHERE workspace_id = v_ws AND created_at >= v_date_from GROUP BY level ORDER BY cnt DESC) l),
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('model', model, 'count', cnt, 'cost', cost)), '[]'::jsonb) FROM (SELECT model, COUNT(*) AS cnt, COALESCE(SUM(cost_usd), 0) AS cost FROM ai_invocations WHERE workspace_id = v_ws AND created_at >= v_date_from GROUP BY model ORDER BY cost DESC) m)
  FROM ai_invocations i WHERE i.workspace_id = v_ws AND i.created_at >= v_date_from;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION wa_analytics_hourly_activity(p_days INT DEFAULT 7)
RETURNS TABLE (day_of_week INT, hour INT, count bigint) AS $$
DECLARE v_ws UUID := _current_workspace_id(); v_date_from TIMESTAMPTZ := NOW() - (p_days * INTERVAL '1 day');
BEGIN
  IF v_ws IS NULL THEN RAISE EXCEPTION 'no_workspace'; END IF;
  RETURN QUERY SELECT EXTRACT(DOW FROM m.created_at)::int AS day_of_week, EXTRACT(HOUR FROM m.created_at)::int AS hour, COUNT(*)::bigint
  FROM wa_messages m WHERE m.workspace_id = v_ws AND m.created_at >= v_date_from
  GROUP BY EXTRACT(DOW FROM m.created_at), EXTRACT(HOUR FROM m.created_at) ORDER BY day_of_week, hour;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
