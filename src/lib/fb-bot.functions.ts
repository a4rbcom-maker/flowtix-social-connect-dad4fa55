// Server functions for the Facebook Bot management UI.
// All write paths are RLS-scoped to the calling user via requireSupabaseAuth.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { buildPostToGroupsPayload } from "@/lib/fb-job-payload";
// NOTE: `@/server/crypto.server` is intentionally NOT imported at the top.
// The TanStack Start server-fn transformer strips `.handler()` bodies from the
// client bundle but keeps top-level imports. Importing a `*.server.ts` module
// here makes the published client chunk fail to evaluate (Import Protection),
// which manifests as the global "Something went wrong" page on prod only.
// Each handler dynamically imports the crypto helpers when needed.

// ---------- Schemas ----------
const cookiesSchema = z.object({
  method: z.literal("cookies"),
  displayName: z.string().trim().min(1).max(80),
  cookies: z.string().trim().min(10).max(50_000), // raw JSON string from extension
});
const credentialsSchema = z.object({
  method: z.literal("credentials"),
  displayName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
  twoFactorSecret: z.string().trim().max(200).optional().nullable(),
});
const addAccountSchema = z.union([cookiesSchema, credentialsSchema]);

// Accepts: JSON array from extensions (EditThisCookie/Cookie-Editor), a single
// JSON object with a `cookies` array, header-style "name=value; name2=value2",
// or Netscape cookies.txt format. Returns a normalized array of cookie objects.
type NormalizedCookie = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expirationDate?: number;
};
function parseCookiesInput(raw: string): NormalizedCookie[] | null {
  const text = raw.trim();
  if (!text) return null;

  // 1) JSON
  if (text.startsWith("[") || text.startsWith("{")) {
    try {
      const j = JSON.parse(text);
      const arr = Array.isArray(j)
        ? j
        : Array.isArray((j as any)?.cookies)
          ? (j as any).cookies
          : null;
      if (arr) {
        const out: NormalizedCookie[] = [];
        for (const c of arr) {
          if (!c || typeof c !== "object") continue;
          const name = (c.name ?? c.Name ?? c.key) as string | undefined;
          const value = (c.value ?? c.Value) as string | undefined;
          if (typeof name === "string" && typeof value === "string") {
            const expRaw = (c as any).expirationDate ?? (c as any).expires ?? (c as any).expiry;
            const expirationDate =
              typeof expRaw === "number" && isFinite(expRaw) && expRaw > 0 ? expRaw : undefined;
            out.push({ name, value, domain: c.domain, path: c.path, expirationDate });
          }
        }
        if (out.length) return out;
      }
    } catch {
      // fall through
    }
  }

  // 2) Netscape cookies.txt (tab-separated, 7 fields)
  if (text.includes("\t")) {
    const out: NormalizedCookie[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line || line.startsWith("#")) continue;
      const parts = line.split("\t");
      if (parts.length >= 7) {
        const exp = Number(parts[4]);
        out.push({
          name: parts[5],
          value: parts[6],
          domain: parts[0],
          path: parts[2],
          expirationDate: isFinite(exp) && exp > 0 ? exp : undefined,
        });
      }
    }
    if (out.length) return out;
  }

  // 3) Header string: "name=value; name2=value2"
  const out: NormalizedCookie[] = [];
  for (const pair of text.split(/;\s*|\n+/)) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name) out.push({ name, value });
  }
  return out.length ? out : null;
}

function normalizeStoredCookies(payload: unknown): NormalizedCookie[] {
  const candidate = Array.isArray(payload)
    ? payload
    : typeof payload === "string"
      ? payload
      : payload && typeof payload === "object"
        ? (payload as { cookies?: unknown }).cookies
        : null;

  if (Array.isArray(candidate)) {
    return candidate
      .filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
      .map((c) => ({
        name: String(c.name ?? c.Name ?? c.key ?? ""),
        value: String(c.value ?? c.Value ?? ""),
        domain: typeof c.domain === "string" ? c.domain : undefined,
        path: typeof c.path === "string" ? c.path : undefined,
        expirationDate: typeof c.expirationDate === "number" ? c.expirationDate : undefined,
      }))
      .filter((c) => c.name.length > 0);
  }

  if (typeof candidate === "string") return parseCookiesInput(candidate) ?? [];
  return [];
}

