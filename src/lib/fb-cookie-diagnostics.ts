export type NormalizedCookie = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expirationDate?: number;
};

export type CookieParseResult = {
  ok: boolean;
  cookies: NormalizedCookie[];
  inputKind: "empty" | "json" | "netscape" | "header";
  debugCode: string;
  message: string;
};

export const CRITICAL_COOKIES = ["c_user", "xs", "fr", "datr"] as const;
export const RECOMMENDED_COOKIES = ["sb"] as const;
const REQUIRED_COOKIES = [...CRITICAL_COOKIES, ...RECOMMENDED_COOKIES] as const;

function coerceExpirationDateSeconds(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return raw > 10_000_000_000 ? Math.floor(raw / 1000) : raw;
  }
  if (typeof raw === "string" && raw.trim()) {
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric > 10_000_000_000 ? Math.floor(numeric / 1000) : numeric;
    }
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed / 1000);
  }
  return undefined;
}

function normalizeCookieObject(c: unknown): NormalizedCookie | null {
  if (!c || typeof c !== "object") return null;
  const obj = c as Record<string, unknown>;
  const name = obj.name ?? obj.Name ?? obj.key;
  const value = obj.value ?? obj.Value;
  if (typeof name !== "string" || typeof value !== "string") return null;
  const expirationDate = coerceExpirationDateSeconds(
    obj.expirationDate ?? obj.expires ?? obj.expiry ?? obj.expiresAt,
  );
  return {
    name,
    value,
    domain: typeof obj.domain === "string" ? obj.domain : undefined,
    path: typeof obj.path === "string" ? obj.path : undefined,
    expirationDate,
  };
}

export function parseCookiesInputDetailed(raw: string): CookieParseResult {
  const text = raw.trim();
  if (!text) {
    return {
      ok: false,
      cookies: [],
      inputKind: "empty",
      debugCode: "EMPTY_INPUT",
      message: "لم يتم إدخال أي كوكيز.",
    };
  }

  if (text.startsWith("[") || text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as unknown;
      const candidate = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && Array.isArray((parsed as { cookies?: unknown }).cookies)
          ? (parsed as { cookies: unknown[] }).cookies
          : null;
      if (!candidate) {
        return {
          ok: false,
          cookies: [],
          inputKind: "json",
          debugCode: "INVALID_JSON_SHAPE",
          message: "JSON صالح لكنه ليس بصيغة Cookie-Editor. استخدم Export as JSON من facebook.com.",
        };
      }
      const cookies = candidate.map(normalizeCookieObject).filter((c): c is NormalizedCookie => !!c);
      return cookies.length > 0
        ? {
            ok: true,
            cookies,
            inputKind: "json",
            debugCode: "JSON_PARSED",
            message: `تم تحليل JSON بنجاح. عدد الكوكيز المستلمة: ${cookies.length}.`,
          }
        : {
            ok: false,
            cookies: [],
            inputKind: "json",
            debugCode: "NO_COOKIE_OBJECTS",
            message: "JSON لا يحتوي على عناصر كوكيز صالحة بها name و value.",
          };
    } catch (e) {
      return {
        ok: false,
        cookies: [],
        inputKind: "json",
        debugCode: "INVALID_JSON",
        message: `JSON غير صالح: ${e instanceof Error ? e.message : "تعذّر التحليل"}.`,
      };
    }
  }

  if (text.includes("\t")) {
    const cookies: NormalizedCookie[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line || line.startsWith("#")) continue;
      const parts = line.split("\t");
      if (parts.length >= 7) {
        cookies.push({
          name: parts[5],
          value: parts[6],
          domain: parts[0],
          path: parts[2],
          expirationDate: coerceExpirationDateSeconds(parts[4]),
        });
      }
    }
    if (cookies.length > 0) {
      return {
        ok: true,
        cookies,
        inputKind: "netscape",
        debugCode: "NETSCAPE_PARSED",
        message: `تم تحليل cookies.txt بنجاح. عدد الكوكيز المستلمة: ${cookies.length}.`,
      };
    }
  }

  const cookies: NormalizedCookie[] = [];
  for (const pair of text.split(/;\s*|\n+/)) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name) cookies.push({ name, value });
  }
  return cookies.length > 0
    ? {
        ok: true,
        cookies,
        inputKind: "header",
        debugCode: "HEADER_PARSED",
        message: `تم تحليل نص الكوكيز بنجاح. عدد الكوكيز المستلمة: ${cookies.length}.`,
      }
    : {
        ok: false,
        cookies: [],
        inputKind: "header",
        debugCode: "NO_COOKIE_PAIRS",
        message: "لم نجد أزواج كوكيز بصيغة name=value.",
      };
}

