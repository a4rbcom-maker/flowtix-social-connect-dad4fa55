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