// Cookies needed to treat a stored Facebook session as usable. `sb` helps
// Facebook recognize the browser but should not block progress by itself.
const CRITICAL_COOKIES = ["c_user", "xs", "fr", "datr"] as const;
const RECOMMENDED_COOKIES = ["sb"] as const;
const REQUIRED_COOKIES = [...CRITICAL_COOKIES, ...RECOMMENDED_COOKIES] as const;

// Soonest expiry (Unix seconds) among the REQUIRED cookies. Skips session
// cookies (no expirationDate). Returns null if none of the required cookies
// have an expiry, which is treated as "unknown".
function earliestRequiredExpiry(cookies: NormalizedCookie[]): number | null {
  const required = new Set<string>(REQUIRED_COOKIES as readonly string[]);
  let min: number | null = null;
  for (const c of cookies) {
    if (!required.has(c.name)) continue;
    if (typeof c.expirationDate !== "number") continue;
    if (min === null || c.expirationDate < min) min = c.expirationDate;
  }
  return min;
}

function validateFacebookCookies(cookies: NormalizedCookie[]) {
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

  const missingCritical = missing.filter((name) =>
    (CRITICAL_COOKIES as readonly string[]).includes(name),
  );
  const missingRecommended = missing.filter((name) =>
    (RECOMMENDED_COOKIES as readonly string[]).includes(name),
  );

  return { present, missing, missingCritical, missingRecommended, invalid };
}

// ---------- addBotAccount ----------
export const addBotAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => addAccountSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let payload: unknown;
    let cookieExpiresAt: string | null = null;
    if (data.method === "cookies") {
      const parsed = parseCookiesInput(data.cookies);
      if (!parsed || parsed.length === 0) {
        throw new Error(
          "تعذّر قراءة الكوكيز. الصق إما JSON المُصدَّر من إضافة المتصفح، أو سلسلة مثل name=value; name2=value2",
        );
      }
      payload = { cookies: parsed };
      const minExp = earliestRequiredExpiry(parsed);
      if (minExp !== null) cookieExpiresAt = new Date(minExp * 1000).toISOString();
    } else {
      payload = {
        email: data.email,
        password: data.password,
        twoFactorSecret: data.twoFactorSecret || null,
      };
    }
    const { encryptJson } = await import("@/server/crypto.server");
    const encrypted = encryptJson(payload);
    const { data: row, error } = await supabase
      .from("fb_bot_accounts")
      .insert({
        user_id: userId,
        display_name: data.displayName,
        auth_method: data.method,
        encrypted_payload: encrypted,
        status: "untested",
        cookie_expires_at: cookieExpiresAt,
      })
      .select(
        "id, display_name, auth_method, status, last_check_at, last_error, created_at, cookie_expires_at",
      )
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

type BotAccountRow = {
  id: string;
  display_name: string;
  auth_method: "cookies" | "credentials";
  status: "untested" | "active" | "invalid" | "checkpoint" | "disabled";
  last_check_at: string | null;
  last_error: string | null;
  created_at: string;
  cookie_expires_at: string | null;
};

export type BotAccountsListResult = {
  ok: boolean;
  accounts: BotAccountRow[];
  message: string;
  debugCode: string;
};

const BOT_ACCOUNT_SAFE_SELECT =
  "id, display_name, auth_method, status, last_check_at, last_error, created_at, cookie_expires_at";

