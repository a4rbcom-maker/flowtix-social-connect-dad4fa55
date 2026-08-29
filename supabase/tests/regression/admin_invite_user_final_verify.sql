-- Final verification (step 19): prove admin_invite_user actually CREATES a real user
-- through the same path the frontend uses (auth.uid() = super_admin), and that the
-- created auth.users + profiles + user_roles rows are consistent. Self-cleaning.

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_suffix text := replace(now()::text, ' ', '_') || '_' || substr(gen_random_uuid()::text, 1, 8);
  v_admin_email text := 'rt-admin-' || v_suffix || '@flowtix.example';
  v_invite_email text := 'rt-invite-' || v_suffix || '@flowtix.example';
  v_new uuid;
  v_auth_exists boolean;
  v_prof_status text;
  v_role_key text;
begin
  insert into auth.users (id, email, raw_user_meta_data) values (v_admin, v_admin_email, '{}');
  insert into user_roles (user_id, role_id, workspace_id, assigned_by)
  select v_admin, r.id, v_admin, v_admin
  from roles r where r.key = 'super_admin' and r.is_system = true limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);

  select public.admin_invite_user(v_invite_email, 'Verify User', 'admin') into v_new;
  assert v_new is not null, 'returned NULL';

  select exists(select 1 from auth.users where id = v_new) into v_auth_exists;
  select status::text into v_prof_status from profiles where user_id = v_new;
  select r.key into v_role_key
  from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = v_new limit 1;

  raise notice 'VERIFY: new_user_id=% auth_exists=% profile_status=% role=%',
    v_new, v_auth_exists, v_prof_status, v_role_key;

  assert v_auth_exists, 'auth.users row missing (FK broken)';
  assert v_prof_status = 'pending', 'profile status not pending: ' || v_prof_status;
  assert v_role_key = 'admin', 'role not assigned correctly: ' || coalesce(v_role_key, 'null');

  -- cleanup
  delete from user_roles where user_id in (v_admin, v_new);
  delete from profiles   where user_id in (v_admin, v_new);
  delete from auth.users where id     in (v_admin, v_new);

  raise notice 'STEP 19 PASSED: invite creates auth user + pending profile + correct role';
end $$;
