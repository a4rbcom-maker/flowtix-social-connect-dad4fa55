-- Fix: deleting a user from the super-admin panel only soft-deleted it
-- (admin_update_user_status set status='deleted' and kept the row), so the user stayed
-- listed and the UI rendered the raw i18n key "users.statusDeleted".
--
-- Add a real hard-delete RPC. admin_delete_user permanently removes the user:
--   - user_roles (FK user_id -> auth.users ON DELETE CASCADE, deleted explicitly first)
--   - profiles    (FK user_id -> auth.users ON DELETE CASCADE)
--   - auth.users  (cascade removes the above; deleting it last is safe)
-- activity_logs.user_id is ON DELETE SET NULL, so audit history is preserved.
--
-- Guards: super_admin only, cannot delete self, raises user_not_found if missing.

create or replace function public.admin_delete_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
begin
  if not is_super_admin() then
    raise exception 'insufficient_privileges';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'cannot_modify_self';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'user_not_found';
  end if;

  -- explicit deletes first (avoids any deferred cascade edge cases)
  delete from user_roles where user_id = p_user_id;
  delete from profiles    where user_id = p_user_id;
  delete from auth.users  where id = p_user_id;
end;
$$;

grant execute on function public.admin_delete_user(uuid) to authenticated;

notify pgrst, 'reload schema';
