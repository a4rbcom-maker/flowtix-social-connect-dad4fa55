export const FB_COOKIE_ESSENTIAL_KEYS = ["c_user", "xs", "datr"] as const;

export const FB_COOKIE_ALL_KEYS = [
  "c_user", "xs", "fr", "datr", "sb", "presence",
] as const;

export type CookieFormat = "json" | "netscape" | "header" | "line-per-cookie" | "unknown";

export interface CookieParseResult {
  cookies: Record<string, string>;
  format: CookieFormat;
  count: number;
  foundEssential: string[];
  missingEssential: string[];
}

export function parseCookieString(raw: string): Record<string, string> {
  return parseCookieStringDetailed(raw).cookies;
}

export function parseCookieStringDetailed(raw: string): CookieParseResult {
  const cookies: Record<string, string> = {};
  const trimmedRaw = raw.trim();
  if (!trimmedRaw) return { cookies, format: "unknown", count: 0, foundEssential: [], missingEssential: [...FB_COOKIE_ESSENTIAL_KEYS] };

  if (trimmedRaw.startsWith("[") || trimmedRaw.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmedRaw);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of arr) {
        if (item && typeof item === "object") {
          const name = item.name ?? item.key ?? item.Name;
          const value = item.value ?? item.Value;
          if (name && value) cookies[String(name)] = String(value);
        }
      }
      if (Object.keys(cookies).length > 0) {
        return buildResult(cookies, "json");
      }
    } catch {
      // not valid JSON, fall through
    }
  }

  if (trimmedRaw.includes("\t")) {
    for (const line of trimmedRaw.split("\n")) {
      const parts = line.trim().split("\t");
      if (parts.length >= 7) {
        const name = parts[5]?.trim();
        const value = parts[6]?.trim();
        if (name && value) cookies[name] = value;
      }
    }
    if (Object.keys(cookies).length > 0) {
      return buildResult(cookies, "netscape");
    }
  }

  for (const segment of trimmedRaw.split(";")) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.substring(0, eqIdx).trim();
    const val = trimmed.substring(eqIdx + 1).trim();
    if (key) cookies[key] = val;
  }

  if (Object.keys(cookies).length > 0) {
    return buildResult(cookies, "header");
  }

  for (const line of trimmedRaw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes("=")) continue;
    const eqIdx = trimmed.indexOf("=");
    const key = trimmed.substring(0, eqIdx).trim();
    const val = trimmed.substring(eqIdx + 1).trim();
    if (key) cookies[key] = val;
  }

  if (Object.keys(cookies).length > 0) {
    return buildResult(cookies, "line-per-cookie");
  }

  return { cookies, format: "unknown", count: 0, foundEssential: [], missingEssential: [...FB_COOKIE_ESSENTIAL_KEYS] };
}

function buildResult(cookies: Record<string, string>, format: CookieFormat): CookieParseResult {
  const count = Object.keys(cookies).length;
  const foundEssential = [...FB_COOKIE_ESSENTIAL_KEYS].filter((k) => cookies[k]);
  const missingEssential = [...FB_COOKIE_ESSENTIAL_KEYS].filter((k) => !cookies[k]);
  return { cookies, format, count, foundEssential, missingEssential };
}

export function validateFbCookies(raw: string): boolean {
  const parsed = parseCookieStringDetailed(raw);
  return parsed.missingEssential.length === 0;
}

export interface CookieValidationResult {
  valid: boolean;
  found: string[];
  missing: string[];
}

export function validateFbCookiesDetailed(raw: string): CookieValidationResult {
  const parsed = parseCookieStringDetailed(raw);
  const found = [...FB_COOKIE_ALL_KEYS].filter((k) => parsed.cookies[k]);
  const missing = [...FB_COOKIE_ALL_KEYS].filter((k) => !parsed.cookies[k]);
  return { valid: parsed.missingEssential.length === 0, found, missing };
}