// ---------- listBotAccounts ----------
export const listBotAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BotAccountsListResult> => {
    const { supabase, userId } = context;
    try {
      const { data, error } = await supabaseAdmin
        .from("fb_bot_accounts")
        .select(`${BOT_ACCOUNT_SAFE_SELECT}, encrypted_payload`)
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (error) {
        console.error("[listBotAccounts] db error", error);
        return {
          ok: false,
          accounts: [],
          message: "تعذّر تحميل حسابات البوت من قاعدة البيانات. أعد المحاولة.",
          debugCode: "DB_READ_FAILED",
        };
      }
      const accounts: BotAccountRow[] = [];
      for (const row of (data ?? []) as Array<BotAccountRow & { encrypted_payload?: string }>) {
        const safe: BotAccountRow = {
          id: row.id,
          display_name: row.display_name,
          auth_method: row.auth_method,
          status: row.status,
          last_check_at: row.last_check_at,
          last_error: row.last_error,
          created_at: row.created_at,
          cookie_expires_at: row.cookie_expires_at,
        };
        if (row.auth_method === "cookies" && row.status !== "active" && row.encrypted_payload) {
          try {
            const { decryptJson } = await import("@/server/crypto.server");
            const cookies = normalizeStoredCookies(decryptJson<unknown>(row.encrypted_payload));
            const { missingCritical, missingRecommended, invalid } = validateFacebookCookies(cookies);
            const minExp = earliestRequiredExpiry(cookies);
            const expiresAt = minExp !== null ? new Date(minExp * 1000).toISOString() : null;
            const expired = minExp !== null && minExp * 1000 <= Date.now();
            if (missingCritical.length === 0 && invalid.length === 0 && !expired) {
              const message = missingRecommended.length
                ? `الحساب جاهز. ينقص فقط كوكيز مستحسنة غير مانعة: ${missingRecommended.join(", ")}.`
                : null;
              safe.status = "active";
              safe.last_check_at = new Date().toISOString();
              safe.last_error = message;
              safe.cookie_expires_at = expiresAt;
              await supabase
                .from("fb_bot_accounts")
                .update({
                  status: "active",
                  last_check_at: safe.last_check_at,
                  last_error: message,
                  cookie_expires_at: expiresAt,
                })
                .eq("id", row.id)
                .eq("user_id", userId);
            }
          } catch (e) {
            console.warn("[listBotAccounts] auto validation skipped:", e);
          }
        }
        accounts.push(safe);
      }
      return {
        ok: true,
        accounts,
        message: accounts.length > 0 ? "تم تحميل الحسابات." : "لا توجد حسابات محفوظة لهذا المستخدم.",
        debugCode: accounts.length > 0 ? "OK" : "OK_EMPTY",
      };
    } catch (e) {
      console.error("[listBotAccounts] unexpected error", e);
      return {
        ok: false,
        accounts: [],
        message: "حدث خطأ غير متوقع أثناء تحميل الحسابات. حدّث الصفحة وأعد المحاولة.",
        debugCode: "LIST_EXCEPTION",
      };
    }
  });

