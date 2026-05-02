// Facebook Graph API server functions
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GRAPH_API = "https://graph.facebook.com/v21.0";

async function fbGet(path: string, token: string) {
  const url = `${GRAPH_API}${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || `Facebook API error (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

/**
 * Verify a Facebook access token, fetch user profile,
 * and persist the connection for the current user.
 */
export const connectFacebook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      access_token: z.string().trim().min(20).max(2000),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const token = data.access_token;

    // 1) verify token via /me
    const me = await fbGet("/me?fields=id,name,email", token);

    // 2) upsert connection
    const { error } = await supabase
      .from("facebook_connections")
      .upsert(
        {
          user_id: userId,
          access_token: token,
          fb_user_id: String(me.id),
          fb_user_name: me.name ?? null,
          fb_user_email: me.email ?? null,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );

    if (error) throw new Error(error.message);

    return {
      success: true,
      profile: { id: me.id, name: me.name, email: me.email ?? null },
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
    z.object({
      access_token: z.string().trim().min(20).max(2000),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const token = data.access_token;
    const me = await fbGet("/me?fields=id,name,email", token);
    const perms = await fbGet("/me/permissions", token);
    const granted = (perms.data ?? [])
      .filter((p: { status: string }) => p.status === "granted")
      .map((p: { permission: string }) => p.permission);
    const declined = (perms.data ?? [])
      .filter((p: { status: string }) => p.status !== "granted")
      .map((p: { permission: string }) => p.permission);
    return {
      success: true,
      profile: { id: me.id, name: me.name, email: me.email ?? null },
      granted,
      declined,
    };
  });

/** Disconnect: remove the stored connection. */
export const disconnectFacebook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("facebook_connections")
      .delete()
      .eq("user_id", userId);
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

/** Fetch the user's Facebook groups via /me/groups */
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
    if (!row?.access_token) throw new Error("لا يوجد ربط فيسبوك. الرجاء الربط أولاً.");

    const result = await fbGet(
      "/me/groups?fields=id,name,member_count,privacy,cover,description&limit=100",
      row.access_token,
    );

    await supabase
      .from("facebook_connections")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("user_id", userId);

    return { groups: result.data ?? [] };
  });

/** Fetch the user's Facebook pages via /me/accounts */
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
    if (!row?.access_token) throw new Error("لا يوجد ربط فيسبوك. الرجاء الربط أولاً.");

    const result = await fbGet(
      "/me/accounts?fields=id,name,category,fan_count,picture,link&limit=100",
      row.access_token,
    );

    return { pages: result.data ?? [] };
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
      granted = (perms.data ?? [])
        .filter((p: { status: string }) => p.status === "granted")
        .map((p: { permission: string }) => p.permission);
      declined = (perms.data ?? [])
        .filter((p: { status: string }) => p.status !== "granted")
        .map((p: { permission: string }) => p.permission);
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
    const missingScopes = requiredScopes.filter((s) => !granted.includes(s));

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
