// Admin server functions — all guarded by requireAdmin middleware which validates
// the bearer token and asserts the 'admin' role before the handler runs.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireAdmin } from "./admin-middleware";
import type { Database } from "@/integrations/supabase/types";

function admin() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function logAction(adminUserId: string, action: string, targetUserId?: string | null, payload: Record<string, unknown> = {}) {
  const db = admin();
  await db.from("admin_audit_log").insert({
    admin_user_id: adminUserId,
    action,
    target_user_id: targetUserId ?? null,
    payload: payload as never,
  });
}

// ---------- Guard check (cheap, used by layout) ----------
// Uses only requireSupabaseAuth so non-admins get a boolean instead of a 403.
export const checkIsAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = admin();
    const { data } = await db
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    return { isAdmin: !!data };
  });

// ---------- KPIs ----------
export const getAdminKpis = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => {
    const db = admin();
    const { data, error } = await db.rpc("admin_kpi_snapshot" as never);
    if (error) throw new Error(error.message);
    return { kpis: (data ?? {}) as Record<string, number | Record<string, number>> };
  });

export const getAdminTimeseries = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((d: { days?: number }) => ({ days: Math.min(Math.max(d?.days ?? 30, 7), 90) }))
  .handler(async ({ data }) => {
    const db = admin();
    const { data: rows, error } = await db.rpc("admin_daily_timeseries" as never, { _days: data.days } as never);
    if (error) throw new Error(error.message);
    return { rows: (rows ?? []) as Array<{ day: string; new_users: number; wa_messages: number; send_success: number; send_failed: number }> };
  });

// ---------- Live activity feed ----------
export const getRecentActivity = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => {
    const db = admin();
    const [profiles, campaigns, jobs, sendLog] = await Promise.all([
      db.from("profiles").select("id,full_name,created_at").order("created_at", { ascending: false }).limit(8),
      db.from("fb_campaigns").select("id,user_id,name,status,created_at").order("created_at", { ascending: false }).limit(8),
      db.from("fb_jobs").select("id,user_id,job_type,status,created_at").order("created_at", { ascending: false }).limit(8),
      db.from("send_log").select("id,user_id,title,channel,status,created_at").order("created_at", { ascending: false }).limit(8),
    ]);
    const events: Array<{ kind: string; id: string; user_id: string | null; title: string; status?: string | null; at: string }> = [];
    profiles.data?.forEach((p) => events.push({ kind: "signup", id: p.id, user_id: p.id, title: p.full_name || "حساب جديد", at: p.created_at }));
    campaigns.data?.forEach((c) => events.push({ kind: "campaign", id: c.id, user_id: c.user_id, title: c.name, status: c.status, at: c.created_at }));
    jobs.data?.forEach((j) => events.push({ kind: "job", id: j.id, user_id: j.user_id, title: j.job_type, status: j.status, at: j.created_at }));
    sendLog.data?.forEach((s) => events.push({ kind: "send", id: s.id, user_id: s.user_id, title: s.title, status: s.status, at: s.created_at }));
    events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return { events: events.slice(0, 25) };
  });

// ---------- Users list ----------
const listUsersSchema = z.object({
  search: z.string().trim().max(200).optional().default(""),
  plan: z.string().max(40).optional().default(""),
  role: z.string().max(40).optional().default(""),
  limit: z.number().int().min(1).max(200).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});

export const listAdminUsers = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((d) => listUsersSchema.parse(d ?? {}))
  .handler(async ({ data }) => {
    const db = admin();

    let q = db.from("profiles").select("id,full_name,avatar_url,plan,created_at", { count: "exact" });
    if (data.search) q = q.ilike("full_name", `%${data.search}%`);
    if (data.plan) q = q.eq("plan", data.plan);
    const { data: profiles, count, error } = await q
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);
    if (error) throw new Error(error.message);

    const ids = (profiles ?? []).map((p) => p.id);
    const [roles, fbConns, waSessions, contactsCount, campaignsCount] = await Promise.all([
      ids.length ? db.from("user_roles").select("user_id,role").in("user_id", ids) : Promise.resolve({ data: [] as Array<{ user_id: string; role: string }> }),
      ids.length ? db.from("facebook_connections").select("user_id,fb_user_name,fb_user_email").in("user_id", ids) : Promise.resolve({ data: [] as Array<{ user_id: string; fb_user_name: string | null; fb_user_email: string | null }> }),
      ids.length ? db.from("wa_sessions").select("user_id,status").in("user_id", ids) : Promise.resolve({ data: [] as Array<{ user_id: string; status: string }> }),
      ids.length ? db.from("contacts").select("user_id", { count: "exact", head: false }).in("user_id", ids) : Promise.resolve({ data: [] as Array<{ user_id: string }> }),
      ids.length ? db.from("fb_campaigns").select("user_id", { count: "exact", head: false }).in("user_id", ids) : Promise.resolve({ data: [] as Array<{ user_id: string }> }),
    ]);

    const rolesByUser = new Map<string, string[]>();
    (roles.data ?? []).forEach((r) => {
      const arr = rolesByUser.get(r.user_id) ?? [];
      arr.push(r.role);
      rolesByUser.set(r.user_id, arr);
    });
    const fbByUser = new Map<string, { name: string | null; email: string | null }>();
    (fbConns.data ?? []).forEach((f) => fbByUser.set(f.user_id, { name: f.fb_user_name, email: f.fb_user_email }));
    const waByUser = new Map<string, { count: number; connected: number }>();
    (waSessions.data ?? []).forEach((s) => {
      const cur = waByUser.get(s.user_id) ?? { count: 0, connected: 0 };
      cur.count += 1;
      if (s.status === "connected") cur.connected += 1;
      waByUser.set(s.user_id, cur);
    });
    const contactsByUser = new Map<string, number>();
    (contactsCount.data ?? []).forEach((c) => contactsByUser.set(c.user_id, (contactsByUser.get(c.user_id) ?? 0) + 1));
    const campaignsByUser = new Map<string, number>();
    (campaignsCount.data ?? []).forEach((c) => campaignsByUser.set(c.user_id, (campaignsByUser.get(c.user_id) ?? 0) + 1));

    const rows = (profiles ?? []).map((p) => ({
      id: p.id,
      full_name: p.full_name,
      avatar_url: p.avatar_url,
      plan: p.plan ?? "free",
      created_at: p.created_at,
      roles: rolesByUser.get(p.id) ?? [],
      fb: fbByUser.get(p.id) ?? null,
      wa: waByUser.get(p.id) ?? { count: 0, connected: 0 },
      contacts_count: contactsByUser.get(p.id) ?? 0,
      campaigns_count: campaignsByUser.get(p.id) ?? 0,
    }));

    const filtered = data.role
      ? rows.filter((r) => r.roles.includes(data.role))
      : rows;

    return { rows: filtered, total: count ?? rows.length };
  });

