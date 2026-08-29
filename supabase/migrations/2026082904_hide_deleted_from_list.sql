-- Fix: admin_list_users returned soft-deleted users (status='deleted'), so they stayed
-- visible in the super-admin user list even though the delete action is now a hard delete.
-- Hide deleted users from the list as a safety layer (matches the hard-delete behaviour).

create or replace function public.admin_list_users(
  p_search text default null,
  p_status text default null,
  p_role text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  user_id uuid, email text, full_name text, avatar_url text, status text, role text,
  last_sign_in timestamp with time zone, created_at timestamp with time zone,
  wa_sessions_count bigint, wa_messages_count bigint, ai_cost_usd numeric
)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
begin
  if not is_super_admin() then
    raise exception 'insufficient_privileges';
  end if;
  return query
  select distinct on (u.id)
    u.id as user_id, u.email::text, coalesce(p.full_name, ''), p.avatar_url,
    coalesce(p.status, 'pending')::text,
    coalesce(r.key, 'user'), u.last_sign_in_at, u.created_at,
    0::bigint, 0::bigint, 0::numeric
  from auth.users u
  left join profiles p on p.user_id = u.id
  left join user_roles ur on ur.user_id = u.id
  left join roles r on r.id = ur.role_id
  where
    -- hide hard/soft-deleted users from the list
    coalesce(p.status, 'pending')::text <> 'deleted'
    and (p_search is null or u.email ilike '%' || p_search || '%' or p.full_name ilike '%' || p_search || '%')
    and (p_status is null or coalesce(p.status, 'pending')::text = p_status)
    and (p_role is null or r.key = p_role)
  order by u.id, case r.key when 'super_admin' then 0 when 'admin' then 1 else 2 end, u.created_at desc
  limit p_limit offset p_offset;
end;
$$;

notify pgrst, 'reload schema';
