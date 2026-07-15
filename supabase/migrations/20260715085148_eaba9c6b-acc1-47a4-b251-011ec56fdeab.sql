-- Add connected_at column to wa_sessions to track when the current connection started.
ALTER TABLE public.wa_sessions
  ADD COLUMN IF NOT EXISTS connected_at timestamptz;

-- Trigger function: set connected_at when a session transitions INTO 'connected'
-- from a different status; clear it when it leaves 'connected'.
CREATE OR REPLACE FUNCTION public.wa_sessions_track_connected_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'connected' AND NEW.connected_at IS NULL THEN
      NEW.connected_at := now();
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.status = 'connected' AND COALESCE(OLD.status,'') <> 'connected' THEN
    NEW.connected_at := now();
  ELSIF NEW.status <> 'connected' AND COALESCE(OLD.status,'') = 'connected' THEN
    NEW.connected_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wa_sessions_track_connected_at ON public.wa_sessions;
CREATE TRIGGER trg_wa_sessions_track_connected_at
BEFORE INSERT OR UPDATE OF status ON public.wa_sessions
FOR EACH ROW
EXECUTE FUNCTION public.wa_sessions_track_connected_at();

-- Backfill currently-connected sessions using the most recent transition INTO 'connected'
-- from wa_session_events; fall back to updated_at when no event is found.
UPDATE public.wa_sessions s
SET connected_at = COALESCE(
  (
    SELECT e.created_at
    FROM public.wa_session_events e
    WHERE e.session_id = s.session_id
      AND e.to_status = 'connected'
      AND COALESCE(e.from_status, '') <> 'connected'
    ORDER BY e.created_at DESC
    LIMIT 1
  ),
  s.updated_at
)
WHERE s.status = 'connected'
  AND s.connected_at IS NULL;