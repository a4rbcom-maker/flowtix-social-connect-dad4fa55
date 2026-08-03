import type { Database } from "./database.types";

export type WaConversation = Database["public"]["Tables"]["wa_conversations"]["Row"];
export type WaMessage = Database["public"]["Tables"]["wa_messages"]["Row"];
export type WaContact = Database["public"]["Tables"]["wa_contacts"]["Row"];
export type WaNote = Database["public"]["Tables"]["wa_notes"]["Row"];
export type WaMessageStatus = Database["public"]["Enums"]["wa_message_status"];
export type WaMessageDirection = Database["public"]["Enums"]["wa_message_direction"];
export type WaMessageType = Database["public"]["Enums"]["wa_message_type"];

export interface ConversationWithContact extends WaConversation {
  contact?: WaContact;
}
