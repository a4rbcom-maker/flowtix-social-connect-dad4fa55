// Helpers used by WhatsApp chat server functions. Kept in a .server.ts file
// so the tss-serverfn-split transformer can resolve them via import.

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function pickString(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export function digits(value: string | null): string | null {
  const cleaned = value?.replace(/[^0-9]/g, "") ?? "";
  return cleaned || null;
}

export function normalizeWhatsappPhone(value: string | null | undefined, defaultCountryCode = "20"): string | null {
  let cleaned = value?.trim() ?? "";
  if (!cleaned) return null;
  cleaned = cleaned.replace(/[^0-9+]/g, "");
  if (cleaned.startsWith("+")) cleaned = cleaned.slice(1);
  cleaned = cleaned.replace(/[^0-9]/g, "");
  if (cleaned.startsWith("00")) cleaned = cleaned.slice(2);
  if (!cleaned) return null;

  // Egypt local mobile format: 01xxxxxxxxx → 201xxxxxxxxx.
  if (defaultCountryCode === "20" && /^01[0125][0-9]{8}$/.test(cleaned)) {
    return `20${cleaned.slice(1)}`;
  }

  // Egypt mobile without leading zero: 1xxxxxxxxx → 201xxxxxxxxx.
  if (defaultCountryCode === "20" && /^1[0125][0-9]{8}$/.test(cleaned)) {
    return `20${cleaned}`;
  }

  // Generic local national format: leading 0 means replace it with default country code.
  if (cleaned.startsWith("0") && cleaned.length >= 8) {
    return `${defaultCountryCode}${cleaned.replace(/^0+/, "")}`;
  }

  return cleaned;
}

export function phoneFromRaw(raw: unknown): string | null {
  const obj = asRecord(raw);
  return normalizeWhatsappPhone(pickString(obj, "normalizedContactPhone", "senderPn", "participantPn", "phoneNumber", "phone"));
}

export function profilePicFromRaw(raw: unknown): string | null {
  const obj = asRecord(raw);
  return pickString(obj, "profilePicUrl", "groupProfilePicUrl", "avatarUrl", "picture", "photoUrl");
}

const MEDIA_TYPE_ALIASES: Record<string, string> = {
  image: "image",
  video: "video",
  audio: "audio",
  voice: "audio",
  ptt: "audio",
  document: "document",
  file: "document",
  doc: "document",
  sticker: "sticker",
  text: "text",
};

function mediaDataFromRaw(raw: unknown): Record<string, unknown> {
  return asRecord(asRecord(raw).mediaData);
}

function looksLikeInternalMediaPath(value: string | null | undefined): boolean {
  const text = value?.trim() ?? "";
  return Boolean(text) && /^(bridge|media|uploads?|files?)\//i.test(text);
}

function fallbackMimeType(msgType: string): string {
  if (msgType === "image") return "image/jpeg";
  if (msgType === "video") return "video/mp4";
  if (msgType === "audio") return "audio/ogg";
  if (msgType === "sticker") return "image/webp";
  if (msgType === "document") return "application/octet-stream";
  return "application/octet-stream";
}

function fileLabel(raw: unknown): string | null {
  const fileName = pickString(mediaDataFromRaw(raw), "fileName", "filename", "name");
  if (!fileName) return null;
  const parts = fileName.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? fileName;
}

export function normalizeWaMessageType(value: string | null | undefined): string {
  const key = String(value ?? "").trim().toLowerCase();
  return MEDIA_TYPE_ALIASES[key] ?? (key || "text");
}

export function mediaTypeFromRaw(raw: unknown, fallback?: string | null): string {
  const obj = asRecord(raw);
  const nested = asRecord(obj.message);
  const nestedKey = Object.keys(nested).find((key) => key.endsWith("Message"));
  const nestedType = nestedKey ? nestedKey.replace(/Message$/, "") : null;
  return normalizeWaMessageType(
    pickString(obj, "type", "messageType", "mediaType") ?? nestedType ?? fallback ?? "text",
  );
}

export function mediaUrlFromRaw(raw: unknown, fallbackType?: string | null): string | null {
  const obj = asRecord(raw);
  const media = mediaDataFromRaw(raw);
  const directUrl =
    pickString(media, "dataUrl", "url", "fileUrl", "downloadUrl", "mediaUrl") ??
    pickString(obj, "mediaUrl", "fileUrl", "url");

  if (directUrl?.startsWith("data:")) return directUrl;
  if (directUrl && /^(https?:)?\/\//i.test(directUrl)) return directUrl;

  const base64 = pickString(media, "base64", "fileData", "data");
  if (!base64) return null;

  const normalizedType = mediaTypeFromRaw(raw, fallbackType);
  const mimeType =
    pickString(media, "mimeType", "mimetype", "fileMimeType", "contentType") ??
    fallbackMimeType(normalizedType);
  const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  return `data:${mimeType};base64,${cleanBase64}`;
}

export function cleanMessageText(
  text: string | null | undefined,
  raw: unknown,
  msgType: string,
): string | null {
  const media = mediaDataFromRaw(raw);
  const caption = pickString(media, "caption") ?? pickString(asRecord(raw), "caption");
  if (caption && !looksLikeInternalMediaPath(caption)) return caption;

  const trimmed = text?.trim() ?? "";
  if (trimmed && !looksLikeInternalMediaPath(trimmed)) return trimmed;

  return normalizeWaMessageType(msgType) === "document" ? fileLabel(raw) : null;
}

export function previewTextFromRaw(
  raw: unknown,
  currentText: string | null | undefined,
  fallbackType?: string | null,
): string | null {
  const msgType = mediaTypeFromRaw(raw, fallbackType);
  const cleaned = cleanMessageText(currentText, raw, msgType);
  if (cleaned) return cleaned;
  if (msgType === "image") return "[image]";
  if (msgType === "video") return "[video]";
  if (msgType === "audio") return "[audio]";
  if (msgType === "document") return "[file]";
  if (msgType === "sticker") return "[sticker]";
  return currentText?.trim() || null;
}

export function hasInternalMediaPath(text: string | null | undefined): boolean {
  return looksLikeInternalMediaPath(text);
}
