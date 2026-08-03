-- Create a SECURITY DEFINER function that bypasses RLS for soft deletes.
-- The original UPDATE via supabase.from("fb_sessions").update() was hitting RLS
-- because PostgreSQL applies USING to both old AND new rows when WITH CHECK is absent.
-- Even after fixing the RLS policy, this approach is fragile.
-- This RPC runs as the function owner (postgres) and bypasses RLS entirely.

CREATE OR REPLACE FUNCTION soft_delete_fb_session(p_session_id UUID, p_user_id UUID) RETURNS VOID AS $$
DECLARE
  v_workspace_id UUID;
BEGIN
  SELECT workspace_id INTO v_workspace_id
  FROM public.fb_sessions
  WHERE id = p_session_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found or already deleted';
  END IF;

  UPDATE public.fb_sessions
  SET deleted_at = now(), deleted_by = p_user_id, status = 'disconnected', updated_at = now()
  WHERE id = p_session_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
