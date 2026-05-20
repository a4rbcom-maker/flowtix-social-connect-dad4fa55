// Facebook Graph API server functions
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GRAPH_API = "https://graph.facebook.com/v21.0";

/**
 * Map a Facebook Graph API error to a stable, user-friendly shape.
 * Codes ref: https://developers.facebook.com/docs/graph-api/guides/error-handling/
 */
export class FacebookApiError extends Error {
  code: number | null;
  subcode: number | null;
  type:
    | "auth_expired"
    | "permission_denied"
    | "app_rate_limited"
    | "rate_limited"
    | "not_found"
    | "invalid_token"
    | "network"
    | "unknown";
  missingPermission: string | null;
  httpStatus: number;
  raw: unknown;
  constructor(opts: {
    message: string;
    code: number | null;
    subcode: number | null;
    type: FacebookApiError["type"];
    missingPermission: string | null;
    httpStatus: number;
    raw?: unknown;
  }) {
    super(opts.message);
    this.name = "FacebookApiError";
    this.code = opts.code;
    this.subcode = opts.subcode;
    this.type = opts.type;
    this.missingPermission = opts.missingPermission;
    this.httpStatus = opts.httpStatus;
    this.raw = opts.raw;
  }
  toJSON() {
    return {
      message: this.message,
      code: this.code,
      subcode: this.subcode,
      type: this.type,
      missingPermission: this.missingPermission,
      httpStatus: this.httpStatus,
    };
  }
}

function classifyFbError(
  status: number,
  errBody: { code?: number; error_subcode?: number; message?: string; type?: string } | undefined,
): FacebookApiError {
  const code = errBody?.code ?? null;
  const subcode = errBody?.error_subcode ?? null;
  const rawMsg = errBody?.message || `Facebook API error (${status})`;

  // Permission missing — code 10 or 200..299
  const permMatch = /requires.*permission[s]?\s*[:-]?\s*([a-z_,\s]+)/i.exec(rawMsg);
  const missingPermission = permMatch
    ? (permMatch[1].split(/[,\s]+/).filter(Boolean)[0] ?? null)
    : null;

  let type: FacebookApiError["type"] = "unknown";
  if (code === 190)
    type = subcode === 463 || /expired/i.test(rawMsg) ? "auth_expired" : "invalid_token";
  else if (code === 10 || (code !== null && code >= 200 && code <= 299)) type = "permission_denied";
  else if (code === 4 || /application request limit reached/i.test(rawMsg))
    type = "app_rate_limited";
  else if (code === 17 || code === 32 || code === 613) type = "rate_limited";
  else if (code === 803 || status === 404) type = "not_found";

  return new FacebookApiError({
    message: rawMsg,
    code,
    subcode,
    type,
    missingPermission,
    httpStatus: status,
    raw: errBody,
  });
}

