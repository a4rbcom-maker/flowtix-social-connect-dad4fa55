-- 1) Log the correction event
INSERT INTO public.wa_session_events (user_id, session_id, from_status, to_status, source, reason)
SELECT user_id, id, status::text, 'disconnected', 'manual', 'ghost_connected_not_on_bridge'
FROM public.wa_sessions
WHERE phone_number = '201060827148' AND status = 'connected';

-- 2) Mark ghost session as disconnected and unset primary
UPDATE public.wa_sessions
SET status = 'disconnected',
    is_primary = false,
    updated_at = now()
WHERE phone_number = '201060827148';

-- 3) Promote the actually-connected session to primary
UPDATE public.wa_sessions
SET is_primary = true,
    updated_at = now()
WHERE phone_number = '201508776669';

-- 4) Also demote the pending-QR session from primary (only one primary allowed)
UPDATE public.wa_sessions
SET is_primary = false,
    updated_at = now()
WHERE phone_number = '201008817478';

-- 5) Enforce: at most one primary per user going forward
CREATE UNIQUE INDEX IF NOT EXISTS wa_sessions_one_primary_per_user
  ON public.wa_sessions (user_id)
  WHERE is_primary = true;