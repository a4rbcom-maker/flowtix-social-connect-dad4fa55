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
  const permMatch = /requires.*permission[s]?\s*[:\-]?\s*([a-z_,\s]+)/i.exec(rawMsg);
  const missingPermission = permMatch
    ? (permMatch[1].split(/[,\s]+/).filter(Boolean)[0] ?? null)
    : null;

  let type: FacebookApiError["type"] = "unknown";
  if (code === 190)
    type = subcode === 463 || /expired/i.test(rawMsg) ? "auth_expired" : "invalid_token";
  else if (code === 10 || (code !== null && code >= 200 && code <= 299)) type = "permission_denied";
  else if (code === 4 || code === 17 || code === 32 || code === 613) type = "rate_limited";
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

    // 1) verify token via /me
    const me = await fbGet("/me?fields=id,name,email", token);
    const profile = normalizeProfile(me);

    // 2) upsert connection
    const { error } = await supabase.from("facebook_connections").upsert(
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

    if (error) throw new Error(error.message);

    return {
      success: true,
      profile,
    };
  });

/**
 * Test a Facebook access token WITHOUT saving it.
 * Returns the profile info + granted permissions so the user can verify
 * the token works and has the right scopes before connecting.
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
    const me = await fbGet("/me?fields=id,name,email", token);
    const perms = await fbGet("/me/permissions", token);
    const { granted, declined } = parsePermissions(perms);
    return {
      success: true,
      profile: normalizeProfile(me),
      granted,
      declined,
    };
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
      .select("fb_user_id, fb_user_name, fb_user_email, last_synced_at, created_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { connection: data };
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

    try {
      const [me, perms] = await Promise.all([
        fbGet("/me?fields=id,name,email", token),
        fbGet("/me/permissions", token),
      ]);
      profile = { id: String(me.id), name: me.name, email: me.email ?? null };
      ({ granted, declined } = parsePermissions(perms));
    } catch (err) {
      valid = false;
      validationError = err instanceof Error ? err.message : "Token validation failed";
      if (validationError.toLowerCase().includes("expired")) isExpired = true;
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
    const missingScopes = requiredScopes.filter((s) => !grantedSet.has(s));

    return {
      connected: true as const,
      valid,
      isExpired,
      validationError,
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
