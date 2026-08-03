-- Fix: UPDATE RLS on fb_sessions was blocking soft deletes
-- 
-- Root cause: The old policy had "deleted_at IS NULL" in the USING clause.
-- In PostgreSQL, when WITH CHECK is absent, the USING clause is applied to
-- BOTH old and new rows. During soft delete (UPDATE setting deleted_at = NOW()),
-- the new row's deleted_at failed the USING check, causing RLS error.
--
-- Fix: Remove deleted_at from USING/WITH CHECK — workspace+super_admin checks
-- are sufficient. The softDelete function already validates deleted_at IS NULL
-- in its own SELECT before attempting the UPDATE.

DROP POLICY IF EXISTS update_own_fb_sessions ON public.fb_sessions;

CREATE POLICY update_own_fb_sessions ON public.fb_sessions
  FOR UPDATE
  USING (
    (workspace_id = current_workspace_id()) OR is_super_admin()
  )
  WITH CHECK (
    (workspace_id = current_workspace_id()) OR is_super_admin()
  );