// ---------- deleteBotAccount ----------
export const deleteBotAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("fb_bot_accounts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- createPostJob ----------
const postJobSchema = z.object({
  accountId: z.string().uuid(),
  content: z.string().trim().min(1).max(10_000),
  groupIds: z.array(z.string().trim().min(1).max(100)).min(1).max(500),
  intervalMinutes: z.number().int().min(1).max(1440).default(5),
  scheduledAt: z.string().datetime().optional().nullable(),
});
export const createPostJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => postJobSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("fb_jobs")
      .insert({
        user_id: userId,
        account_id: data.accountId,
        job_type: "post_to_groups",
        payload: buildPostToGroupsPayload({
          content: data.content,
          groupIds: data.groupIds,
          targetKind: "groups",
          mediaUrls: [],
          intervalMinutes: data.intervalMinutes,
        }),
        total_items: data.groupIds.length,
        scheduled_at: data.scheduledAt ?? new Date().toISOString(),
        status: "pending",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

// ---------- createExtractPagesJob ----------
export const createExtractPagesJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ accountId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("fb_jobs")
      .insert({
        user_id: userId,
        account_id: data.accountId,
        job_type: "extract_pages",
        payload: {},
        scheduled_at: new Date().toISOString(),
        status: "pending",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

// ---------- createExtractCommentersJob ----------
export const createExtractCommentersJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        accountId: z.string().uuid(),
        postUrl: z.string().trim().url().max(500),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("fb_jobs")
      .insert({
        user_id: userId,
        account_id: data.accountId,
        job_type: "extract_commenters",
        payload: { postUrl: data.postUrl },
        scheduled_at: new Date().toISOString(),
        status: "pending",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

// ---------- createExtractGroupMembersJob ----------
export const createExtractGroupMembersJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        accountId: z.string().uuid(),
        groupId: z.string().trim().min(3).max(64),
        maxMembers: z.number().int().min(50).max(5000).default(1500),
        filterKeywords: z.array(z.string().trim().min(1).max(40)).max(20).optional().default([]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Accept either raw ID or URL — extract the ID from URLs
    const idMatch = data.groupId.match(/groups\/([^/?]+)/);
    const groupId = idMatch ? idMatch[1] : data.groupId;
    const { data: row, error } = await supabase
      .from("fb_jobs")
      .insert({
        user_id: userId,
        account_id: data.accountId,
        job_type: "extract_group_members",
        payload: { groupId, maxMembers: data.maxMembers, filterKeywords: data.filterKeywords },
        scheduled_at: new Date().toISOString(),
        status: "pending",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

// ---------- createExtractPageAudienceJob ----------
export const createExtractPageAudienceJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        accountId: z.string().uuid(),
        pageId: z.string().trim().min(3).max(64),
        sources: z.array(z.enum(["followers", "likers", "engagers"])).min(1).default(["followers", "likers"]),
        maxItems: z.number().int().min(50).max(3000).default(1000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const idMatch = data.pageId.match(/facebook\.com\/([^/?]+)/);
    const pageId = idMatch ? idMatch[1] : data.pageId;
    const { data: row, error } = await supabase
      .from("fb_jobs")
      .insert({
        user_id: userId,
        account_id: data.accountId,
        job_type: "extract_page_audience",
        payload: { pageId, sources: data.sources, maxItems: data.maxItems },
        scheduled_at: new Date().toISOString(),
        status: "pending",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

// ---------- listJobs ----------
export const listJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("fb_jobs")
      .select(
        "id, job_type, status, progress, total_items, processed_items, created_at, completed_at, error_message, account_id",
      )
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// ---------- getJob (with results) ----------
export const getJob = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const [{ data: job, error: jobErr }, { data: results, error: resErr }] = await Promise.all([
      supabase.from("fb_jobs").select("*").eq("id", data.id).maybeSingle(),
      supabase
        .from("fb_job_results")
        .select("id, target, status, data, error, created_at")
        .eq("job_id", data.id)
        .order("created_at", { ascending: false })
        .limit(1000),
    ]);
    if (jobErr) throw new Error(jobErr.message);
    if (resErr) throw new Error(resErr.message);
    return { job, results: results ?? [] };
  });

// ---------- cancelJob ----------
export const cancelJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("fb_jobs")
      .update({ status: "cancelled", completed_at: new Date().toISOString() })
      .eq("id", data.id)
      .in("status", ["pending", "running"]);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- precheckBotAccount ----------
// Pre-flight check before running testBotAccount. Returns a STABLE DTO and
// NEVER throws on user-recoverable failures (missing account, bad payload,
// decryption error) — the UI relies on the `severity` field to render a
// clear Arabic message and decide whether the user can proceed to the test.
export type PrecheckResult = {
  ok: boolean;
  canContinue: boolean;
  severity: "ok" | "warning" | "error";
  method: "cookies" | "credentials" | "unknown";
  present: string[];
  missing: string[];
  invalid: { name: string; reason: string }[];
  totalCookies: number;
  expiresAt: string | null;
  expiresInDays: number | null;
  expired: boolean;
  message: string;
  debugCode: string;
};

function precheckFailure(
  debugCode: string,
  message: string,
  method: PrecheckResult["method"] = "unknown",
): PrecheckResult {
  return {
    ok: false,
    canContinue: false,
    severity: "error",
    method,
    present: [],
    missing: [],
    invalid: [],
    totalCookies: 0,
    expiresAt: null,
    expiresInDays: null,
    expired: false,
    message,
    debugCode,
  };
}

export const precheckBotAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<PrecheckResult> => {
    const { supabase, userId } = context;

    // 1) Read the account row. Never throw — translate to Arabic message.
    let acc: { id: string; auth_method: string; encrypted_payload: string } | null = null;
    try {
      const { data: row, error } = await supabaseAdmin
        .from("fb_bot_accounts")
        .select("id, auth_method, encrypted_payload")
        .eq("id", data.id)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) {
        console.error("[precheckBotAccount] db error:", error);
        return precheckFailure(
          "DB_READ_FAILED",
          "تعذّر قراءة بيانات الحساب من قاعدة البيانات. حدِّث الصفحة وأعد المحاولة.",
        );
      }
      if (!row) {
        return precheckFailure(
          "ACCOUNT_NOT_FOUND",
          "هذا الحساب لم يعد موجودًا. حدِّث الصفحة ثم أعد إضافته إن لزم.",
        );
      }
      acc = row as { id: string; auth_method: string; encrypted_payload: string };
    } catch (e) {
      console.error("[precheckBotAccount] db threw:", e);
      return precheckFailure(
        "DB_EXCEPTION",
        "حدث خطأ غير متوقع أثناء قراءة الحساب. أعد المحاولة بعد لحظات.",
      );
    }

    // 2) Credentials accounts: cookies precheck doesn't apply.
    if (acc.auth_method !== "cookies") {
      return {
        ok: false,
        canContinue: true,
        severity: "warning",
        method: "credentials",
        present: [],
        missing: [],
        invalid: [],
        totalCookies: 0,
        expiresAt: null,
        expiresInDays: null,
        expired: false,
        message:
          "هذا الحساب مُسجَّل بالبريد/كلمة السر — لا يمكن فحص الكوكيز. اضغط متابعة الاختبار.",
        debugCode: "CREDENTIALS_ACCOUNT",
      };
    }

    // 3) Decrypt + parse the stored payload. Never let errors escape.
    let cookies: NormalizedCookie[] = [];
    try {
      const { decryptJson } = await import("@/server/crypto.server");
      const payload = decryptJson<unknown>(acc.encrypted_payload);
      cookies = normalizeStoredCookies(payload);
    } catch (e) {
      console.error("[precheckBotAccount] decrypt failed:", e);
      return precheckFailure(
        "DECRYPT_FAILED",
        "تعذّر فك تشفير الكوكيز المحفوظة. احذف الحساب وأعد إضافته بكوكيز جديدة.",
        "cookies",
      );
    }

    if (cookies.length === 0) {
      return precheckFailure(
        "EMPTY_COOKIES",
        "لا توجد كوكيز محفوظة لهذا الحساب. احذف الحساب وأعد إضافته بكوكيز جديدة من Cookie-Editor.",
        "cookies",
      );
    }

    const { present, missing, missingCritical, missingRecommended, invalid } =
      validateFacebookCookies(cookies);

    // 4) Expiry calculation + DB backfill (failure here is non-fatal).
    const minExp = earliestRequiredExpiry(cookies);
    const expiresAt = minExp !== null ? new Date(minExp * 1000).toISOString() : null;
    if (expiresAt) {
      try {
        await supabase
          .from("fb_bot_accounts")
          .update({ cookie_expires_at: expiresAt })
          .eq("id", data.id);
      } catch (e) {
        console.warn("[precheckBotAccount] expiry backfill failed (ignored):", e);
      }
    }
    const now = Date.now();
    const expiresInDays = minExp !== null ? Math.floor((minExp * 1000 - now) / 86_400_000) : null;
    const expired = minExp !== null && minExp * 1000 <= now;
    if (expired) {
      invalid.push({
        name: "expiry",
        reason: "انتهت صلاحية الجلسة — صدِّر كوكيز جديدة من Cookie-Editor",
      });
    }

    const hasBlockingFailure = missingCritical.length > 0 || invalid.length > 0 || expired;
    const ok = !hasBlockingFailure;
    const expiringSoon = ok && expiresInDays !== null && expiresInDays <= 7;
    const hasWarning = missingRecommended.length > 0 || expiringSoon;
    const severity: PrecheckResult["severity"] = ok
      ? hasWarning
        ? "warning"
        : "ok"
      : "error";

    const message = ok
      ? missingRecommended.length > 0
        ? `الكوكيز الأساسية سليمة. الكوكيز المستحسنة الناقصة: ${missingRecommended.join(", ")} — يمكن المتابعة الآن.`
        : expiringSoon
          ? `الكوكيز سليمة، لكن الجلسة تنتهي خلال ${expiresInDays} يوم — جدِّدها قريبًا.`
          : "الكوكيز الأساسية سليمة والحساب جاهز لإنشاء المهام."
      : expired
        ? "انتهت صلاحية جلسة فيسبوك — أعد تصدير الكوكيز من Cookie-Editor."
        : missingCritical.length > 0
          ? `كوكيز أساسية ناقصة: ${missingCritical.join(", ")} — أعد تصدير الكوكيز من Cookie-Editor.`
          : `كوكيز فيها مشاكل في الصيغة: ${invalid.map((i) => i.name).join(", ")}`;

    if (ok) {
      try {
        await supabase
          .from("fb_bot_accounts")
          .update({
            status: "active",
            last_check_at: new Date().toISOString(),
            last_error: hasWarning ? message : null,
            cookie_expires_at: expiresAt,
          })
          .eq("id", data.id)
          .eq("user_id", userId);
      } catch (e) {
        console.warn("[precheckBotAccount] active status update failed (ignored):", e);
      }
    }

    return {
      ok,
      canContinue: ok,
      severity,
      method: "cookies",
      present,
      missing,
      invalid,
      totalCookies: cookies.length,
      expiresAt,
      expiresInDays,
      expired,
      message,
      debugCode: ok
        ? missingRecommended.length > 0
          ? "OK_MISSING_RECOMMENDED"
          : expiringSoon
            ? "OK_EXPIRING_SOON"
            : "OK_READY"
        : "VALIDATION_FAILED",
    };
  });

// ---------- testBotAccount ----------
// IMPORTANT: Facebook blocks server-to-server requests coming from datacenter
// IPs (Cloudflare Workers, AWS, GCP, ...) and returns the login page even for
// 100% valid cookies. Hitting m.facebook.com/me from the Worker is therefore
// unreliable in production. We instead perform a STRUCTURAL validation of the
// stored cookies and defer real liveness checks to the VPS Worker (Phase 4),
// which runs from a residential IP with a real browser.
export const testBotAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: acc, error } = await supabaseAdmin
      .from("fb_bot_accounts")
      .select("id, auth_method, encrypted_payload")
      .eq("id", data.id)
      .eq("user_id", userId)
      .single();
    if (error || !acc) throw new Error(error?.message ?? "Account not found");

    let status: "active" | "invalid" | "checkpoint" = "invalid";
    let lastError: string | null = null;

    try {
      if (acc.auth_method === "cookies") {
        const { decryptJson } = await import("@/server/crypto.server");
        const payload = decryptJson<unknown>(acc.encrypted_payload);
        const cookies = normalizeStoredCookies(payload);
        const { missingCritical, missingRecommended, invalid } = validateFacebookCookies(cookies);

        if (missingCritical.length > 0) {
          status = "invalid";
          lastError = `كوكيز أساسية ناقصة: ${missingCritical.join(", ")} — صدِّر من جديد عبر Cookie-Editor`;
        } else if (invalid.length > 0) {
          status = "invalid";
          lastError = `كوكيز فيها مشاكل: ${invalid.map((i) => `${i.name}: ${i.reason}`).join("؛ ")}`;
        } else {
          // Structurally valid. Mark as pending real verification by VPS Worker.
          status = "active";
          // IMPORTANT: keep this message free of any word that could be mistaken
          // for a Facebook checkpoint signal (e.g. "التحقق", "verification").
          // It is stored in last_error and the UI scans last_error for
          // checkpoint hints — false positives there used to flip the row to
          // a misleading "Complete verification" state.
          lastError = missingRecommended.length
            ? `الحساب جاهز للاستخدام. كوكيز مستحسنة ناقصة (غير مانعة): ${missingRecommended.join(", ")}.`
            : null;
        }
      } else {
        lastError = "حسابات البريد/كلمة السر تُختبر عبر VPS Worker فقط";
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }

    const { data: updated, error: upErr } = await supabase
      .from("fb_bot_accounts")
      .update({
        status,
        last_check_at: new Date().toISOString(),
        last_error: lastError,
      })
      .eq("id", data.id)
      .select(BOT_ACCOUNT_SAFE_SELECT)
      .single();
    if (upErr) throw new Error(upErr.message);
    return { ...updated, groups: [] as { id: string; name: string }[] };
  });
