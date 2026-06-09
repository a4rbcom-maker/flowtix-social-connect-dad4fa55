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

export function phoneFromRaw(raw: unknown): string | null {
  const obj = asRecord(raw);
  return digits(pickString(obj, "normalizedContactPhone", "senderPn", "participantPn", "phoneNumber", "phone"));
}

export function profilePicFromRaw(raw: unknown): string | null {
  const obj = asRecord(raw);
  return pickString(obj, "profilePicUrl", "groupProfilePicUrl", "avatarUrl", "picture", "photoUrl");
}
