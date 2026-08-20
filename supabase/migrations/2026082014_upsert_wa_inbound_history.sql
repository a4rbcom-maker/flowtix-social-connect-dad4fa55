-- Update upsert_wa_inbound: add p_is_history flag (no unread increment, keep
-- newest last_message_at/preview on history import), stop empty push_name/body
-- from overwriting stored values, keep last_seen monotonic. Drops the old
-- overload so exactly one function remains.
drop function if exists public.upsert_wa_inbound(uuid, uuid, text, text, text, text, text, text, boolean, text, text, bigint);

create or replace function public.upsert_wa_inbound(p_workspace_id uuid, p_wa_session_id uuid, p_phone text, p_jid text, p_push_name text, p_type text, p_body text, p_wa_message_id text, p_has_media boolean default false, p_media_mime text default null, p_quoted_wa_id text default null, p_timestamp bigint default null, p_is_history boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_contact uuid; v_conv uuid; v_msg uuid; v_ts timestamptz;
begin
  v_ts := case when p_timestamp is not null then to_timestamp(p_timestamp / 1000.0) else now() end;

  insert into wa_contacts (workspace_id, phone, jid, push_name, last_seen, message_count)
  values (p_workspace_id, p_phone, p_jid, nullif(p_push_name, ''), v_ts, 1)
  on conflict (workspace_id, phone) where status <> 'deleted'
  do update set push_name = coalesce(nullif(excluded.push_name, ''), wa_contacts.push_name),
                last_seen = greatest(wa_contacts.last_seen, v_ts),
                message_count = wa_contacts.message_count + 1
  returning id into v_contact;

  insert into wa_conversations (workspace_id, wa_session_id, contact_id, last_message_at, last_message_preview)
  values (p_workspace_id, p_wa_session_id, v_contact, v_ts, left(coalesce(nullif(p_body, ''), '[media]'), 120))
  on conflict (workspace_id, wa_session_id, contact_id)
  do update set last_message_at = case when p_is_history then greatest(wa_conversations.last_message_at, v_ts) else v_ts end,
                last_message_preview = case when p_is_history and wa_conversations.last_message_at > v_ts then wa_conversations.last_message_preview else left(coalesce(nullif(p_body, ''), '[media]'), 120) end,
                unread_count = wa_conversations.unread_count + (case when p_is_history then 0 else 1 end)
  returning id into v_conv;

  insert into wa_messages (workspace_id, conversation_id, wa_session_id, contact_id, direction, type, body,
    status, wa_message_id, created_at)
  values (p_workspace_id, v_conv, p_wa_session_id, v_contact, 'inbound', p_type::wa_message_type, p_body,
    'delivered', p_wa_message_id, v_ts)
  returning id into v_msg;

  return v_msg;
end $function$;
