import { supabase } from "@/lib/supabase";
import type { WaContact, WaContactUpdate, ContactFilters, WaSmartList, WaContactListWithCount, WaContactListMemberContact } from "@/types/wa-contacts.types";

const TABLE = "wa_contacts";

function applyFilters(q: ReturnType<typeof supabase.from>, f: ContactFilters) {
  let query = q;
  if (f.search) query = query.or(`name.ilike.%${f.search}%,phone.ilike.%${f.search}%,push_name.ilike.%${f.search}%`);
  if (f.tab === "new") query = query.gte("created_at", new Date(Date.now() - 7 * 864e5).toISOString());
  if (f.tab === "active") query = query.gte("last_seen", new Date(Date.now() - 7 * 864e5).toISOString());
  if (f.tab === "inactive") query = query.lt("last_seen", new Date(Date.now() - 30 * 864e5).toISOString());
  if (f.tags && f.tags.length) query = query.overlaps("tags", f.tags);
  if (f.country) query = query.eq("country", f.country);
  if (f.assignedTo) query = query.eq("assigned_to", f.assignedTo);
  if (f.vip) query = query.eq("is_vip", true);
  return query.neq("status", "deleted");
}

export const waContactsRepository = {
  async list(workspaceId: string, filters?: ContactFilters): Promise<WaContact[]> {
    let q = applyFilters(supabase.from(TABLE).select("*"), filters ?? {})
      .eq("workspace_id", workspaceId)
      .order("last_seen", { ascending: false, nullsFirst: false });
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
  },
  async getById(id: string): Promise<WaContact | null> {
    const { data } = await supabase.from(TABLE).select("*").eq("id", id).single();
    return data;
  },
  async update(id: string, updates: WaContactUpdate): Promise<void> {
    const { error } = await supabase.from(TABLE).update(updates).eq("id", id);
    if (error) throw error;
  },
  async bulkTag(ids: string[], tags: string[]): Promise<void> {
    const { data } = await supabase.from(TABLE).select("id, tags").in("id", ids);
    for (const c of data ?? []) {
      const merged = Array.from(new Set([...(c.tags ?? []), ...tags]));
      await supabase.from(TABLE).update({ tags: merged }).eq("id", c.id);
    }
  },
  async bulkAssign(ids: string[], userId: string | null): Promise<void> {
    await supabase.from(TABLE).update({ assigned_to: userId }).in("id", ids);
  },
  async merge(sourceId: string, targetId: string): Promise<void> {
    const { error } = await supabase.rpc("merge_wa_contacts", { p_source_id: sourceId, p_target_id: targetId } as never);
    if (error) throw error;
  },
  async block(id: string, userId: string, reason?: string): Promise<void> {
    const { error } = await supabase.rpc("block_wa_contact", { p_contact_id: id, p_blocked_by: userId, p_reason: reason ?? null } as never);
    if (error) throw error;
  },
  async delete(id: string): Promise<void> {
    await supabase.from(TABLE).update({ status: "deleted" }).eq("id", id);
  },
  async exportMany(workspaceId: string, filters?: ContactFilters): Promise<WaContact[]> {
    return this.list(workspaceId, filters);
  },
  async importMany(workspaceId: string, rows: Partial<WaContact>[]): Promise<{ inserted: number; skipped: number }> {
    let inserted = 0, skipped = 0;
    for (const r of rows) {
      if (!r.phone) { skipped++; continue; }
      const { error } = await supabase.from(TABLE).upsert(
        { workspace_id: workspaceId, phone: r.phone, name: r.name, email: r.email, country: r.country, tags: r.tags ?? [], source: "import" },
        { onConflict: "workspace_id,phone", ignoreDuplicates: false }
      );
      if (error) skipped++; else inserted++;
    }
    return { inserted, skipped };
  },
  async listSmartLists(workspaceId: string): Promise<WaSmartList[]> {
    const { data, error } = await supabase.from("wa_smart_lists").select("*").eq("workspace_id", workspaceId).order("name");
    if (error) throw error;
    return data ?? [];
  },
  async saveSmartList(input: { workspaceId: string; name: string; filters: ContactFilters; color?: string }): Promise<void> {
    await supabase.from("wa_smart_lists").insert({ workspace_id: input.workspaceId, name: input.name, filters: input.filters as never, color: input.color ?? null });
  },

  // --- Contact Lists (named, explicit member sets) ---
  async listContactLists(workspaceId: string): Promise<WaContactListWithCount[]> {
    const { data, error } = await supabase.rpc("list_wa_contact_lists", { p_workspace_id: workspaceId } as never);
    if (error) throw error;
    return (data ?? []) as WaContactListWithCount[];
  },
  async createContactList(input: { workspaceId: string; name: string; description?: string; color?: string; createdBy?: string }): Promise<{ id: string }> {
    // Only set created_by if it's a valid non-empty UUID, otherwise leave null
    // to avoid FK violations on auth.users(id).
    const createdBy = input.createdBy && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.createdBy)
      ? input.createdBy
      : null;
    const { data, error } = await supabase
      .from("wa_contact_lists")
      .insert({
        workspace_id: input.workspaceId,
        name: input.name,
        description: input.description ?? null,
        color: input.color ?? "primary",
        created_by: createdBy,
      })
      .select("id")
      .single();
    if (error) throw error;
    return { id: (data as { id: string }).id };
  },
  async renameContactList(listId: string, name: string): Promise<void> {
    const { error } = await supabase.from("wa_contact_lists").update({ name }).eq("id", listId);
    if (error) throw error;
  },
  async deleteContactList(listId: string): Promise<void> {
    const { error } = await supabase.from("wa_contact_lists").delete().eq("id", listId);
    if (error) throw error;
  },
  async getContactListMembers(listId: string): Promise<WaContactListMemberContact[]> {
    const { data, error } = await supabase.rpc("get_wa_contact_list_members", { p_list_id: listId } as never);
    if (error) throw error;
    return (data ?? []) as unknown as WaContactListMemberContact[];
  },
  async addContactToList(listId: string, contactId: string): Promise<void> {
    const { error } = await supabase.from("wa_contact_list_members").insert({ list_id: listId, contact_id: contactId });
    if (error && error.code !== "23505") throw error;
  },
  async removeContactFromList(listId: string, contactId: string): Promise<void> {
    const { error } = await supabase.from("wa_contact_list_members").delete().eq("list_id", listId).eq("contact_id", contactId);
    if (error) throw error;
  },
  async addContactsToList(listId: string, contactIds: string[]): Promise<void> {
    if (!contactIds.length) return;
    const rows = contactIds.map((contact_id) => ({ list_id: listId, contact_id }));
    const { error } = await supabase.from("wa_contact_list_members").upsert(rows, { ignoreDuplicates: true });
    if (error) throw error;
  },
  async importContactsToList(input: { workspaceId: string; listId: string; rows: Partial<WaContact>[] }): Promise<{ inserted: number; skipped: number }> {
    let inserted = 0, skipped = 0;
    for (const r of input.rows) {
      if (!r.phone) { skipped++; continue; }
      const { data: existing } = await supabase
        .from("wa_contacts")
        .select("id")
        .eq("workspace_id", input.workspaceId)
        .eq("phone", r.phone)
        .maybeSingle();
      let contactId: string | null = (existing as { id: string } | null)?.id ?? null;
      if (!contactId) {
        const { data: created, error } = await supabase
          .from("wa_contacts")
          .insert({
            workspace_id: input.workspaceId,
            phone: r.phone,
            name: r.name ?? null,
            email: r.email ?? null,
            country: r.country ?? null,
            tags: r.tags ?? [],
            source: "list-import",
          })
          .select("id")
          .single();
        if (error || !created) { skipped++; continue; }
        contactId = (created as { id: string }).id;
      }
      const { error: mErr } = await supabase.from("wa_contact_list_members").insert({ list_id: input.listId, contact_id: contactId });
      if (mErr && mErr.code !== "23505") { skipped++; continue; }
      inserted++;
    }
    return { inserted, skipped };
  },
};
