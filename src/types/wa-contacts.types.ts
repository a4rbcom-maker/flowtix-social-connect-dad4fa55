import type { Database } from "./database.types";

export type WaContact = Database["public"]["Tables"]["wa_contacts"]["Row"];
export type WaContactInsert = Database["public"]["Tables"]["wa_contacts"]["Insert"];
export type WaContactUpdate = Database["public"]["Tables"]["wa_contacts"]["Update"];
export type WaSmartList = Database["public"]["Tables"]["wa_smart_lists"]["Row"];
export type WaContactList = Database["public"]["Tables"]["wa_contact_lists"]["Row"];
export type WaContactListMember = Database["public"]["Tables"]["wa_contact_list_members"]["Row"];

export interface ContactFilters {
  search?: string;
  tab?: "all" | "new" | "active" | "inactive";
  tags?: string[];
  country?: string;
  assignedTo?: string;
  vip?: boolean;
}

export interface WaContactListWithCount extends WaContactList {
  member_count: number;
}

export interface WaContactListMemberContact {
  contact_id: string;
  name: string | null;
  push_name: string | null;
  phone: string | null;
  email: string | null;
  is_vip: boolean | null;
  tags: string[] | null;
  added_at: string;
}
