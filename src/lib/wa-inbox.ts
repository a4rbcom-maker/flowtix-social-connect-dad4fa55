import { supabase } from "@/lib/supabase";
import type { ConversationWithContact, WaMessage, WaNote } from "@/types/wa-inbox.types";

const apiUrl = import.meta.env.VITE_EXTRACTION_API_URL || "http://localhost:3100";
const apiKey = import.meta.env.VITE_EXTRACTION_API_KEY || "local-dev-key-change-in-production";

export const waInboxRepository = {
  async listConversations(workspaceId: string, filters?: {
    status?: string; unread?: boolean; starred?: boolean; archived?: boolean;
    assignedTo?: string; spam?: boolean;
  }): Promise<ConversationWithContact[]> {
    let q = supabase.from("wa_conversations").select("*, contact:wa_contacts(*)")
      .eq("workspace_id", workspaceId).order("last_message_at", { ascending: false, nullsFirst: false });
    if (filters?.status) q = q.eq("status", filters.status);
    if (filters?.unread) q = q.gt("unread_count", 0);
    if (filters?.starred) q = q.eq("is_starred", true);
    if (filters?.archived !== undefined) q = q.eq("is_archived", !!filters.archived);
    if (filters?.spam !== undefined) q = q.eq("is_spam", !!filters.spam);
    if (filters?.assignedTo) q = q.eq("assigned_to", filters.assignedTo);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as ConversationWithContact[];
  },

  async getMessages(conversationId: string): Promise<WaMessage[]> {
    const { data, error } = await supabase.from("wa_messages").select("*")
      .eq("conversation_id", conversationId).order("created_at", { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  async sendMessage(input: {
    sessionId: string; conversationId: string; workspaceId: string;
    contactJid: string; text?: string; mediaType?: string; mediaUrl?: string;
    mimeType?: string; fileName?: string; caption?: string;
  }): Promise<void> {
    const type = input.mediaType || "text";
    const body = input.text || input.caption || "";
    const res = await fetch(`${apiUrl}/wa/send`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({
        session_id: input.sessionId, to: input.contactJid,
        payload: { type, text: input.text, mediaUrl: input.mediaUrl, caption: input.caption, mimeType: input.mimeType, fileName: input.fileName },
      }),
    });
    if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.error?.message ?? `HTTP ${res.status}`); }
    const { messageId } = await res.json();
    await supabase.from("wa_messages").insert({
      workspace_id: input.workspaceId, conversation_id: input.conversationId,
      wa_session_id: input.sessionId, direction: "outbound", type: type as never, body,
      status: "sent", wa_message_id: messageId, metadata: input.mediaUrl ? { media_url: input.mediaUrl, mime_type: input.mimeType, file_name: input.fileName } as never : {} as never,
    });
    const preview = body.slice(0, 120) || (type === "image" ? "[صورة]" : type === "video" ? "[فيديو]" : type === "audio" ? "[صوت]" : type === "document" ? "[مستند]" : "");
    await supabase.from("wa_conversations").update({
      last_message_at: new Date().toISOString(), last_message_preview: preview, unread_count: 0,
    }).eq("id", input.conversationId);
  },

  async uploadMedia(file: File, workspaceId?: string): Promise<{ key: string; url: string; mimeType: string; fileName: string; size: number }> {
    const formData = new FormData();
    formData.append("file", file);
    if (workspaceId) formData.append("workspace_id", workspaceId);
    const res = await fetch(`${apiUrl}/wa/media/upload`, {
      method: "POST", headers: { "X-API-Key": apiKey }, body: formData,
    });
    if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.error?.message ?? `HTTP ${res.status}`); }
    return res.json();
  },

  async markRead(conversationId: string) {
    await supabase.rpc("mark_wa_conversation_read", { p_conversation_id: conversationId } as never);
  },
  async star(id: string, v: boolean) { await supabase.from("wa_conversations").update({ is_starred: v }).eq("id", id); },
  async archive(id: string, v: boolean) { await supabase.from("wa_conversations").update({ is_archived: v }).eq("id", id); },
  async markSpam(id: string, v: boolean) { await supabase.from("wa_conversations").update({ is_spam: v }).eq("id", id); },
  async assign(id: string, userId: string | null) { await supabase.from("wa_conversations").update({ assigned_to: userId }).eq("id", id); },
  async setStatus(id: string, status: string) { await supabase.from("wa_conversations").update({ status }).eq("id", id); },
  async getNotes(conversationId: string): Promise<WaNote[]> {
    const { data } = await supabase.from("wa_notes").select("*").eq("conversation_id", conversationId).order("created_at", { ascending: false });
    return data ?? [];
  },
  async addNote(conversationId: string, workspaceId: string, userId: string, body: string) {
    await supabase.from("wa_notes").insert({ workspace_id: workspaceId, conversation_id: conversationId, user_id: userId, body });
  },
};
