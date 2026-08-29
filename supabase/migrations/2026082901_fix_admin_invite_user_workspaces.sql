-- Fix Root Cause #1 (final): admin_invite_user must NOT reference the dropped "workspaces"
-- table AND must create the auth.users row so the profiles.user_id_fkey constraint holds.
--
-- The live DB enforces profiles.user_id -> auth.users(id) ON DELETE CASCADE. The previous
-- design inserted profiles directly with a random uuid (no auth.users row), which now fails
-- with a foreign-key violation. Correct behaviour for an invite: create the auth user first;
-- the on_auth_user_created trigger (fixed in 2026082902) creates the profile; then we assign
-- the role and mark the invitation pending.

create or replace function public.admin_invite_user(
  p_email text,
  p_full_name text default null,
  p_role text default 'user'
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_user_id uuid;
  v_role_id uuid;
begin
  if not is_super_admin() then
    raise exception 'insufficient_privileges';
  end if;

  -- avoid duplicates in both identity tables
  if exists (select 1 from auth.users where lower(email) = lower(p_email)) then
    raise exception 'user_already_exists';
  end if;
  if exists (select 1 from profiles where lower(email) = lower(p_email)) then
    raise exception 'user_already_exists';
  end if;

  -- 1) create the auth user (trigger creates the profile + default role automatically)
  v_user_id := gen_random_uuid();
  insert into auth.users (
    id, email, raw_user_meta_data, encrypted_password,
    email_confirmed_at, created_at, updated_at
  ) values (
    v_user_id, lower(p_email),
    jsonb_build_object('full_name', coalesce(p_full_name, '')),
    crypt(gen_random_uuid()::text, gen_salt('bf', 10)),
    null, now(), now()
  );

  -- 2) mark the invitation pending + scope workspace_id to the user's own id
  update profiles
  set status = 'pending', workspace_id = v_user_id, full_name = coalesce(p_full_name, full_name)
  where user_id = v_user_id;

  -- 3) assign the requested role. The on_auth_user_created trigger already inserted a
  --    default 'user' role; replace it with the invited role (avoid a duplicate role row).
  delete from user_roles where user_id = v_user_id;
  select id into v_role_id
  from roles
  where key = p_role and is_system = true
  limit 1;
  if v_role_id is not null then
    insert into user_roles (user_id, role_id, workspace_id, assigned_by)
    values (v_user_id, v_role_id, v_user_id, auth.uid());
  end if;

  return v_user_id;
end;
$$;

grant execute on function public.admin_invite_user(text, text, text) to authenticated;

-- Reload PostgREST schema cache.
notify pgrst, 'reload schema';
