-- Fix: wa_conversations, wa_contacts and wa_messages had RLS enabled with ZERO
-- policies, so the frontend (user JWT) could not read anything while the
-- backend (service role) wrote successfully. Inbox appeared empty.
-- Pattern copied from wa_sessions: workspace_id equals the owner auth.uid().

create policy select_own_wa_contacts on public.wa_contacts
  for select using (workspace_id = auth.uid() or is_super_admin());
create policy update_own_wa_contacts on public.wa_contacts
  for update using (workspace_id = auth.uid() or is_super_admin());

create policy select_own_wa_conversations on public.wa_conversations
  for select using (workspace_id = auth.uid() or is_super_admin());
create policy update_own_wa_conversations on public.wa_conversations
  for update using (workspace_id = auth.uid() or is_super_admin())
  with check (workspace_id = auth.uid() or is_super_admin());

create policy select_own_wa_messages on public.wa_messages
  for select using (workspace_id = auth.uid() or is_super_admin());
create policy insert_own_wa_messages on public.wa_messages
  for insert with check (workspace_id = auth.uid() or is_super_admin());
