// Server functions for the Facebook Bot management UI.
// All write paths are RLS-scoped to the calling user via requireSupabaseAuth.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { encryptJson } from "@/server/crypto.server";

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
type NormalizedCookie = { name: string; value: string; domain?: string; path?: string };
function parseCookiesInput(raw: string): NormalizedCookie[] | null {
  const text = raw.trim();
  if (!text) return null;

  // 1) JSON
  if (text.startsWith("[") || text.startsWith("{")) {
    try {
      const j = JSON.parse(text);
      const arr = Array.isArray(j) ? j : Array.isArray((j as any)?.cookies) ? (j as any).cookies : null;
      if (arr) {
        const out: NormalizedCookie[] = [];
        for (const c of arr) {
          if (!c || typeof c !== "object") continue;
          const name = (c.name ?? c.Name ?? c.key) as string | undefined;
          const value = (c.value ?? c.Value) as string | undefined;
          if (typeof name === "string" && typeof value === "string") {
            out.push({ name, value, domain: c.domain, path: c.path });
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
        out.push({ name: parts[5], value: parts[6], domain: parts[0], path: parts[2] });
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

// ---------- addBotAccount ----------
export const addBotAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => addAccountSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let payload: unknown;
    if (data.method === "cookies") {
      const parsed = parseCookiesInput(data.cookies);
      if (!parsed || parsed.length === 0) {
        throw new Error(
          "تعذّر قراءة الكوكيز. الصق إما JSON المُصدَّر من إضافة المتصفح، أو سلسلة مثل name=value; name2=value2"
        );
      }
      payload = { cookies: parsed };
    } else {
      payload = {
        email: data.email,
        password: data.password,
        twoFactorSecret: data.twoFactorSecret || null,
      };
    }
    const encrypted = encryptJson(payload);
    const { data: row, error } = await supabase
      .from("fb_bot_accounts")
      .insert({
        user_id: userId,
        display_name: data.displayName,
        auth_method: data.method,
        encrypted_payload: encrypted,
        status: "untested",
      })
      .select("id, display_name, auth_method, status, last_check_at, last_error, created_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

// ---------- listBotAccounts ----------
export const listBotAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("fb_bot_accounts")
      .select("id, display_name, auth_method, status, last_check_at, last_error, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
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
        payload: {
          content: data.content,
          groupIds: data.groupIds,
          intervalMinutes: data.intervalMinutes,
        },
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
    z.object({
      accountId: z.string().uuid(),
      postUrl: z.string().trim().url().max(500),
    }).parse(d),
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

// ---------- listJobs ----------
export const listJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("fb_jobs")
      .select("id, job_type, status, progress, total_items, processed_items, created_at, completed_at, error_message, account_id")
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
