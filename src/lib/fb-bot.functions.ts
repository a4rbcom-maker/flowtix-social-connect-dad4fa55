// Server functions for the Facebook Bot management UI.
// All write paths are RLS-scoped to the calling user via requireSupabaseAuth.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildPostToGroupsPayload } from "@/lib/fb-job-payload";
import {
  cookieValidationMessage,
  earliestRequiredExpiry,
  normalizeStoredCookies,
  parseCookiesInputDetailed,
  validateFacebookCookies,
  type NormalizedCookie,
} from "@/lib/fb-cookie-diagnostics";
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
  cookies: z.string().trim().min(10).max(1_000_000), // raw JSON/Header/Netscape export from Cookie-Editor
});
const credentialsSchema = z.object({
  method: z.literal("credentials"),
  displayName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
  twoFactorSecret: z.string().trim().max(200).optional().nullable(),
});
const addAccountSchema = z.union([cookiesSchema, credentialsSchema]);
type AddAccountInput = z.infer<typeof addAccountSchema>;

// Cookie parsing/validation lives in fb-cookie-diagnostics so the UI and tests
// use the same rules as the server save path.

type AddBotAccountDiagnostic = {
  phase: "input" | "frontend" | "parse" | "validate" | "extract" | "encrypt" | "associate" | "database" | "done";
  ok: boolean;
  debugCode: string;
  message: string;
  step?: string;
  totalCookies?: number;
  receivedBytes?: number;
  detectedUserId?: string | null;
  accountName?: string | null;
  errorDetails?: string | null;
  sqlError?: string | null;
  httpStatus?: number | null;
  responseBody?: string | null;
  stackTrace?: string | null;
};

type AddBotAccountResult = {
  ok: boolean;
  account: BotAccountRow | null;
  message: string;
  debugCode: string;
  diagnostics: AddBotAccountDiagnostic[];
};

function addDiag(
  diagnostics: AddBotAccountDiagnostic[],
  entry: AddBotAccountDiagnostic,
) {
  diagnostics.push(entry);
  const tag = `[addBotAccount:${entry.debugCode}] ${entry.phase}`;
  if (entry.ok) console.info(tag, entry.message, entry);
  else console.warn(tag, entry.message, entry);
}

function zodIssueMessage(issue: z.ZodIssue) {
  const path = issue.path.length > 0 ? issue.path.join(".") : "input";
  if (issue.code === "too_big" && path === "cookies") {
    return "ملف الكوكيز كبير جدًا. الحد الحالي 1MB؛ صدّر كوكيز facebook.com فقط بصيغة JSON أو Header.";
  }
  if (issue.code === "too_small" && path === "cookies") return "حقل الكوكيز قصير جدًا أو فارغ.";
  if (issue.code === "too_small" && path === "displayName") return "اسم الحساب مطلوب.";
  if (issue.code === "invalid_union") return "نوع الربط غير معروف. استخدم Cookies أو Email/Password.";
  return `${path}: ${issue.message}`;
}

function safeStringify(value: unknown, max = 4000) {
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    return text.length > max ? `${text.slice(0, max)}…[truncated]` : text;
  } catch {
    const text = String(value);
    return text.length > max ? `${text.slice(0, max)}…[truncated]` : text;
  }
}

function errorMessage(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}

