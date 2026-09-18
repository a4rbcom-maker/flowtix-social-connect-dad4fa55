export const FB_COOKIE_ESSENTIAL_KEYS = ["c_user", "xs", "datr"] as const;

export const FB_COOKIE_ALL_KEYS = [
  "c_user", "xs", "fr", "datr", "sb", "presence",
] as const;

export const IG_COOKIE_ESSENTIAL_KEYS = ["sessionid", "ds_user_id", "csrftoken"] as const;

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

/**
 * Session-strength report for an import.
 *
 * A Facebook cookie paste can be structurally "valid" (c_user + xs + datr all
 * present, JSON format detected) and still be a token that Facebook revokes
 * within a couple of hours. The two failure modes we can detect locally, with
 * no network call to Facebook at all (so we never touch the user's live token),
 * are:
 *
 *  1. MISSING AUTH-SUSTAINING COOKIES — `sb` and `fr` are part of the same
 *     signed cookie family as `xs`. Without them Facebook's edge treats the
 *     token as an unattached session and expires it early.
 *  2. A CRIPPLED TOKEN — Cookie-Editor's menu has both "Export" and "Copy",
 *     plus users sometimes copy a single cookie's value from the table. Those
 *     paths produce a `c_user` that is not a plain numeric Facebook user id,
 *     or an `xs` shorter than a real session token. Replaying those can never
 *     survive; they also get flagged as theft when first used from an IP other
 *     than the exporter's.
 *
 * Both checks are pure string analysis — no Facebook request is made, so this
 * is safe to run at import time on a freshly exported live session.
 */
export interface FbCookieStrength {
  ok: boolean;
  score: number; // 0..100
  missingRecommended: string[];
  problems: string[];
}

export function assessFbCookieStrength(cookies: Record<string, string>): FbCookieStrength {
  const missingRecommended = [...FB_COOKIE_ALL_KEYS].filter((k) => !cookies[k]);
  const problems: string[] = [];

  const cUser = cookies["c_user"];
  if (cUser && !/^\d{5,20}$/.test(cUser)) {
    problems.push("c_user_not_numeric");
  }

  const xs = cookies["xs"];
  if (xs && xs.length < 20) {
    problems.push("xs_too_short");
  }
  if (xs && !xs.includes("%3A") && !xs.includes(":")) {
    problems.push("xs_malformed");
  }

  const datr = cookies["datr"];
  if (datr && datr.length < 10) {
    problems.push("datr_too_short");
  }

  if (!cookies["sb"]) problems.push("sb_absent");
  if (!cookies["fr"]) problems.push("fr_absent");

  const count = Object.keys(cookies).length;
  if (count < 8) problems.push("too_few_cookies");

  let score = 100;
  score -= problems.length * 15;
  score -= missingRecommended.length * 5;
  if (score < 0) score = 0;

  return {
    ok: problems.filter((p) => p !== "sb_absent" && p !== "fr_absent").length === 0,
    score,
    missingRecommended,
    problems,
  };
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

export function parseIgCookieStringDetailed(raw: string): CookieParseResult {
  const cookies: Record<string, string> = {};
  const trimmedRaw = raw.trim();
  if (!trimmedRaw) return { cookies, format: "unknown", count: 0, foundEssential: [], missingEssential: [...IG_COOKIE_ESSENTIAL_KEYS] };

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
      if (Object.keys(cookies).length > 0) return buildIgResult(cookies, "json");
    } catch { /* fall through */ }
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
    if (Object.keys(cookies).length > 0) return buildIgResult(cookies, "netscape");
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

  if (Object.keys(cookies).length > 0) return buildIgResult(cookies, "header");

  for (const line of trimmedRaw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes("=")) continue;
    const eqIdx = trimmed.indexOf("=");
    const key = trimmed.substring(0, eqIdx).trim();
    const val = trimmed.substring(eqIdx + 1).trim();
    if (key) cookies[key] = val;
  }

  if (Object.keys(cookies).length > 0) return buildIgResult(cookies, "line-per-cookie");

  return { cookies, format: "unknown", count: 0, foundEssential: [], missingEssential: [...IG_COOKIE_ESSENTIAL_KEYS] };
}

function buildIgResult(cookies: Record<string, string>, format: CookieFormat): CookieParseResult {
  const count = Object.keys(cookies).length;
  const foundEssential = [...IG_COOKIE_ESSENTIAL_KEYS].filter((k) => cookies[k]);
  const missingEssential = [...IG_COOKIE_ESSENTIAL_KEYS].filter((k) => !cookies[k]);
  return { cookies, format, count, foundEssential, missingEssential };
}

export function validateIgCookies(raw: string): boolean {
  const parsed = parseIgCookieStringDetailed(raw);
  return parsed.missingEssential.length === 0;
}

export function validateIgCookiesDetailed(raw: string): CookieValidationResult {
  const parsed = parseIgCookieStringDetailed(raw);
  const found = [...IG_COOKIE_ESSENTIAL_KEYS].filter((k) => parsed.cookies[k]);
  const missing = [...IG_COOKIE_ESSENTIAL_KEYS].filter((k) => !parsed.cookies[k]);
  return { valid: found.length === IG_COOKIE_ESSENTIAL_KEYS.length, found, missing };
}

export function validateFbCookiesDetailed(raw: string): CookieValidationResult {
  const parsed = parseCookieStringDetailed(raw);
  const found = [...FB_COOKIE_ALL_KEYS].filter((k) => parsed.cookies[k]);
  const missing = [...FB_COOKIE_ALL_KEYS].filter((k) => !parsed.cookies[k]);
  return { valid: parsed.missingEssential.length === 0, found, missing };
}
