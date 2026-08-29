-- Regression test: admin_invite_user + on_auth_user_created trigger must NOT reference the
-- dropped "workspaces" table (Root Causes #1 and #2). Self-cleaning.
--
-- Flow: create a throwaway auth.user (fires on_auth_user_created -> creates its profile + role,
-- no workspaces insert), grant super_admin, impersonate the frontend RPC caller, then assert
-- admin_invite_user returns a uuid without the "workspaces" error.

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_suffix text := replace(now()::text, ' ', '_') || '_' || substr(gen_random_uuid()::text, 1, 8);
  v_admin_email text := 'rt-admin-' || v_suffix || '@flowtix.example';
  v_invite_email text := 'rt-invite-' || v_suffix || '@flowtix.example';
  v_new uuid;
begin
  -- create throwaway auth user (trigger creates profile + role automatically; must NOT touch workspaces)
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_admin, v_admin_email, '{}');
  -- grant super_admin (profile already exists via trigger)
  insert into user_roles (user_id, role_id, workspace_id, assigned_by)
  select v_admin, r.id, v_admin, v_admin
  from roles r where r.key = 'super_admin' and r.is_system = true
  limit 1;

  -- impersonate the UI RPC caller
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  -- THE ASSERTION: returns a uuid, no "workspaces" error
  select public.admin_invite_user(v_invite_email, 'RT Invite', 'user') into v_new;
  assert v_new is not null, 'admin_invite_user returned NULL (expected uuid)';
  assert exists (select 1 from profiles where user_id = v_new), 'invited user profile not created';

  -- cleanup
  delete from user_roles where user_id in (v_admin, v_new);
  delete from profiles   where user_id in (v_admin, v_new);
  delete from auth.users where id     in (v_admin, v_new);

  raise notice 'REGRESSION TEST PASSED: admin_invite_user + handle_new_user no longer reference workspaces';
end $$;
