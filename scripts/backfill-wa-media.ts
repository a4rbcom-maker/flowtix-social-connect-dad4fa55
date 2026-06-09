import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type WaMessage = {
  id: string;
  user_id: string;
  session_id: string;
  msg_type: string;
  text_body: string | null;
  media_url: string | null;
  raw: Record<string, unknown> | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function pickString(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function fallbackMimeType(msgType: string): string {
  if (msgType === "image") return "image/jpeg";
  if (msgType === "video") return "video/mp4";
  if (msgType === "audio") return "audio/ogg";
  if (msgType === "sticker") return "image/webp";
  return "application/octet-stream";
}

function extensionFromMime(mimeType: string, msgType: string): string {
  const clean = mimeType.split(";")[0]?.trim().toLowerCase();
  if (clean === "image/jpeg") return "jpg";
  if (clean === "image/png") return "png";
  if (clean === "image/webp") return "webp";
  if (clean === "video/mp4") return "mp4";
  if (clean === "audio/mpeg") return "mp3";
  if (clean === "audio/mp4") return "m4a";
  if (clean === "audio/ogg" || clean === "audio/opus") return "ogg";
  if (clean === "application/pdf") return "pdf";
  if (msgType === "image") return "jpg";
  if (msgType === "video") return "mp4";
  if (msgType === "audio") return "ogg";
  if (msgType === "sticker") return "webp";
  return "bin";
}

function safeBaseName(value: string | null, fallback: string): string {
  const last = (value ?? "").split(/[\\/]/).filter(Boolean).at(-1) ?? "";
  return (last || fallback).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 140) || fallback;
}

function looksLikeInternalMediaPath(value: string | null | undefined): boolean {
  return /^(bridge|media|uploads?|files?)\//i.test(value?.trim() ?? "");
}

function normalizeType(row: WaMessage): string {
  const raw = asRecord(row.raw);
  const rawType = pickString(raw, "type", "messageType", "mediaType");
  const type = (rawType || row.msg_type || "text").toLowerCase();
  if (type === "voice" || type === "ptt") return "audio";
  if (type === "file" || type === "doc") return "document";
  return type;
}

function mediaPayload(row: WaMessage): { bytes: Buffer; mimeType: string; fileName: string | null; msgType: string } | null {
  const raw = asRecord(row.raw);
  const media = asRecord(raw.mediaData);
  const msgType = normalizeType(row);
  const dataUrl = row.media_url?.startsWith("data:") ? row.media_url : pickString(media, "dataUrl");
  const base64 = dataUrl?.replace(/^data:[^,]+,/, "") || pickString(media, "base64", "fileData", "data");
  if (!base64) return null;
  const mimeType =
    dataUrl?.match(/^data:([^;]+(?:;[^,]+)?);base64,/)?.[1] ||
    pickString(media, "mimeType", "mimetype", "fileMimeType", "contentType") ||
    fallbackMimeType(msgType);
  return {
    bytes: Buffer.from(base64.replace(/\s+/g, ""), "base64"),
    mimeType,
    fileName: pickString(media, "fileName", "filename", "name"),
    msgType,
  };
}

const { data: rows, error } = await supabase
  .from("wa_messages")
  .select("id,user_id,session_id,msg_type,text_body,media_url,raw")
  .order("created_at", { ascending: false })
  .limit(1000);

if (error) throw error;

let uploaded = 0;
let skipped = 0;

for (const row of (rows ?? []) as WaMessage[]) {
  if (row.media_url?.startsWith("wa-media:") || /^(https?:)?\/\//i.test(row.media_url ?? "")) {
    skipped++;
    continue;
  }
  const payload = mediaPayload(row);
  if (!payload) {
    skipped++;
    continue;
  }
  const fallbackName = `${Date.now()}_${row.id}.${extensionFromMime(payload.mimeType, payload.msgType)}`;
  const fileName = safeBaseName(payload.fileName, fallbackName);
  const path = `${row.user_id}/${row.session_id}/${Date.now()}_${fileName}`;
  const upload = await supabase.storage.from("wa-media").upload(path, payload.bytes, {
    contentType: payload.mimeType,
    upsert: true,
  });
  if (upload.error) throw upload.error;

  const nextText = looksLikeInternalMediaPath(row.text_body) && payload.msgType !== "document" ? null : row.text_body;
  const update = await supabase
    .from("wa_messages")
    .update({ media_url: `wa-media:${path}`, msg_type: payload.msgType, text_body: nextText })
    .eq("id", row.id);
  if (update.error) throw update.error;
  uploaded++;
}

console.log(JSON.stringify({ uploaded, skipped, checked: rows?.length ?? 0 }, null, 2));