// ---------- addBotAccount ----------
export const addBotAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown): AddAccountInput => {
    const parsed = addAccountSchema.safeParse(d);
    if (!parsed.success) {
      const message = parsed.error.issues.map(zodIssueMessage).join("؛ ");
      console.warn("[addBotAccount:INPUT_VALIDATION_FAILED] input", {
        message,
        issues: parsed.error.issues,
        method: typeof d === "object" && d !== null ? (d as { method?: unknown }).method : null,
        cookieBytes:
          typeof d === "object" && d !== null && typeof (d as { cookies?: unknown }).cookies === "string"
            ? (d as { cookies: string }).cookies.length
            : null,
      });
      throw new Error(`فشل قبول بيانات ربط فيسبوك قبل الحفظ: ${message}`);
    }
    return parsed.data;
  })
  .handler(async ({ data, context }): Promise<AddBotAccountResult> => {
    const { supabase, userId } = context;
    const diagnostics: AddBotAccountDiagnostic[] = [];
    let payload: unknown;
    let cookieExpiresAt: string | null = null;
    if (data.method === "cookies") {
      addDiag(diagnostics, {
        phase: "input",
        ok: true,
        debugCode: "INPUT_RECEIVED",
        step: "receive_request",
        message: "تم استلام بيانات الكوكيز داخل الخادم وبدأ الفحص.",
        receivedBytes: data.cookies.length,
      });
      addDiag(diagnostics, {
        phase: "associate",
        ok: true,
        debugCode: "USER_ASSOCIATED",
        step: "link_to_current_user",
        message: `سيتم ربط الحساب بالمستخدم الحالي user_id=${userId}.`,
      });
      const parsed = parseCookiesInputDetailed(data.cookies);
      addDiag(diagnostics, {
        phase: "parse",
        ok: parsed.ok,
        debugCode: parsed.debugCode,
        step: "parse_cookie_payload",
        message: parsed.message,
        totalCookies: parsed.cookies.length,
      });
      if (!parsed.ok) {
        return { ok: false, account: null, message: parsed.message, debugCode: parsed.debugCode, diagnostics };
      }

      const validation = validateFacebookCookies(parsed.cookies);
      const validationOk = validation.missingCritical.length === 0 && validation.invalid.length === 0;
      addDiag(diagnostics, {
        phase: "validate",
        ok: validationOk,
        debugCode: validationOk ? "COOKIE_SESSION_VALID" : "COOKIE_SESSION_INVALID",
        step: "verify_required_cookies",
        message: cookieValidationMessage(validation),
        totalCookies: parsed.cookies.length,
        detectedUserId: validation.detectedUserId,
        accountName: validation.detectedUserId ? `Facebook user ${validation.detectedUserId}` : null,
      });
      if (!validationOk) {
        return {
          ok: false,
          account: null,
          message: cookieValidationMessage(validation),
          debugCode: validation.expired ? "COOKIES_EXPIRED" : "COOKIE_SESSION_INVALID",
          diagnostics,
        };
      }

      payload = { cookies: parsed.cookies, detectedUserId: validation.detectedUserId };
      addDiag(diagnostics, {
        phase: "extract",
        ok: true,
        debugCode: "ACCOUNT_DATA_EXTRACTED",
        step: "extract_account_identity",
        message: `تم استخراج بيانات الحساب المطلوبة للحفظ بدون كشف الكوكيز: c_user=${validation.detectedUserId ?? "غير موجود"}.`,
        detectedUserId: validation.detectedUserId,
        accountName: validation.detectedUserId ? `Facebook user ${validation.detectedUserId}` : null,
      });
      const minExp = earliestRequiredExpiry(parsed.cookies);
      if (minExp !== null) cookieExpiresAt = new Date(minExp * 1000).toISOString();
    } else {
      addDiag(diagnostics, {
        phase: "input",
        ok: true,
        debugCode: "INPUT_RECEIVED",
        step: "receive_request",
        message: "تم استلام بيانات البريد وكلمة المرور داخل الخادم وبدأ التجهيز.",
      });
      addDiag(diagnostics, {
        phase: "associate",
        ok: true,
        debugCode: "USER_ASSOCIATED",
        step: "link_to_current_user",
        message: `سيتم ربط الحساب بالمستخدم الحالي user_id=${userId}.`,
      });
      payload = {
        email: data.email,
        password: data.password,
        twoFactorSecret: data.twoFactorSecret || null,
      };
      addDiag(diagnostics, {
        phase: "extract",
        ok: true,
        debugCode: "ACCOUNT_DATA_EXTRACTED",
        step: "prepare_credentials_payload",
        message: "تم تجهيز بيانات الدخول للحفظ بدون كشف كلمة المرور.",
        accountName: data.email,
      });
    }
    let encrypted: string;
    try {
      const { encryptJson } = await import("@/server/crypto.server");
      encrypted = encryptJson(payload);
      addDiag(diagnostics, {
        phase: "encrypt",
        ok: true,
        debugCode: "PAYLOAD_ENCRYPTED",
        step: "encrypt_payload",
        message: "تم تجهيز بيانات الحساب للحفظ بأمان.",
      });
    } catch (e) {
      const message = errorMessage(e);
      addDiag(diagnostics, {
        phase: "encrypt",
        ok: false,
        debugCode: "ENCRYPT_FAILED",
        step: "encrypt_payload",
        message: `فشل تجهيز بيانات الحساب للحفظ: ${message}`,
        errorDetails: message,
        stackTrace: e instanceof Error ? e.stack ?? null : null,
      });
      return { ok: false, account: null, message: "فشل تجهيز بيانات الحساب للحفظ.", debugCode: "ENCRYPT_FAILED", diagnostics };
    }
    let row: BotAccountRow | null = null;
    let error: { message: string; code?: string; details?: string | null; hint?: string | null } | null = null;
    try {
      addDiag(diagnostics, {
        phase: "database",
        ok: true,
        debugCode: "DB_INSERT_START",
        step: "create_account_record",
        message: "بدأ إنشاء سجل الحساب في قاعدة البيانات.",
      });
      const result = await supabase
        .from("fb_bot_accounts")
        .insert({
          user_id: userId,
          display_name: data.displayName,
          auth_method: data.method,
          encrypted_payload: encrypted,
          // Cookies passing structural validation are considered active immediately.
          // Real liveness check runs later via the VPS Worker on a residential IP.
          status: data.method === "cookies" ? "active" : "untested",
          last_check_at: data.method === "cookies" ? new Date().toISOString() : null,
          cookie_expires_at: cookieExpiresAt,
        })
        .select(
          "id, display_name, auth_method, status, last_check_at, last_error, created_at, cookie_expires_at",
        )
        .single();
      row = result.data as BotAccountRow | null;
      error = result.error;
    } catch (e) {
      const message = errorMessage(e);
      addDiag(diagnostics, {
        phase: "database",
        ok: false,
        debugCode: "DB_EXCEPTION",
        step: "save_to_database",
        message: `حدث Exception أثناء حفظ الحساب في قاعدة البيانات: ${message}`,
        errorDetails: message,
        responseBody: safeStringify(e),
        stackTrace: e instanceof Error ? e.stack ?? null : null,
      });
      console.error("[addBotAccount:DB_EXCEPTION]", { message, stack: e instanceof Error ? e.stack : null, raw: e });
      return { ok: false, account: null, message: `حدث Exception أثناء حفظ الحساب في قاعدة البيانات: ${message}`, debugCode: "DB_EXCEPTION", diagnostics };
    }
    if (error) {
      const details = [error.code ? `code=${error.code}` : null, error.details, error.hint ? `hint=${error.hint}` : null]
        .filter(Boolean)
        .join(" | ");
      const rawError = error as typeof error & { status?: number; statusCode?: number };
      addDiag(diagnostics, {
        phase: "database",
        ok: false,
        debugCode: "DB_SAVE_FAILED",
        step: "save_to_database",
        message: `فشل حفظ الحساب في قاعدة البيانات: ${error.message}${details ? ` — ${details}` : ""}`,
        errorDetails: details || null,
        sqlError: [error.code, error.details, error.hint].filter(Boolean).join(" | ") || error.message,
        httpStatus: rawError.status ?? rawError.statusCode ?? null,
        responseBody: safeStringify(error),
      });
      console.error("[addBotAccount:DB_SAVE_FAILED]", { message: error.message, code: error.code, details: error.details, hint: error.hint, status: rawError.status ?? rawError.statusCode ?? null, responseBody: error });
      return { ok: false, account: null, message: `فشل حفظ الحساب في قاعدة البيانات: ${error.message}${details ? ` — ${details}` : ""}`, debugCode: "DB_SAVE_FAILED", diagnostics };
    }
    if (!row?.id) {
      addDiag(diagnostics, {
        phase: "database",
        ok: false,
        debugCode: "DB_EMPTY_RETURN",
        step: "read_created_record",
        message: "تم تنفيذ طلب الحفظ لكن قاعدة البيانات لم تُرجع صف الحساب.",
      });
      return { ok: false, account: null, message: "تم تنفيذ طلب الحفظ لكن قاعدة البيانات لم تُرجع صف الحساب.", debugCode: "DB_EMPTY_RETURN", diagnostics };
    }
    addDiag(diagnostics, {
      phase: "database",
      ok: true,
      debugCode: "DB_INSERT_OK",
      step: "save_to_database",
      message: `تم إنشاء سجل الحساب وربطه بالمستخدم الحالي. record_id=${row.id}.`,
      accountName: row.display_name,
    });
    addDiag(diagnostics, {
      phase: "done",
      ok: true,
      debugCode: "ACCOUNT_SAVED",
      step: "complete_save_flow",
      message: `تم حفظ الحساب بنجاح: ${row.display_name}.`,
      accountName: row.display_name,
    });
    return { ok: true, account: row, message: "تم حفظ الحساب بنجاح.", debugCode: "ACCOUNT_SAVED", diagnostics };
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
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
        groupId: z.string().trim().min(3).max(512),
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

// ---------- createListMyGroupsJob ----------
// Asks the VPS Worker to open the joined-groups tab in a real browser on a
// residential IP and scrape the list of groups the account belongs to.
export const createListMyGroupsJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        accountId: z.string().uuid(),
        max: z.number().int().min(20).max(2000).default(500),
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
        job_type: "list_my_groups",
        payload: { max: data.max },
        scheduled_at: new Date().toISOString(),
        status: "pending",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

// ---------- createDeepProfileScrapeJob ----------
// Visits each Facebook profile URL and scrapes public Bio / intro / declared city / work.
export const createDeepProfileScrapeJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        accountId: z.string().uuid(),
        profiles: z.array(z.string().trim().min(1)).min(1).max(2000),
        label: z.string().trim().max(120).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const profiles = Array.from(
      new Set(
        data.profiles
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p) => p.replace(/\?.*$/, "").replace(/\/$/, "")),
      ),
    );
    const { data: row, error } = await supabase
      .from("fb_jobs")
      .insert({
        user_id: userId,
        account_id: data.accountId,
        job_type: "deep_profile_scrape",
        payload: { profiles, label: data.label ?? null },
        total_items: profiles.length,
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
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