export function parseCookiesInput(raw: string): NormalizedCookie[] | null {
  const parsed = parseCookiesInputDetailed(raw);
  return parsed.ok ? parsed.cookies : null;
}

export function normalizeStoredCookies(payload: unknown): NormalizedCookie[] {
  const candidate = Array.isArray(payload)
    ? payload
    : typeof payload === "string"
      ? payload
      : payload && typeof payload === "object"
        ? (payload as { cookies?: unknown }).cookies
        : null;

  if (Array.isArray(candidate)) {
    return candidate.map(normalizeCookieObject).filter((c): c is NormalizedCookie => !!c && c.name.length > 0);
  }

  if (typeof candidate === "string") return parseCookiesInput(candidate) ?? [];
  return [];
}

export function earliestRequiredExpiry(cookies: NormalizedCookie[]): number | null {
  const required = new Set<string>(REQUIRED_COOKIES as readonly string[]);
  let min: number | null = null;
  for (const c of cookies) {
    if (!required.has(c.name)) continue;
    if (typeof c.expirationDate !== "number") continue;
    if (min === null || c.expirationDate < min) min = c.expirationDate;
  }
  return min;
}

export function validateFacebookCookies(cookies: NormalizedCookie[]) {
  const byName = new Map(cookies.map((c) => [c.name, c.value]));
  const present: string[] = [];
  const missing: string[] = [];
  const invalid: { name: string; reason: string }[] = [];

  for (const name of REQUIRED_COOKIES) {
    const v = byName.get(name);
    if (!v || v.length === 0) {
      missing.push(name);
      continue;
    }
    present.push(name);
    if (name === "c_user" && !/^\d{6,}$/.test(v)) {
      invalid.push({ name, reason: "c_user يجب أن يحتوي على أرقام فقط (6 خانات أو أكثر)" });
    }
    if (name === "xs" && v.length < 10) {
      invalid.push({ name, reason: "xs قصير جدًا — صدِّر الكوكيز من جلسة نشطة" });
    }
  }

  const missingCritical = missing.filter((name) => (CRITICAL_COOKIES as readonly string[]).includes(name));
  const missingRecommended = missing.filter((name) => (RECOMMENDED_COOKIES as readonly string[]).includes(name));
  const minExp = earliestRequiredExpiry(cookies);
  const expired = minExp !== null && minExp * 1000 <= Date.now();
  if (expired) {
    invalid.push({ name: "expiry", reason: "انتهت صلاحية الجلسة — صدِّر كوكيز جديدة من Cookie-Editor" });
  }

  return {
    present,
    missing,
    missingCritical,
    missingRecommended,
    invalid,
    detectedUserId: byName.get("c_user") ?? null,
    expiresAt: minExp !== null ? new Date(minExp * 1000).toISOString() : null,
    expired,
  };
}

export function cookieValidationMessage(validation: ReturnType<typeof validateFacebookCookies>) {
  if (validation.missingCritical.length > 0) {
    return `لا توجد Session صالحة: كوكيز أساسية ناقصة (${validation.missingCritical.join(", ")}). افتح facebook.com وسجّل دخول ثم صدِّر JSON جديد.`;
  }
  if (validation.invalid.length > 0) {
    return `كوكيز غير صالحة: ${validation.invalid.map((i) => `${i.name}: ${i.reason}`).join("؛ ")}`;
  }
  return validation.detectedUserId
    ? `تم استخراج حساب فيسبوك من الكوكيز بنجاح. user_id=${validation.detectedUserId}`
    : "تم تحليل الكوكيز لكن لم نستخرج c_user.";
}