async function fbGet(path: string, token: string) {
  const url = `${GRAPH_API}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new FacebookApiError({
      message: e instanceof Error ? e.message : "Network error contacting Facebook",
      code: null,
      subcode: null,
      type: "network",
      missingPermission: null,
      httpStatus: 0,
    });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw classifyFbError(res.status, data?.error);
  }
  return data;
}

/**
 * Check that the stored token has all required permissions for an operation.
 * Throws a FacebookApiError of type permission_denied listing what's missing.
 */
async function ensurePermissions(token: string, required: string[]): Promise<void> {
  const perms = await fbGet("/me/permissions", token);
  const granted = new Set(
    (perms.data ?? [])
      .filter((p: { status: string }) => p.status === "granted")
      .map((p: { permission: string }) => p.permission),
  );
  const missing = required.filter((r) => !granted.has(r));
  if (missing.length > 0) {
    throw new FacebookApiError({
      message: `الصلاحيات الناقصة: ${missing.join(", ")} — أعد ربط الحساب وامنح هذه الصلاحيات.`,
      code: 10,
      subcode: null,
      type: "permission_denied",
      missingPermission: missing[0],
      httpStatus: 403,
      raw: { missing, granted: Array.from(granted) },
    });
  }
}

/** Wrap any thrown error from a handler into a JSON-friendly response */
function serializeError(err: unknown) {
  if (err instanceof FacebookApiError) return err.toJSON();
  return {
    message: err instanceof Error ? err.message : String(err),
    code: null,
    subcode: null,
    type: "unknown" as const,
    missingPermission: null,
    httpStatus: 500,
  };
}

function parsePermissions(perms: unknown) {
  const rows = Array.isArray((perms as { data?: unknown })?.data)
    ? (perms as { data: unknown[] }).data
    : [];
  const granted = rows
    .filter(
      (p): p is { status: string; permission: string } =>
        typeof (p as { status?: unknown })?.status === "string" &&
        typeof (p as { permission?: unknown })?.permission === "string" &&
        (p as { status: string }).status === "granted",
    )
    .map((p) => p.permission);
  const declined = rows
    .filter(
      (p): p is { status: string; permission: string } =>
        typeof (p as { status?: unknown })?.status === "string" &&
        typeof (p as { permission?: unknown })?.permission === "string" &&
        (p as { status: string }).status !== "granted",
    )
    .map((p) => p.permission);
  return { granted, declined };
}

function normalizeProfile(me: { id?: unknown; name?: unknown; email?: unknown }) {
  const id = typeof me.id === "string" || typeof me.id === "number" ? String(me.id) : "";
  if (!id) {
    throw new FacebookApiError({
      message: "Facebook returned no user id for this token.",
      code: null,
      subcode: null,
      type: "invalid_token",
      missingPermission: null,
      httpStatus: 400,
      raw: me,
    });
  }
  const name = typeof me.name === "string" && me.name.trim() ? me.name.trim() : `Facebook ${id}`;
  return {
    id,
    name,
    email: typeof me.email === "string" && me.email.trim() ? me.email : null,
  };
}

function isFacebookErrorOfType(
  err: unknown,
  type: FacebookApiError["type"],
): err is FacebookApiError {
  return err instanceof FacebookApiError && err.type === type;
}

function savedOnlyProfile(
  row: {
    fb_user_id?: string | null;
    fb_user_name?: string | null;
    fb_user_email?: string | null;
  } | null,
  token: string,
) {
  return {
    id: row?.fb_user_id ?? `saved-token-${token.length}-${token.slice(-4)}`,
    name: row?.fb_user_name ?? "Facebook token saved — pending Meta check",
    email: row?.fb_user_email ?? null,
  };
}

/**
 * Verify a Facebook access token, fetch user profile,
 * and persist the connection for the current user.
 */
export const connectFacebook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        access_token: z.string().trim().min(20).max(2000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const token = data.access_token;

    const { data: existing, error: existingError } = await supabase
      .from("facebook_connections")
      .select("fb_user_id, fb_user_name, fb_user_email")
      .eq("user_id", userId)
      .maybeSingle();

    if (existingError) {
      return {
        success: false as const,
        profile: null,
        granted: [] as string[],
        declined: [] as string[],
        savedOnly: false as const,
        warning: null,
        error: {
          message: `Database error: ${existingError.message}`,
          code: null,
          subcode: null,
          type: "unknown" as const,
          missingPermission: null,
          httpStatus: 500,
        },
      };
    }

    try {
      const me = await fbGet("/me?fields=id,name,email", token);
      const profile = normalizeProfile(me);

      let granted: string[] = [];
      let declined: string[] = [];
      try {
        const perms = await fbGet("/me/permissions", token);
        ({ granted, declined } = parsePermissions(perms));
      } catch (permErr) {
        console.warn("[connectFacebook] permissions fetch failed:", permErr);
      }

      const { error: dbError } = await supabase.from("facebook_connections").upsert(
        {
          user_id: userId,
          access_token: token,
          fb_user_id: profile.id,
          fb_user_name: profile.name,
          fb_user_email: profile.email,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );

      if (dbError) {
        return {
          success: false as const,
          profile,
          granted,
          declined,
          savedOnly: false as const,
          warning: null,
          error: {
            message: `Database error: ${dbError.message}`,
            code: null,
            subcode: null,
            type: "unknown" as const,
            missingPermission: null,
            httpStatus: 500,
          },
        };
      }

      return {
        success: true as const,
        profile,
        granted,
        declined,
        savedOnly: false as const,
        warning: null,
        error: null,
      };
    } catch (err) {
      console.error("[connectFacebook] failed:", err);
      if (isFacebookErrorOfType(err, "app_rate_limited")) {
        const { error: dbError } = await supabase.from("facebook_connections").upsert(
          {
            user_id: userId,
            access_token: token,
            fb_user_id: existing?.fb_user_id ?? null,
            fb_user_name: existing?.fb_user_name ?? "Facebook token saved — pending Meta check",
            fb_user_email: existing?.fb_user_email ?? null,
          },
          { onConflict: "user_id" },
        );

        if (dbError) {
          return {
            success: false as const,
            profile: null,
            granted: [] as string[],
            declined: [] as string[],
            savedOnly: false as const,
            warning: null,
            error: {
              message: `Database error: ${dbError.message}`,
              code: null,
              subcode: null,
              type: "unknown" as const,
              missingPermission: null,
              httpStatus: 500,
            },
          };
        }

        return {
          success: true as const,
          profile: savedOnlyProfile(existing, token),
          granted: [] as string[],
          declined: [] as string[],
          savedOnly: true as const,
          warning: serializeError(err),
          error: null,
        };
      }
      return {
        success: false as const,
        profile: null,
        granted: [] as string[],
        declined: [] as string[],
        savedOnly: false as const,
        warning: null,
        error: serializeError(err),
      };
    }
  });

/**
 * Test a Facebook access token WITHOUT saving it.
 */
export const testFacebookToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        access_token: z.string().trim().min(20).max(2000),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const token = data.access_token;
    try {
      const me = await fbGet("/me?fields=id,name,email", token);
      const profile = normalizeProfile(me);
      let granted: string[] = [];
      let declined: string[] = [];
      try {
        const perms = await fbGet("/me/permissions", token);
        ({ granted, declined } = parsePermissions(perms));
      } catch (permErr) {
        console.warn("[testFacebookToken] permissions fetch failed:", permErr);
      }
      return { success: true as const, profile, granted, declined, error: null };
    } catch (err) {
      console.error("[testFacebookToken] failed:", err);
      return {
        success: false as const,
        profile: null,
        granted: [] as string[],
        declined: [] as string[],
        error: serializeError(err),
      };
    }
  });

/** Disconnect: remove the stored connection. */
export const disconnectFacebook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("facebook_connections").delete().eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

/** Get current connection (without exposing the raw token). */
export const getFacebookConnection = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("facebook_connections")
      .select("access_token, fb_user_id, fb_user_name, fb_user_email, last_synced_at, created_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { connection: null };
    const token = data.access_token ?? "";
    return {
      connection: {
        fb_user_id: data.fb_user_id,
        fb_user_name: data.fb_user_name,
        fb_user_email: data.fb_user_email,
        last_synced_at: data.last_synced_at,
        created_at: data.created_at,
        token_preview: token ? `${token.slice(0, 6)}…${token.slice(-4)}` : null,
      },
    };
  });

/**
 * Fetch the user's Facebook groups via /me/groups.
 * Returns a structured result that always succeeds at the RPC level — failures
 * surface as `error` so the client can render a clear, typed UI.
 */
export const fetchFacebookGroups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("facebook_connections")
      .select("access_token")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row?.access_token) {
      return {
        groups: [],
        error: {
          message: "لا يوجد ربط فيسبوك. الرجاء الربط أولاً.",
          code: null,
          subcode: null,
          type: "invalid_token" as const,
          missingPermission: null,
          httpStatus: 401,
        },
      };
    }

    try {
      // Verify required scopes BEFORE the call so we get a precise UI message
      // instead of an opaque "(#10) requires permission..." Graph error.
      await ensurePermissions(row.access_token, ["user_groups", "groups_access_member_info"]);

      const result = await fbGet(
        "/me/groups?fields=id,name,member_count,privacy,cover,description&limit=100",
        row.access_token,
      );

      await supabase
        .from("facebook_connections")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("user_id", userId);

      return { groups: result.data ?? [], error: null };
    } catch (err) {
      return { groups: [], error: serializeError(err) };
    }
  });

/** Fetch the user's Facebook pages via /me/accounts (same structured shape). */
export const fetchFacebookPages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("facebook_connections")
      .select("access_token")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row?.access_token) {
      return {
        pages: [],
        error: {
          message: "لا يوجد ربط فيسبوك. الرجاء الربط أولاً.",
          code: null,
          subcode: null,
          type: "invalid_token" as const,
          missingPermission: null,
          httpStatus: 401,
        },
      };
    }

    try {
      await ensurePermissions(row.access_token, ["pages_show_list"]);
      const result = await fbGet(
        "/me/accounts?fields=id,name,category,fan_count,picture,link&limit=100",
        row.access_token,
      );
      return { pages: result.data ?? [], error: null };
    } catch (err) {
      return { pages: [], error: serializeError(err) };
    }
  });

/**
 * Inspect the currently stored Facebook token: validity, expiry, scopes, profile.
 * Does NOT expose the raw token to the client.
 */
export const inspectFacebookConnection = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("facebook_connections")
      .select("access_token, fb_user_id, fb_user_name, fb_user_email, last_synced_at, created_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row?.access_token) {
      return { connected: false as const };
    }

    const token = row.access_token;
    const tokenPreview = `${token.slice(0, 6)}…${token.slice(-4)}`;

    let valid = true;
    let validationError: string | null = null;
    let profile: { id: string; name: string; email: string | null } | null = null;
    let granted: string[] = [];
    let declined: string[] = [];
    let expiresAt: string | null = null;
    let dataAccessExpiresAt: string | null = null;
    let appName: string | null = null;
    let isExpired = false;
    let validationErrorType: FacebookApiError["type"] | null = null;

    try {
      const me = await fbGet("/me?fields=id,name,email", token);
      profile = { id: String(me.id), name: me.name, email: me.email ?? null };
      const perms = await fbGet("/me/permissions", token);
      ({ granted, declined } = parsePermissions(perms));
    } catch (err) {
      validationErrorType = err instanceof FacebookApiError ? err.type : null;
      valid = false;
      validationError = err instanceof Error ? err.message : "Token validation failed";
      if (validationError.toLowerCase().includes("expired")) isExpired = true;
      if (validationErrorType === "app_rate_limited" && row.fb_user_id) {
        profile = {
          id: row.fb_user_id,
          name: row.fb_user_name ?? "Facebook",
          email: row.fb_user_email,
        };
      }
    }

    if (valid) {
      try {
        const dbg = await fbGet(`/debug_token?input_token=${encodeURIComponent(token)}`, token);
        const info = dbg?.data;
        if (info) {
          if (info.expires_at && info.expires_at > 0) {
            expiresAt = new Date(info.expires_at * 1000).toISOString();
            if (info.expires_at * 1000 < Date.now()) isExpired = true;
          }
          if (info.data_access_expires_at && info.data_access_expires_at > 0) {
            dataAccessExpiresAt = new Date(info.data_access_expires_at * 1000).toISOString();
          }
          appName = info.application ?? null;
          if (info.is_valid === false) valid = false;
        }
      } catch {
        // debug_token may fail for some token types; ignore.
      }
    }

    const requiredScopes = [
      "public_profile",
      "email",
      "user_groups",
      "groups_access_member_info",
      "pages_show_list",
      "pages_read_engagement",
      "pages_manage_metadata",
    ];
    const grantedSet = new Set(Array.isArray(granted) ? granted : []);
    const missingScopes =
      validationErrorType === "app_rate_limited"
        ? []
        : requiredScopes.filter((s) => !grantedSet.has(s));

    return {
      connected: true as const,
      valid,
      isExpired,
      validationError,
      validationErrorType,
      tokenPreview,
      tokenLength: token.length,
      profile,
      granted,
      declined,
      missingScopes,
      requiredScopes,
      expiresAt,
      dataAccessExpiresAt,
      appName,
      lastSyncedAt: row.last_synced_at,
      createdAt: row.created_at,
      storedProfile: {
        id: row.fb_user_id,
        name: row.fb_user_name,
        email: row.fb_user_email,
      },
    };
  });

/**
 * Fetch full Page Insights: basic info, daily engagement, audience demographics,
 * and online presence. Each metric is fetched independently so a single failure
 * (deprecated metric, missing permission) doesn't kill the whole response.
 */
export const fetchPageInsights = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ pageId: z.string().trim().min(1).max(100) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("facebook_connections")
      .select("access_token")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row?.access_token) {
      return {
        ok: false as const,
        error: {
          message: "لا يوجد ربط فيسبوك. الرجاء الربط أولاً.",
          type: "invalid_token" as const,
        },
        page: null,
        daily: [],
        demographics: { genderAge: [], country: [] },
        onlineHourly: [],
        warnings: [] as string[],
      };
    }
    const userToken = row.access_token;

    try {
      await ensurePermissions(userToken, ["pages_show_list", "pages_read_engagement"]);

      // Step 1: get a page access token (needed for page insights)
      const accountsRes = await fbGet(
        `/me/accounts?fields=id,access_token&limit=200`,
        userToken,
      );
      const accounts = (accountsRes.data ?? []) as Array<{ id: string; access_token: string }>;
      const acct = accounts.find((a) => String(a.id) === String(data.pageId));
      if (!acct?.access_token) {
        return {
          ok: false as const,
          error: {
            message:
              "تعذّر العثور على Page Access Token. تأكد إنك أدمن للصفحة وإن الصلاحيات ممنوحة.",
            type: "permission_denied" as const,
          },
          page: null,
          daily: [],
          demographics: { genderAge: [], country: [] },
          onlineHourly: [],
          warnings: [] as string[],
        };
      }
      const pageToken = acct.access_token;
      const warnings: string[] = [];

      // Step 2: page basic info
      const pageInfo = await fbGet(
        `/${encodeURIComponent(data.pageId)}?fields=id,name,fan_count,followers_count,picture.type(large),link,category`,
        pageToken,
      );

      // Helper: safe insight fetch — failures become warnings instead of throwing
      const safeInsight = async (metric: string, period: string, days?: number) => {
        const qs = new URLSearchParams();
        qs.set("metric", metric);
        qs.set("period", period);
        if (days) {
          const until = Math.floor(Date.now() / 1000);
          const since = until - days * 86400;
          qs.set("since", String(since));
          qs.set("until", String(until));
        }
        try {
          const r = await fbGet(`/${encodeURIComponent(data.pageId)}/insights?${qs}`, pageToken);
          return (r.data ?? []) as Array<{
            name: string;
            period: string;
            values: Array<{ value: unknown; end_time?: string }>;
            title?: string;
          }>;
        } catch (e) {
          warnings.push(`${metric}: ${e instanceof Error ? e.message : "failed"}`);
          return [];
        }
      };

      // Step 3: daily engagement (last 28 days)
      const dailyMetrics = await safeInsight(
        "page_impressions,page_impressions_unique,page_post_engagements,page_views_total,page_fan_adds,page_fan_removes",
        "day",
        28,
      );

      // Pivot daily into [{ date, impressions, reach, engagements, views, fanAdds, fanRemoves }]
      const dailyMap = new Map<
        string,
        {
          date: string;
          impressions: number;
          reach: number;
          engagements: number;
          views: number;
          fanAdds: number;
          fanRemoves: number;
        }
      >();
      const keyMap: Record<string, keyof Omit<ReturnType<typeof emptyDay>, "date">> = {
        page_impressions: "impressions",
        page_impressions_unique: "reach",
        page_post_engagements: "engagements",
        page_views_total: "views",
        page_fan_adds: "fanAdds",
        page_fan_removes: "fanRemoves",
      };
      function emptyDay() {
        return {
          date: "",
          impressions: 0,
          reach: 0,
          engagements: 0,
          views: 0,
          fanAdds: 0,
          fanRemoves: 0,
        };
      }
      for (const m of dailyMetrics) {
        const field = keyMap[m.name];
        if (!field) continue;
        for (const v of m.values ?? []) {
          const date = (v.end_time ?? "").slice(0, 10);
          if (!date) continue;
          let bucket = dailyMap.get(date);
          if (!bucket) {
            bucket = { ...emptyDay(), date };
            dailyMap.set(date, bucket);
          }
          const num = typeof v.value === "number" ? v.value : Number(v.value) || 0;
          bucket[field] = num;
        }
      }
      const daily = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

      // Step 4: demographics (deprecated by Meta — fully removed June 2026.
      // Many "New Page Experience" pages already return empty arrays here.)
      const demoMetrics = await safeInsight("page_fans_gender_age,page_fans_country", "lifetime");
      let genderAge: Array<{ bucket: string; gender: string; age: string; count: number }> = [];
      let country: Array<{ code: string; count: number }> = [];
      let demoReceived = { genderAge: false, country: false };
      for (const m of demoMetrics) {
        const latest = m.values?.[m.values.length - 1]?.value as
          | Record<string, number>
          | undefined;
        if (!latest || typeof latest !== "object") continue;
        if (m.name === "page_fans_gender_age") {
          demoReceived.genderAge = true;
          genderAge = Object.entries(latest).map(([k, v]) => {
            const [g, ...rest] = k.split(".");
            return {
              bucket: k,
              gender: g === "M" ? "male" : g === "F" ? "female" : "unknown",
              age: rest.join("."),
              count: Number(v) || 0,
            };
          });
        } else if (m.name === "page_fans_country") {
          demoReceived.country = true;
          country = Object.entries(latest)
            .map(([code, v]) => ({ code, count: Number(v) || 0 }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 15);
        }
      }
      // Add explicit warning if Meta returned the metric but with no rows
      if (demoReceived.genderAge && genderAge.length === 0) {
        warnings.push(
          "page_fans_gender_age: مهجور من Meta لصفحات التجربة الجديدة (سيتم حذفه نهائيًا يونيو 2026).",
        );
      }
      if (demoReceived.country && country.length === 0) {
        warnings.push(
          "page_fans_country: مهجور من Meta لصفحات التجربة الجديدة (سيتم حذفه نهائيًا يونيو 2026).",
        );
      }


      // Step 5: best activity times (avg of last 7 days, hourly buckets)
      const onlineMetrics = await safeInsight("page_fans_online_per_day", "day", 7);
      const hourBuckets = new Array<number>(24).fill(0);
      const hourCounts = new Array<number>(24).fill(0);
      for (const m of onlineMetrics) {
        for (const v of m.values ?? []) {
          const obj = v.value as Record<string, number> | undefined;
          if (!obj || typeof obj !== "object") continue;
          for (const [hourStr, count] of Object.entries(obj)) {
            const h = Number(hourStr);
            if (!Number.isFinite(h) || h < 0 || h > 23) continue;
            hourBuckets[h] += Number(count) || 0;
            hourCounts[h] += 1;
          }
        }
      }
      const onlineHourly = hourBuckets.map((sum, h) => ({
        hour: h,
        avg: hourCounts[h] > 0 ? Math.round(sum / hourCounts[h]) : 0,
      }));

      return {
        ok: true as const,
        error: null,
        page: {
          id: String(pageInfo.id),
          name: String(pageInfo.name ?? ""),
          fan_count: Number(pageInfo.fan_count ?? 0),
          followers_count: Number(pageInfo.followers_count ?? pageInfo.fan_count ?? 0),
          picture: pageInfo.picture?.data?.url ?? null,
          link: pageInfo.link ?? null,
          category: pageInfo.category ?? null,
        },
        daily,
        demographics: { genderAge, country },
        onlineHourly,
        warnings,
      };
    } catch (err) {
      return {
        ok: false as const,
        error: serializeError(err),
        page: null,
        daily: [],
        demographics: { genderAge: [] as Array<{ bucket: string; gender: string; age: string; count: number }>, country: [] as Array<{ code: string; count: number }> },
        onlineHourly: [] as Array<{ hour: number; avg: number }>,
        warnings: [] as string[],
      };
    }
  });

/**
 * Derive an audience signal from recent post engagement (commenters + reactors).
 * Use as a fallback when Page Insights demographics are empty (Meta deprecated
 * page_fans_gender_age / page_fans_country for New Page Experience pages).
 *
 * Returns top engaged users (name + id + count) — these are real people who
 * interacted with the page, not aggregated demographics. The frontend can group
 * by name prefix or just show the list directly.
 */
export const fetchPageAudienceFromPosts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        pageId: z.string().trim().min(1).max(100),
        postLimit: z.number().int().min(1).max(50).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("facebook_connections")
      .select("access_token")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row?.access_token) {
      return {
        ok: false as const,
        error: { message: "لا يوجد ربط فيسبوك.", type: "invalid_token" as const },
        topCommenters: [],
        topReactors: [],
        totals: { posts: 0, comments: 0, reactions: 0, uniqueUsers: 0 },
      };
    }

    try {
      await ensurePermissions(row.access_token, ["pages_show_list", "pages_read_engagement"]);

      // Get page access token
      const accountsRes = await fbGet(`/me/accounts?fields=id,access_token&limit=200`, row.access_token);
      const accounts = (accountsRes.data ?? []) as Array<{ id: string; access_token: string }>;
      const acct = accounts.find((a) => String(a.id) === String(data.pageId));
      if (!acct?.access_token) {
        return {
          ok: false as const,
          error: { message: "Page Access Token غير متاح. تأكد إنك أدمن للصفحة.", type: "permission_denied" as const },
          topCommenters: [],
          topReactors: [],
          totals: { posts: 0, comments: 0, reactions: 0, uniqueUsers: 0 },
        };
      }
      const pageToken = acct.access_token;
      const postLimit = data.postLimit ?? 25;

      // Fetch recent posts with reactions + comments expanded
      const postsRes = await fbGet(
        `/${encodeURIComponent(data.pageId)}/posts?fields=id,reactions.summary(true).limit(50){id,name,type},comments.summary(true).limit(50){from{id,name},message}&limit=${postLimit}`,
        pageToken,
      );
      const posts = (postsRes.data ?? []) as Array<{
        id: string;
        reactions?: { data?: Array<{ id: string; name: string; type?: string }>; summary?: { total_count?: number } };
        comments?: { data?: Array<{ from?: { id: string; name: string }; message?: string }>; summary?: { total_count?: number } };
      }>;

      const commenters = new Map<string, { id: string; name: string; count: number }>();
      const reactors = new Map<string, { id: string; name: string; count: number; types: Record<string, number> }>();
      const allUserIds = new Set<string>();
      let totalComments = 0;
      let totalReactions = 0;

      for (const p of posts) {
        totalComments += p.comments?.summary?.total_count ?? 0;
        totalReactions += p.reactions?.summary?.total_count ?? 0;
        for (const c of p.comments?.data ?? []) {
          if (!c.from?.id) continue;
          allUserIds.add(c.from.id);
          const cur = commenters.get(c.from.id) ?? { id: c.from.id, name: c.from.name, count: 0 };
          cur.count += 1;
          commenters.set(c.from.id, cur);
        }
        for (const r of p.reactions?.data ?? []) {
          if (!r.id) continue;
          allUserIds.add(r.id);
          const cur = reactors.get(r.id) ?? { id: r.id, name: r.name, count: 0, types: {} };
          cur.count += 1;
          const t = r.type ?? "LIKE";
          cur.types[t] = (cur.types[t] ?? 0) + 1;
          reactors.set(r.id, cur);
        }
      }

      const topCommenters = Array.from(commenters.values()).sort((a, b) => b.count - a.count).slice(0, 30);
      const topReactors = Array.from(reactors.values()).sort((a, b) => b.count - a.count).slice(0, 30);

      return {
        ok: true as const,
        error: null,
        topCommenters,
        topReactors,
        totals: {
          posts: posts.length,
          comments: totalComments,
          reactions: totalReactions,
          uniqueUsers: allUserIds.size,
        },
      };
    } catch (err) {
      return {
        ok: false as const,
        error: serializeError(err),
        topCommenters: [],
        topReactors: [],
        totals: { posts: 0, comments: 0, reactions: 0, uniqueUsers: 0 },
      };
    }
  });

/**
 * Helper: resolve a Page Access Token for a given pageId from the user's
 * stored connection. Returns either { ok: true, pageToken } or an error envelope.
 */
async function getPageAccessToken(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  pageId: string,
  requiredPerms: string[],
): Promise<
  | { ok: true; pageToken: string }
  | { ok: false; error: { message: string; type: "invalid_token" | "permission_denied" } }
> {
  const { data: row, error } = await supabase
    .from("facebook_connections")
    .select("access_token")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return { ok: false, error: { message: error.message, type: "invalid_token" } };
  if (!row?.access_token)
    return { ok: false, error: { message: "لا يوجد ربط فيسبوك.", type: "invalid_token" } };
  await ensurePermissions(row.access_token, requiredPerms);
  const accountsRes = await fbGet(
    `/me/accounts?fields=id,access_token&limit=200`,
    row.access_token,
  );
  const accounts = (accountsRes.data ?? []) as Array<{ id: string; access_token: string }>;
  const acct = accounts.find((a) => String(a.id) === String(pageId));
  if (!acct?.access_token)
    return {
      ok: false,
      error: {
        message: "Page Access Token غير متاح. تأكد إنك أدمن للصفحة.",
        type: "permission_denied",
      },
    };
  return { ok: true, pageToken: acct.access_token };
}

/**
 * List Messenger conversations for a Page Inbox (paginated, cursor-based).
 * Requires pages_messaging + pages_show_list.
 */
export const fetchPageConversations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        pageId: z.string().trim().min(1).max(100),
        limit: z.number().int().min(1).max(100).optional(),
        after: z.string().trim().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    try {
      const got = await getPageAccessToken(supabase, userId, data.pageId, [
        "pages_show_list",
        "pages_messaging",
      ]);
      if (!got.ok)
        return { ok: false as const, error: got.error, conversations: [], nextCursor: null };

      const limit = data.limit ?? 25;
      const qs = new URLSearchParams();
      qs.set(
        "fields",
        "id,participants,snippet,updated_time,message_count,unread_count",
      );
      qs.set("limit", String(limit));
      if (data.after) qs.set("after", data.after);
      const res = await fbGet(
        `/${encodeURIComponent(data.pageId)}/conversations?${qs}`,
        got.pageToken,
      );
      const rows = (res.data ?? []) as Array<{
        id: string;
        snippet?: string;
        updated_time?: string;
        message_count?: number;
        unread_count?: number;
        participants?: { data?: Array<{ id: string; name?: string; email?: string }> };
      }>;
      const conversations = rows.map((c) => {
        const others = (c.participants?.data ?? []).filter(
          (p) => String(p.id) !== String(data.pageId),
        );
        const other = others[0] ?? c.participants?.data?.[0];
        return {
          id: c.id,
          snippet: c.snippet ?? "",
          updatedTime: c.updated_time ?? null,
          messageCount: c.message_count ?? 0,
          unreadCount: c.unread_count ?? 0,
          participantId: other?.id ?? "",
          participantName: other?.name ?? "غير معروف",
        };
      });
      const nextCursor =
        (res.paging as { cursors?: { after?: string }; next?: string } | undefined)?.next
          ? (res.paging as { cursors?: { after?: string } }).cursors?.after ?? null
          : null;
      return { ok: true as const, error: null, conversations, nextCursor };
    } catch (err) {
      return {
        ok: false as const,
        error: serializeError(err),
        conversations: [] as Array<{
          id: string;
          snippet: string;
          updatedTime: string | null;
          messageCount: number;
          unreadCount: number;
          participantId: string;
          participantName: string;
        }>,
        nextCursor: null as string | null,
      };
    }
  });

/**
 * Fetch the latest messages for a specific conversation. Requires pages_messaging.
 */
export const fetchConversationMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        pageId: z.string().trim().min(1).max(100),
        conversationId: z.string().trim().min(1).max(200),
        limit: z.number().int().min(1).max(100).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    try {
      const got = await getPageAccessToken(supabase, userId, data.pageId, [
        "pages_show_list",
        "pages_messaging",
      ]);
      if (!got.ok) return { ok: false as const, error: got.error, messages: [] };

      const limit = data.limit ?? 50;
      const res = await fbGet(
        `/${encodeURIComponent(data.conversationId)}/messages?fields=id,from,to,message,created_time&limit=${limit}`,
        got.pageToken,
      );
      const rows = (res.data ?? []) as Array<{
        id: string;
        message?: string;
        created_time?: string;
        from?: { id: string; name?: string };
        to?: { data?: Array<{ id: string; name?: string }> };
      }>;
      const messages = rows.map((m) => ({
        id: m.id,
        text: m.message ?? "",
        createdTime: m.created_time ?? null,
        fromId: m.from?.id ?? "",
        fromName: m.from?.name ?? "",
        isFromPage: String(m.from?.id ?? "") === String(data.pageId),
      }));
      return { ok: true as const, error: null, messages };
    } catch (err) {
      return {
        ok: false as const,
        error: serializeError(err),
        messages: [] as Array<{
          id: string;
          text: string;
          createdTime: string | null;
          fromId: string;
          fromName: string;
          isFromPage: boolean;
        }>,
      };
    }
  });

/**
 * Extract leads from recent Messenger conversations — aggregates participant
 * info (name, PSID, last interaction, message count, unread status).
 */
export const extractLeadsFromConversations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        pageId: z.string().trim().min(1).max(100),
        max: z.number().int().min(1).max(200).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    try {
      const got = await getPageAccessToken(supabase, userId, data.pageId, [
        "pages_show_list",
        "pages_messaging",
      ]);
      if (!got.ok)
        return {
          ok: false as const,
          error: got.error,
          leads: [],
          totals: { conversations: 0, unread: 0, totalMessages: 0 },
        };

      const max = data.max ?? 100;
      const qs = new URLSearchParams();
      qs.set(
        "fields",
        "id,participants,snippet,updated_time,message_count,unread_count",
      );
      qs.set("limit", String(Math.min(max, 100)));
      const res = await fbGet(
        `/${encodeURIComponent(data.pageId)}/conversations?${qs}`,
        got.pageToken,
      );
      const rows = (res.data ?? []) as Array<{
        id: string;
        snippet?: string;
        updated_time?: string;
        message_count?: number;
        unread_count?: number;
        participants?: { data?: Array<{ id: string; name?: string }> };
      }>;
      let totalMessages = 0;
      let totalUnread = 0;
      const leads = rows.map((c) => {
        const others = (c.participants?.data ?? []).filter(
          (p) => String(p.id) !== String(data.pageId),
        );
        const other = others[0] ?? c.participants?.data?.[0];
        totalMessages += c.message_count ?? 0;
        totalUnread += c.unread_count ?? 0;
        return {
          conversationId: c.id,
          psid: other?.id ?? "",
          name: other?.name ?? "غير معروف",
          lastSnippet: c.snippet ?? "",
          lastInteraction: c.updated_time ?? null,
          messageCount: c.message_count ?? 0,
          unreadCount: c.unread_count ?? 0,
          status: (c.unread_count ?? 0) > 0 ? ("unread" as const) : ("replied" as const),
        };
      });
      return {
        ok: true as const,
        error: null,
        leads,
        totals: {
          conversations: leads.length,
          unread: totalUnread,
          totalMessages,
        },
      };
    } catch (err) {
      return {
        ok: false as const,
        error: serializeError(err),
        leads: [] as Array<{
          conversationId: string;
          psid: string;
          name: string;
          lastSnippet: string;
          lastInteraction: string | null;
          messageCount: number;
          unreadCount: number;
          status: "unread" | "replied";
        }>,
        totals: { conversations: 0, unread: 0, totalMessages: 0 },
      };
    }
  });
