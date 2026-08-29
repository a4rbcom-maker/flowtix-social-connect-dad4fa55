-- Fix Root Cause #2: trigger on_auth_user_created -> handle_new_user() still INSERTs into the
-- dropped "workspaces" table, so ANY new user (signup or accepted invite) fails with
-- 'relation "workspaces" does not exist'.
--
-- Root cause of the original admin bug was the live admin_invite_user referencing workspaces
-- (fixed in 2026082901). This migration fixes the parallel break in handle_new_user() which
-- blocks all user creation in the app.
--
-- Post-workspaces design (see 2026072716_remove_workspaces.sql): the workspaces table is GONE.
-- workspace_id columns on profiles/user_roles are kept but scoped to the user's own id.
-- We mirror that: v_workspace_id := NEW.id (no INSERT into workspaces).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_workspace_id uuid;
  v_role_id uuid;
begin
  -- Post-workspaces design: workspace_id is scoped to the user's own id (table removed).
  v_workspace_id := NEW.id;

  -- Create profile
  insert into public.profiles (user_id, workspace_id, email, full_name, status)
  values (
    NEW.id,
    v_workspace_id,
    NEW.email,
    coalesce(NEW.raw_user_meta_data ->> 'full_name', ''),
    'active'
  );

  -- Get the default 'user' role id (system role, workspace-scoped to the user)
  select id into v_role_id
  from public.roles
  where key = 'user' and (workspace_id = v_workspace_id or workspace_id is null)
  limit 1;

  -- Assign default 'user' role
  if v_role_id is not null then
    insert into public.user_roles (user_id, role_id, workspace_id, assigned_by)
    values (NEW.id, v_role_id, v_workspace_id, NEW.id);
  end if;

  -- Log signup (workspace_id scoped to the user)
  perform public.log_activity(
    v_workspace_id, NEW.id, 'signup',
    'user', NEW.id::text,
    'User signed up',
    jsonb_build_object('email', NEW.email)
  );

  return NEW;
end;
$$;

-- Re-attach the trigger (idempotent: drop first if exists)
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Reload PostgREST schema cache so the function/trigger changes take effect immediately.
notify pgrst, 'reload schema';
