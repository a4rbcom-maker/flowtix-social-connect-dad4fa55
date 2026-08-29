-- Regression test: admin_delete_user must HARD-delete the user (auth.users + profiles +
-- user_roles), not soft-delete. Self-cleaning (creates then deletes a throwaway user).
-- NOTE: inserting auth.users fires on_auth_user_created (creates profile + default role),
-- so we do NOT insert profiles manually here.

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_suffix text := replace(now()::text, ' ', '_') || '_' || substr(gen_random_uuid()::text, 1, 8);
  v_admin_email text := 'rt-admin-' || v_suffix || '@flowtix.example';
  v_target uuid := gen_random_uuid();
  v_target_email text := 'rt-target-' || v_suffix || '@flowtix.example';
begin
  -- super admin (trigger creates profile); grant super_admin role
  insert into auth.users (id, email, raw_user_meta_data) values (v_admin, v_admin_email, '{}');
  insert into user_roles (user_id, role_id, workspace_id, assigned_by)
  select v_admin, r.id, v_admin, v_admin from roles r where r.key='super_admin' and r.is_system=true limit 1;

  -- target user (trigger creates profile); grant user role
  insert into auth.users (id, email, raw_user_meta_data) values (v_target, v_target_email, '{}');
  insert into user_roles (user_id, role_id, workspace_id, assigned_by)
  select v_target, r.id, v_target, v_admin from roles r where r.key='user' and r.is_system=true limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  -- THE ASSERTION: hard delete
  perform public.admin_delete_user(v_target);

  assert not exists (select 1 from auth.users where id = v_target), 'auth.users row still exists (not hard deleted)';
  assert not exists (select 1 from profiles   where user_id = v_target), 'profiles row still exists (not hard deleted)';
  assert not exists (select 1 from user_roles where user_id = v_target), 'user_roles row still exists (not hard deleted)';

  -- cleanup admin
  delete from user_roles where user_id = v_admin;
  delete from profiles    where user_id = v_admin;
  delete from auth.users  where id = v_admin;

  raise notice 'DELETE REGRESSION PASSED: user hard-deleted (auth.users+profiles+user_roles gone)';
end $$;
