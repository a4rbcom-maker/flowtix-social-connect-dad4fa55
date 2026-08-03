-- TASK: WhatsApp Contact Lists (manual named lists with explicit members)
-- A user can create multiple named lists (e.g. "Lead Pool", "Black Friday")
-- each list contains an explicit set of contacts (name + phone already stored
-- in wa_contacts). This is independent of wa_smart_lists (which is a saved
-- filter preset, not a stored set of contacts).

create table if not exists wa_contact_lists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  description text,
  color text default 'primary',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index wa_contact_lists_ws_idx on wa_contact_lists (workspace_id, created_at desc);
do $$ begin create trigger wa_contact_lists_updated_at before update on wa_contact_lists for each row execute function set_updated_at(); exception when duplicate_object then null; end $$;

-- Membership table: explicit join list <-> contact
create table if not exists wa_contact_list_members (
  list_id uuid not null references wa_contact_lists(id) on delete cascade,
  contact_id uuid not null references wa_contacts(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (list_id, contact_id)
);
create index wa_contact_list_members_contact_idx on wa_contact_list_members (contact_id);
create index wa_contact_list_members_list_idx on wa_contact_list_members (list_id);

-- RLS: only members of the workspace can see/manage their lists
alter table wa_contact_lists enable row level security;
alter table wa_contact_list_members enable row level security;

do $$ begin
  create policy wa_contact_lists_select on wa_contact_lists for select
    using (workspace_id = current_workspace_id());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy wa_contact_lists_modify on wa_contact_lists for all
    using (workspace_id = current_workspace_id())
    with check (workspace_id = current_workspace_id());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy wa_contact_list_members_select on wa_contact_list_members for select
    using (exists (select 1 from wa_contact_lists l
                   where l.id = wa_contact_list_members.list_id
                     and l.workspace_id = current_workspace_id()));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy wa_contact_list_members_modify on wa_contact_list_members for all
    using (exists (select 1 from wa_contact_lists l
                   where l.id = wa_contact_list_members.list_id
                     and l.workspace_id = current_workspace_id()))
    with check (exists (select 1 from wa_contact_lists l
                        where l.id = wa_contact_list_members.list_id
                          and l.workspace_id = current_workspace_id()));
exception when duplicate_object then null; end $$;

-- Helper RPC: list all lists with member count
create or replace function list_wa_contact_lists(p_workspace_id uuid)
returns table (
  id uuid, name text, description text, color text,
  member_count bigint, created_at timestamptz, updated_at timestamptz
) as $$
begin
  return query
    select l.id, l.name, l.description, l.color,
      (select count(*) from wa_contact_list_members m where m.list_id = l.id)::bigint,
      l.created_at, l.updated_at
    from wa_contact_lists l
    where l.workspace_id = p_workspace_id
    order by l.created_at desc;
end;
$$ language plpgsql stable security definer;

-- Helper RPC: get contacts for a list (with member join)
create or replace function get_wa_contact_list_members(p_list_id uuid)
returns table (
  contact_id uuid, name text, push_name text, phone text, email text,
  is_vip boolean, tags text[], added_at timestamptz
) as $$
begin
  return query
    select c.id, c.name, c.push_name, c.phone, c.email, c.is_vip, c.tags, m.added_at
    from wa_contact_list_members m
    join wa_contacts c on c.id = m.contact_id
    where m.list_id = p_list_id
    order by m.added_at desc;
end;
$$ language plpgsql stable security definer;