// ---------- User detail ----------
export const getAdminUserDetail = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((d: { userId: string }) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const db = admin();
    const [profile, roles, fb, wa, contacts, campaigns, jobs, sendLog, audit] = await Promise.all([
      db.from("profiles").select("*").eq("id", data.userId).maybeSingle(),
      db.from("user_roles").select("role").eq("user_id", data.userId),
      db.from("facebook_connections").select("*").eq("user_id", data.userId).maybeSingle(),
      db.from("wa_sessions").select("*").eq("user_id", data.userId),
      db.from("contacts").select("*", { count: "exact", head: true }).eq("user_id", data.userId),
      db.from("fb_campaigns").select("id,name,status,created_at").eq("user_id", data.userId).order("created_at", { ascending: false }).limit(10),
      db.from("fb_jobs").select("id,job_type,status,created_at").eq("user_id", data.userId).order("created_at", { ascending: false }).limit(10),
      db.from("send_log").select("id,title,channel,status,created_at").eq("user_id", data.userId).order("created_at", { ascending: false }).limit(20),
      db.from("admin_audit_log").select("*").eq("target_user_id", data.userId).order("created_at", { ascending: false }).limit(20),
    ]);
    return {
      profile: profile.data,
      roles: (roles.data ?? []).map((r) => r.role),
      facebook: fb.data,
      whatsapp_sessions: wa.data ?? [],
      contacts_count: contacts.count ?? 0,
      campaigns: campaigns.data ?? [],
      jobs: jobs.data ?? [],
      send_log: sendLog.data ?? [],
      audit: audit.data ?? [],
    };
  });

// ---------- Mutations ----------
export const updateUserPlan = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: { userId: string; plan: string }) =>
    z.object({ userId: z.string().uuid(), plan: z.enum(["free", "starter", "pro", "business", "enterprise"]) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const db = admin();
    const { error } = await db.from("profiles").update({ plan: data.plan }).eq("id", data.userId);
    if (error) throw new Error(error.message);
    await logAction(context.adminUserId, "update_plan", data.userId, { plan: data.plan });
    return { ok: true };
  });

export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: { userId: string; role: "admin" | "moderator" | "user"; grant: boolean }) =>
    z.object({ userId: z.string().uuid(), role: z.enum(["admin", "moderator", "user"]), grant: z.boolean() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    if (data.userId === context.adminUserId && data.role === "admin" && !data.grant) {
      throw new Error("لا يمكنك إزالة صلاحية الأدمن عن نفسك");
    }
    const db = admin();
    if (data.grant) {
      const { error } = await db.from("user_roles").insert({ user_id: data.userId, role: data.role as never });
      if (error && !error.message.includes("duplicate")) throw new Error(error.message);
    } else {
      const { error } = await db.from("user_roles").delete().eq("user_id", data.userId).eq("role", data.role);
      if (error) throw new Error(error.message);
    }
    await logAction(context.adminUserId, data.grant ? "grant_role" : "revoke_role", data.userId, { role: data.role });
    return { ok: true };
  });

export const deleteUserAccount = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: { userId: string }) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    if (data.userId === context.adminUserId) throw new Error("لا يمكنك حذف نفسك");
    const db = admin();
    const { error } = await db.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    await logAction(context.adminUserId, "delete_user", data.userId);
    return { ok: true };
  });

// ---------- Settings ----------
export const getPlatformSettings = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => {
    const db = admin();
    const { data, error } = await db.from("platform_settings").select("*").order("key");
    if (error) throw new Error(error.message);
    return { rows: data ?? [] };
  });

export const updatePlatformSetting = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: { key: string; value: unknown }) =>
    z.object({ key: z.string().min(1).max(80), value: z.unknown() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const db = admin();
    const { error } = await db
      .from("platform_settings")
      .update({ value: data.value as never, updated_by: context.adminUserId, updated_at: new Date().toISOString() })
      .eq("key", data.key);
    if (error) throw new Error(error.message);
    await logAction(context.adminUserId, "update_setting", null, { key: data.key, value: data.value });
    return { ok: true };
  });
