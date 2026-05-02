import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

export type SendChannel = "whatsapp" | "facebook" | "bulk" | "system";
export type SendStatus = "pending" | "processing" | "success" | "failed";
export type SendLogRow = Tables<"send_log">;

interface LogParams {
  userId: string;
  channel: SendChannel;
  action: string;
  status?: SendStatus;
  title: string;
  description?: string;
  recipient?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Insert a new send_log row. Returns the row id so callers can update status later.
 */
export async function logSendActivity(p: LogParams): Promise<string | null> {
  const payload: TablesInsert<"send_log"> = {
    user_id: p.userId,
    channel: p.channel,
    action: p.action,
    status: p.status ?? "pending",
    title: p.title,
    description: p.description ?? null,
    recipient: p.recipient ?? null,
    error_message: p.errorMessage ?? null,
    metadata: (p.metadata ?? {}) as TablesInsert<"send_log">["metadata"],
  };
  const { data, error } = await supabase
    .from("send_log")
    .insert(payload)
    .select("id")
    .single();
  if (error) {
    console.error("logSendActivity failed", error);
    return null;
  }
  return data.id;
}

export async function updateSendStatus(
  id: string,
  status: SendStatus,
  patch?: { description?: string; errorMessage?: string; metadata?: Record<string, unknown> }
) {
  const update: TablesUpdate<"send_log"> = { status };
  if (patch?.description !== undefined) update.description = patch.description;
  if (patch?.errorMessage !== undefined) update.error_message = patch.errorMessage;
  if (patch?.metadata !== undefined) {
    update.metadata = patch.metadata as TablesUpdate<"send_log">["metadata"];
  }
  const { error } = await supabase.from("send_log").update(update).eq("id", id);
  if (error) console.error("updateSendStatus failed", error);
}

export async function markAllRead(userId: string) {
  const { error } = await supabase
    .from("send_log")
    .update({ read: true })
    .eq("user_id", userId)
    .eq("read", false);
  if (error) console.error("markAllRead failed", error);
}

export async function markRead(id: string) {
  await supabase.from("send_log").update({ read: true }).eq("id", id);
}
