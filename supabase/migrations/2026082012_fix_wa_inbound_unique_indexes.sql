-- Fix: upsert_wa_inbound fails with 42P10 (no unique or exclusion constraint
-- matching ON CONFLICT specification). The RPC upserts on:
--   wa_contacts    (workspace_id, phone) WHERE status <> 'deleted'   [partial]
--   wa_conversations (workspace_id, wa_session_id, contact_id)
-- Index predicates/columns must match the ON CONFLICT clauses exactly.
-- Tables are empty, so index creation cannot conflict with existing data.

create unique index if not exists wa_contacts_workspace_phone_uidx
  on public.wa_contacts (workspace_id, phone)
  where status <> 'deleted';

create unique index if not exists wa_conversations_ws_session_contact_uidx
  on public.wa_conversations (workspace_id, wa_session_id, contact_id);

-- Message dedup: WhatsApp message ids are globally unique. Duplicate inserts
-- (Baileys re-notify) will error and are logged by wa-manager instead of
-- appearing twice in the inbox.
create unique index if not exists wa_messages_wa_message_id_uidx
  on public.wa_messages (wa_message_id);
