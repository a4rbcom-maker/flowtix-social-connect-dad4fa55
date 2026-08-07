import type { WaMessage } from "@/types/wa-inbox.types";

export function formatTime(ts: string | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatRelativeTime(ts: string | null): string {
  if (!ts) return "";
  const now = Date.now();
  const then = new Date(ts).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return "الآن";
  if (diffMin < 60) return `قبل ${diffMin} دقيقة`;
  if (diffHr < 24) return `قبل ${diffHr} ساعة`;
  if (diffDay === 1) return "أمس";
  if (diffDay < 7) return `قبل ${diffDay} أيام`;
  return new Date(ts).toLocaleDateString();
}

export function formatDateSeparator(ts: string): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return "اليوم";
  if (d.toDateString() === yesterday.toDateString()) return "أمس";
  return d.toLocaleDateString();
}

export function messageHasMedia(m: WaMessage): boolean {
  return !!(m.type && m.type !== "text" && m.type !== "buttons" && m.type !== "location" && m.type !== "contact");
}

export function getMediaUrl(m: WaMessage): string | undefined {
  const meta = m.metadata as Record<string, unknown> | null;
  return (meta?.media_url as string) || (meta?.signed_url as string);
}

export function getMediaMime(m: WaMessage): string | undefined {
  const meta = m.metadata as Record<string, unknown> | null;
  return meta?.mime_type as string;
}

export function getMediaFileName(m: WaMessage): string | undefined {
  const meta = m.metadata as Record<string, unknown> | null;
  return meta?.file_name as string;
}

export function guessMediaType(m: WaMessage): "image" | "video" | "audio" | "document" {
  const mime = getMediaMime(m);
  if (m.type === "image" || mime?.startsWith("image/")) return "image";
  if (m.type === "video" || mime?.startsWith("video/")) return "video";
  if (m.type === "audio" || mime?.startsWith("audio/")) return "audio";
  return "document";
}

export function getMediaTypeFromFile(file: File): "image" | "video" | "audio" | "document" {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "document";
}

export const MAX_MEDIA_SIZE = 16 * 1024 * 1024;

export function validateMediaSize(file: File): { valid: boolean; error?: string } {
  if (file.size > MAX_MEDIA_SIZE) {
    return { valid: false, error: "حجم الملف يتجاوز 16 ميجابايت" };
  }
  return { valid: true };
}

export function getInitials(name?: string | null): string {
  if (!name) return "?";
  return name[0]?.toUpperCase() || "?";
}
