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

// ---------- VPS Worker status ----------
export const getVpsWorkerStatus = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => {
    const db = admin();
    const nowIso = new Date().toISOString();
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [heartbeats, recentJobs, pendingCount, runningCount, doneToday, failedToday] = await Promise.all([
      db.from("bot_worker_heartbeats").select("*").order("last_seen_at", { ascending: false }),
      db
        .from("fb_jobs")
        .select("id,user_id,job_type,status,progress,processed_items,total_items,started_at,completed_at,created_at,error_message")
        .order("created_at", { ascending: false })
        .limit(25),
      db.from("fb_jobs").select("id", { count: "exact", head: true }).eq("status", "pending"),
      db.from("fb_jobs").select("id", { count: "exact", head: true }).eq("status", "running"),
      db.from("fb_jobs").select("id", { count: "exact", head: true }).eq("status", "completed").gte("completed_at", dayAgo),
      db.from("fb_jobs").select("id", { count: "exact", head: true }).eq("status", "failed").gte("completed_at", dayAgo),
    ]);

    return {
      now: nowIso,
      workers: (heartbeats.data ?? []) as Array<{
        worker_name: string;
        version: string | null;
        capabilities: string[];
        last_seen_at: string;
        meta: Record<string, unknown>;
      }>,
      recentJobs: recentJobs.data ?? [],
      counts: {
        pending: pendingCount.count ?? 0,
        running: runningCount.count ?? 0,
        completed_24h: doneToday.count ?? 0,
        failed_24h: failedToday.count ?? 0,
      },
    };
  });

// ---------- Real (non-bot) visitor analytics ----------
export const getVisitorStats = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((d: { days?: number }) => ({ days: Math.min(Math.max(d?.days ?? 30, 1), 90) }))
  .handler(async ({ data }) => {
    const db = admin();
    const since = new Date(Date.now() - data.days * 24 * 60 * 60 * 1000).toISOString();
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const todayIso = today.toISOString();

    const [humanTotal, botTotal, humanToday, humanSessions, topPaths] = await Promise.all([
      db.from("site_visits").select("id", { count: "exact", head: true }).eq("is_bot", false).gte("created_at", since),
      db.from("site_visits").select("id", { count: "exact", head: true }).eq("is_bot", true).gte("created_at", since),
      db.from("site_visits").select("id", { count: "exact", head: true }).eq("is_bot", false).gte("created_at", todayIso),
      db.from("site_visits").select("session_id").eq("is_bot", false).gte("created_at", since).not("session_id", "is", null).limit(20000),
      db.from("site_visits").select("path").eq("is_bot", false).gte("created_at", since).limit(20000),
    ]);

    const uniqueSessions = new Set((humanSessions.data ?? []).map((r: any) => r.session_id)).size;
    const pathCounts = new Map<string, number>();
    (topPaths.data ?? []).forEach((r: any) => pathCounts.set(r.path, (pathCounts.get(r.path) ?? 0) + 1));
    const top = Array.from(pathCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([path, count]) => ({ path, count }));

    return {
      days: data.days,
      human_pageviews: humanTotal.count ?? 0,
      bot_pageviews: botTotal.count ?? 0,
      human_pageviews_today: humanToday.count ?? 0,
      unique_sessions: uniqueSessions,
      top_paths: top,
    };
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
    const [profile, roles, fb, wa, contacts, campaigns, jobs, sendLog, audit, authUser] = await Promise.all([
      db.from("profiles").select("*").eq("id", data.userId).maybeSingle(),
      db.from("user_roles").select("role").eq("user_id", data.userId),
      db.from("facebook_connections").select("*").eq("user_id", data.userId).maybeSingle(),
      db.from("wa_sessions").select("*").eq("user_id", data.userId),
      db.from("contacts").select("*", { count: "exact", head: true }).eq("user_id", data.userId),
      db.from("fb_campaigns").select("id,name,status,created_at").eq("user_id", data.userId).order("created_at", { ascending: false }).limit(10),
      db.from("fb_jobs").select("id,job_type,status,created_at").eq("user_id", data.userId).order("created_at", { ascending: false }).limit(10),
      db.from("send_log").select("id,title,channel,status,created_at").eq("user_id", data.userId).order("created_at", { ascending: false }).limit(20),
      db.from("admin_audit_log").select("*").eq("target_user_id", data.userId).order("created_at", { ascending: false }).limit(20),
      db.auth.admin.getUserById(data.userId),
    ]);
    const u = authUser.data?.user;
    const bannedUntilRaw = (u as unknown as { banned_until?: string | null } | undefined)?.banned_until ?? null;
    const isBanned = !!bannedUntilRaw && new Date(bannedUntilRaw).getTime() > Date.now();
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
      auth: {
        email: u?.email ?? null,
        phone: u?.phone ?? null,
        email_confirmed_at: u?.email_confirmed_at ?? null,
        last_sign_in_at: u?.last_sign_in_at ?? null,
        banned_until: bannedUntilRaw,
        is_banned: isBanned,
      },
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

export const createUserByAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: { email: string; password: string; fullName?: string; plan?: string; makeAdmin?: boolean }) =>
    z.object({
      email: z.string().email().max(200),
      password: z.string().min(8).max(72),
      fullName: z.string().trim().max(120).optional().default(""),
      plan: z.enum(["free", "starter", "pro", "business", "enterprise"]).optional().default("free"),
      makeAdmin: z.boolean().optional().default(false),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const db = admin();
    const { data: created, error } = await db.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName },
    });
    if (error) throw new Error(error.message);
    const newUserId = created.user?.id;
    if (newUserId) {
      // handle_new_user trigger creates profile row; update plan + name explicitly.
      await db.from("profiles").update({ plan: data.plan, full_name: data.fullName || null }).eq("id", newUserId);
      if (data.makeAdmin) {
        await db.from("user_roles").insert({ user_id: newUserId, role: "admin" as never });
      }
      await logAction(context.adminUserId, "create_user", newUserId, { email: data.email, plan: data.plan, makeAdmin: data.makeAdmin });
    }
    return { ok: true, userId: newUserId };
  });

export const updateUserProfileByAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: { userId: string; fullName?: string; email?: string }) =>
    z.object({
      userId: z.string().uuid(),
      fullName: z.string().trim().max(120).optional(),
      email: z.string().email().max(200).optional(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const db = admin();
    if (data.fullName !== undefined) {
      const { error } = await db.from("profiles").update({ full_name: data.fullName || null }).eq("id", data.userId);
      if (error) throw new Error(error.message);
    }
    if (data.email) {
      const { error } = await db.auth.admin.updateUserById(data.userId, { email: data.email, email_confirm: true });
      if (error) throw new Error(error.message);
    }
    await logAction(context.adminUserId, "update_profile", data.userId, { fullName: data.fullName, email: data.email });
    return { ok: true };
  });

export const setUserPasswordByAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: { userId: string; password: string }) =>
    z.object({ userId: z.string().uuid(), password: z.string().min(8).max(72) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const db = admin();
    const { error } = await db.auth.admin.updateUserById(data.userId, { password: data.password });
    if (error) throw new Error(error.message);
    await logAction(context.adminUserId, "reset_password", data.userId);
    return { ok: true };
  });

export const setUserBanned = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: { userId: string; banned: boolean; durationHours?: number }) =>
    z.object({
      userId: z.string().uuid(),
      banned: z.boolean(),
      durationHours: z.number().int().min(1).max(24 * 365 * 10).optional().default(24 * 365),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    if (data.userId === context.adminUserId) throw new Error("لا يمكنك إيقاف حسابك");
    const db = admin();
    const ban_duration = data.banned ? `${data.durationHours}h` : "none";
    const { error } = await db.auth.admin.updateUserById(data.userId, { ban_duration } as never);
    if (error) throw new Error(error.message);
    await logAction(context.adminUserId, data.banned ? "ban_user" : "unban_user", data.userId, { durationHours: data.durationHours });
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

// ---------- Facebook monitoring ----------
export const getAdminFacebookOverview = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => {
    const db = admin();
    const [conns, bots, camps, jobs, profiles] = await Promise.all([
      db.from("facebook_connections").select("user_id,fb_user_name,fb_user_email,last_synced_at,created_at"),
      db.from("fb_bot_accounts").select("user_id,display_name,status,auth_method,last_check_at,last_error,created_at"),
      db.from("fb_campaigns").select("id,user_id,name,status,total_targets,done_targets,success_count,failed_count,created_at,last_run_at").order("created_at", { ascending: false }).limit(200),
      db.from("fb_jobs").select("id,user_id,job_type,status,progress,total_items,processed_items,created_at,started_at,error_message").order("created_at", { ascending: false }).limit(200),
      db.from("profiles").select("id,full_name,avatar_url,plan"),
    ]);

    const profileMap = new Map<string, { full_name: string | null; avatar_url: string | null; plan: string | null }>();
    profiles.data?.forEach((p) => profileMap.set(p.id, { full_name: p.full_name, avatar_url: p.avatar_url, plan: p.plan }));

    type PerUser = {
      user_id: string;
      full_name: string | null;
      avatar_url: string | null;
      plan: string | null;
      connection: { name: string | null; email: string | null; last_synced_at: string | null } | null;
      bot_accounts: number;
      bot_accounts_active: number;
      campaigns_total: number;
      campaigns_running: number;
      jobs_running: number;
      jobs_failed: number;
      sent_success: number;
      sent_failed: number;
    };
    const perUser = new Map<string, PerUser>();
    const ensure = (uid: string): PerUser => {
      let row = perUser.get(uid);
      if (!row) {
        const p = profileMap.get(uid);
        row = {
          user_id: uid,
          full_name: p?.full_name ?? null,
          avatar_url: p?.avatar_url ?? null,
          plan: p?.plan ?? null,
          connection: null,
          bot_accounts: 0,
          bot_accounts_active: 0,
          campaigns_total: 0,
          campaigns_running: 0,
          jobs_running: 0,
          jobs_failed: 0,
          sent_success: 0,
          sent_failed: 0,
        };
        perUser.set(uid, row);
      }
      return row;
    };
    conns.data?.forEach((c) => {
      const r = ensure(c.user_id);
      r.connection = { name: c.fb_user_name, email: c.fb_user_email, last_synced_at: c.last_synced_at };
    });
    bots.data?.forEach((b) => {
      const r = ensure(b.user_id);
      r.bot_accounts += 1;
      if ((b.status as string) === "active") r.bot_accounts_active += 1;
    });
    camps.data?.forEach((c) => {
      const r = ensure(c.user_id);
      r.campaigns_total += 1;
      if ((c.status as string) === "running" || (c.status as string) === "queued") r.campaigns_running += 1;
      r.sent_success += c.success_count ?? 0;
      r.sent_failed += c.failed_count ?? 0;
    });
    jobs.data?.forEach((j) => {
      const r = ensure(j.user_id);
      if ((j.status as string) === "running" || (j.status as string) === "pending") r.jobs_running += 1;
      if ((j.status as string) === "failed") r.jobs_failed += 1;
    });

    const users = Array.from(perUser.values()).sort(
      (a, b) => (b.campaigns_total + b.bot_accounts) - (a.campaigns_total + a.bot_accounts),
    );

    const totals = {
      connections: conns.data?.length ?? 0,
      bot_accounts: bots.data?.length ?? 0,
      bot_accounts_active: bots.data?.filter((b) => (b.status as string) === "active").length ?? 0,
      campaigns_total: camps.data?.length ?? 0,
      campaigns_running: camps.data?.filter((c) => (c.status as string) === "running" || (c.status as string) === "queued").length ?? 0,
      jobs_running: jobs.data?.filter((j) => (j.status as string) === "running" || (j.status as string) === "pending").length ?? 0,
      jobs_failed: jobs.data?.filter((j) => (j.status as string) === "failed").length ?? 0,
      users_with_fb: perUser.size,
    };


    const recentCampaigns = (camps.data ?? []).slice(0, 25).map((c) => ({
      ...c,
      user: profileMap.get(c.user_id) ?? null,
    }));
    const recentJobs = (jobs.data ?? []).slice(0, 25).map((j) => ({
      ...j,
      user: profileMap.get(j.user_id) ?? null,
    }));

    return { totals, users, recentCampaigns, recentJobs };
  });

// ---------- WhatsApp monitoring ----------
export const getAdminWhatsappOverview = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => {
    const db = admin();
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [sessions, convsCount, msgs24h, msgs7d, aiLogs, recentMsgs, recentAi, profiles, allConvs] = await Promise.all([
      db.from("wa_sessions").select("user_id,session_id,status,phone_number,last_seen_at,qr_data_url,updated_at"),
      db.from("wa_conversations").select("user_id,unread_count,ai_enabled,is_archived"),
      db.from("wa_messages").select("user_id,direction,created_at").gte("created_at", since24h),
      db.from("wa_messages").select("user_id,direction,created_at").gte("created_at", since7d),
      db.from("wa_ai_logs").select("user_id,model,status,tokens_in,tokens_out,latency_ms,created_at").gte("created_at", since7d),
      db.from("wa_messages").select("id,user_id,session_id,direction,remote_jid,msg_type,text_body,created_at").order("created_at", { ascending: false }).limit(25),
      db.from("wa_ai_logs").select("id,user_id,model,status,latency_ms,tokens_in,tokens_out,error_message,created_at,prompt_excerpt").order("created_at", { ascending: false }).limit(25),
      db.from("profiles").select("id,full_name,avatar_url,plan"),
      db.from("wa_conversations").select("id,user_id,contact_name,contact_phone,last_message_text,last_message_at,unread_count,ai_enabled").order("last_message_at", { ascending: false }).limit(25),
    ]);

    const profileMap = new Map<string, { full_name: string | null; avatar_url: string | null; plan: string | null }>();
    profiles.data?.forEach((p) => profileMap.set(p.id, { full_name: p.full_name, avatar_url: p.avatar_url, plan: p.plan }));

    type PerUser = {
      user_id: string;
      full_name: string | null;
      avatar_url: string | null;
      plan: string | null;
      session: { status: string; phone: string | null; last_seen_at: string | null } | null;
      conversations: number;
      unread: number;
      ai_enabled_count: number;
      msgs_in_24h: number;
      msgs_out_24h: number;
      msgs_7d: number;
      ai_calls_7d: number;
      ai_errors_7d: number;
      tokens_7d: number;
    };
    const perUser = new Map<string, PerUser>();
    const ensure = (uid: string): PerUser => {
      let row = perUser.get(uid);
      if (!row) {
        const p = profileMap.get(uid);
        row = {
          user_id: uid,
          full_name: p?.full_name ?? null,
          avatar_url: p?.avatar_url ?? null,
          plan: p?.plan ?? null,
          session: null,
          conversations: 0,
          unread: 0,
          ai_enabled_count: 0,
          msgs_in_24h: 0,
          msgs_out_24h: 0,
          msgs_7d: 0,
          ai_calls_7d: 0,
          ai_errors_7d: 0,
          tokens_7d: 0,
        };
        perUser.set(uid, row);
      }
      return row;
    };

    sessions.data?.forEach((s) => {
      const r = ensure(s.user_id);
      r.session = { status: s.status, phone: s.phone_number, last_seen_at: s.last_seen_at };
    });
    convsCount.data?.forEach((c) => {
      const r = ensure(c.user_id);
      r.conversations += 1;
      r.unread += c.unread_count ?? 0;
      if (c.ai_enabled) r.ai_enabled_count += 1;
    });
    msgs24h.data?.forEach((m) => {
      const r = ensure(m.user_id);
      if (m.direction === "in") r.msgs_in_24h += 1;
      else r.msgs_out_24h += 1;
    });
    msgs7d.data?.forEach((m) => {
      const r = ensure(m.user_id);
      r.msgs_7d += 1;
    });
    aiLogs.data?.forEach((a) => {
      const r = ensure(a.user_id);
      r.ai_calls_7d += 1;
      if ((a.status as string) !== "success") r.ai_errors_7d += 1;
      r.tokens_7d += (a.tokens_in ?? 0) + (a.tokens_out ?? 0);
    });

    const users = Array.from(perUser.values()).sort(
      (a, b) => (b.msgs_7d + b.ai_calls_7d) - (a.msgs_7d + a.ai_calls_7d),
    );

    const totals = {
      sessions: sessions.data?.length ?? 0,
      sessions_connected: sessions.data?.filter((s) => s.status === "connected").length ?? 0,
      sessions_qr: sessions.data?.filter((s) => s.status === "qr" || s.status === "connecting").length ?? 0,
      conversations: convsCount.data?.length ?? 0,
      unread_total: (convsCount.data ?? []).reduce((acc, c) => acc + (c.unread_count ?? 0), 0),
      msgs_in_24h: msgs24h.data?.filter((m) => m.direction === "in").length ?? 0,
      msgs_out_24h: msgs24h.data?.filter((m) => m.direction === "out").length ?? 0,
      msgs_7d: msgs7d.data?.length ?? 0,
      ai_calls_7d: aiLogs.data?.length ?? 0,
      ai_errors_7d: aiLogs.data?.filter((a) => (a.status as string) !== "success").length ?? 0,
      ai_tokens_7d: (aiLogs.data ?? []).reduce((acc, a) => acc + (a.tokens_in ?? 0) + (a.tokens_out ?? 0), 0),
      users_with_wa: perUser.size,
    };

    // Compute hourly msg histogram for last 24h
    const buckets = new Array(24).fill(0).map((_, i) => ({ hour: i, in: 0, out: 0 }));
    const now = Date.now();
    msgs24h.data?.forEach((m) => {
      const h = Math.floor((now - new Date(m.created_at).getTime()) / (60 * 60 * 1000));
      const idx = 23 - h;
      if (idx >= 0 && idx < 24) {
        if (m.direction === "in") buckets[idx].in += 1;
        else buckets[idx].out += 1;
      }
    });

    const recentMessages = (recentMsgs.data ?? []).map((m) => ({
      ...m,
      user: profileMap.get(m.user_id) ?? null,
    }));
    const recentAiLogs = (recentAi.data ?? []).map((a) => ({
      ...a,
      user: profileMap.get(a.user_id) ?? null,
    }));
    const recentConversations = (allConvs.data ?? []).map((c) => ({
      ...c,
      user: profileMap.get(c.user_id) ?? null,
    }));

    return { totals, users, hourly: buckets, recentMessages, recentAiLogs, recentConversations };
  });

// ---------- Jobs management (unified fb_jobs + bulk_jobs) ----------
export const getAdminJobsOverview = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((d: { status?: string; kind?: string; search?: string; limit?: number } | undefined) =>
    z.object({
      status: z.string().max(40).optional().default(""),
      kind: z.enum(["all", "fb", "bulk"]).optional().default("all"),
      search: z.string().max(200).optional().default(""),
      limit: z.number().int().min(10).max(300).optional().default(100),
    }).parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const db = admin();
    const [fbRes, bulkRes, profilesRes] = await Promise.all([
      data.kind === "bulk"
        ? Promise.resolve({ data: [] as Array<Record<string, unknown>> })
        : db.from("fb_jobs").select("id,user_id,job_type,status,progress,total_items,processed_items,scheduled_at,started_at,completed_at,error_message,created_at,campaign_id,account_id").order("created_at", { ascending: false }).limit(data.limit),
      data.kind === "fb"
        ? Promise.resolve({ data: [] as Array<Record<string, unknown>> })
        : db.from("bulk_jobs").select("id,user_id,channel,title,status,total_recipients,sent_count,failed_count,scheduled_at,started_at,completed_at,next_send_at,error_message,created_at").order("created_at", { ascending: false }).limit(data.limit),
      db.from("profiles").select("id,full_name,avatar_url,plan"),
    ]);

    const profileMap = new Map<string, { full_name: string | null; avatar_url: string | null; plan: string | null }>();
    profilesRes.data?.forEach((p) => profileMap.set(p.id, { full_name: p.full_name, avatar_url: p.avatar_url, plan: p.plan }));

    type UnifiedJob = {
      id: string;
      kind: "fb" | "bulk";
      user_id: string;
      user: { full_name: string | null; avatar_url: string | null; plan: string | null } | null;
      title: string;
      job_type: string;
      status: string;
      total: number;
      processed: number;
      success: number;
      failed: number;
      progress: number;
      scheduled_at: string | null;
      started_at: string | null;
      completed_at: string | null;
      error_message: string | null;
      created_at: string;
    };

    const fbJobs: UnifiedJob[] = ((fbRes.data ?? []) as Array<Record<string, unknown>>).map((j) => {
      const total = (j.total_items as number) ?? 0;
      const processed = (j.processed_items as number) ?? 0;
      return {
        id: j.id as string,
        kind: "fb",
        user_id: j.user_id as string,
        user: profileMap.get(j.user_id as string) ?? null,
        title: String(j.job_type ?? "fb_job"),
        job_type: String(j.job_type ?? ""),
        status: String(j.status ?? ""),
        total,
        processed,
        success: processed,
        failed: 0,
        progress: total > 0 ? Math.round((processed / total) * 100) : ((j.progress as number) ?? 0),
        scheduled_at: (j.scheduled_at as string) ?? null,
        started_at: (j.started_at as string) ?? null,
        completed_at: (j.completed_at as string) ?? null,
        error_message: (j.error_message as string) ?? null,
        created_at: j.created_at as string,
      };
    });

    const bulkJobs: UnifiedJob[] = ((bulkRes.data ?? []) as Array<Record<string, unknown>>).map((j) => {
      const total = (j.total_recipients as number) ?? 0;
      const sent = (j.sent_count as number) ?? 0;
      const failed = (j.failed_count as number) ?? 0;
      return {
        id: j.id as string,
        kind: "bulk",
        user_id: j.user_id as string,
        user: profileMap.get(j.user_id as string) ?? null,
        title: String(j.title ?? "bulk_job"),
        job_type: `bulk_${String(j.channel ?? "")}`,
        status: String(j.status ?? ""),
        total,
        processed: sent + failed,
        success: sent,
        failed,
        progress: total > 0 ? Math.round(((sent + failed) / total) * 100) : 0,
        scheduled_at: (j.scheduled_at as string) ?? null,
        started_at: (j.started_at as string) ?? null,
        completed_at: (j.completed_at as string) ?? null,
        error_message: (j.error_message as string) ?? null,
        created_at: j.created_at as string,
      };
    });

    let all = [...fbJobs, ...bulkJobs].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    if (data.status) all = all.filter((j) => j.status === data.status);
    if (data.search) {
      const s = data.search.toLowerCase();
      all = all.filter((j) =>
        j.title.toLowerCase().includes(s) ||
        (j.user?.full_name?.toLowerCase().includes(s) ?? false) ||
        j.id.toLowerCase().includes(s),
      );
    }

    const totals = {
      total: all.length,
      running: all.filter((j) => j.status === "running").length,
      pending: all.filter((j) => j.status === "pending" || j.status === "scheduled").length,
      completed: all.filter((j) => j.status === "completed").length,
      failed: all.filter((j) => j.status === "failed").length,
      cancelled: all.filter((j) => j.status === "cancelled").length,
      paused: all.filter((j) => j.status === "paused").length,
      fb_count: fbJobs.length,
      bulk_count: bulkJobs.length,
      total_processed: all.reduce((a, j) => a + j.processed, 0),
      total_failed: all.reduce((a, j) => a + j.failed, 0),
    };

    return { jobs: all.slice(0, data.limit), totals };
  });

export const retryAdminJob = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: { id: string; kind: "fb" | "bulk" }) =>
    z.object({ id: z.string().uuid(), kind: z.enum(["fb", "bulk"]) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const db = admin();
    if (data.kind === "fb") {
      const { error } = await db.from("fb_jobs").update({
        status: "pending" as never,
        error_message: null,
        started_at: null,
        completed_at: null,
        scheduled_at: new Date().toISOString(),
      }).eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await db.from("bulk_jobs").update({
        status: "scheduled" as never,
        error_message: null,
        started_at: null,
        completed_at: null,
        scheduled_at: new Date().toISOString(),
        next_send_at: new Date().toISOString(),
      }).eq("id", data.id);
      if (error) throw new Error(error.message);
    }
    await logAction(context.adminUserId, "retry_job", null, { id: data.id, kind: data.kind });
    return { ok: true };
  });

export const cancelAdminJob = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: { id: string; kind: "fb" | "bulk" }) =>
    z.object({ id: z.string().uuid(), kind: z.enum(["fb", "bulk"]) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const db = admin();
    if (data.kind === "fb") {
      const { error } = await db.from("fb_jobs").update({
        status: "cancelled" as never,
        completed_at: new Date().toISOString(),
      }).eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await db.from("bulk_jobs").update({
        status: "cancelled" as never,
        completed_at: new Date().toISOString(),
      }).eq("id", data.id);
      if (error) throw new Error(error.message);
    }
    await logAction(context.adminUserId, "cancel_job", null, { id: data.id, kind: data.kind });
    return { ok: true };
  });

export const deleteAdminJob = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: { id: string; kind: "fb" | "bulk" }) =>
    z.object({ id: z.string().uuid(), kind: z.enum(["fb", "bulk"]) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const db = admin();
    if (data.kind === "fb") {
      const { error } = await db.from("fb_jobs").delete().eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await db.from("bulk_jobs").delete().eq("id", data.id);
      if (error) throw new Error(error.message);
    }
    await logAction(context.adminUserId, "delete_job", null, { id: data.id, kind: data.kind });
    return { ok: true };
  });

// ---------- Job detail (full timeline + per-target log) ----------
export const getAdminJobDetail = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((d: { id: string; kind: "fb" | "bulk" }) =>
    z.object({ id: z.string().uuid(), kind: z.enum(["fb", "bulk"]) }).parse(d),
  )
  .handler(async ({ data }) => {
    const db = admin();

    if (data.kind === "fb") {
      const { data: job, error } = await db
        .from("fb_jobs")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!job) throw new Error("Job not found");

      const [profileRes, resultsRes, campaignRes, accountRes, auditRes, relatedRes] = await Promise.all([
        db.from("profiles").select("id,full_name,avatar_url,plan").eq("id", job.user_id).maybeSingle(),
        db.from("fb_job_results").select("id,target,status,data,error,created_at").eq("job_id", data.id).order("created_at", { ascending: true }).limit(1000),
        job.campaign_id ? db.from("fb_campaigns").select("id,name,status,target_kind,total_targets,done_targets,success_count,failed_count,created_at,last_run_at").eq("id", job.campaign_id).maybeSingle() : Promise.resolve({ data: null }),
        job.account_id ? db.from("fb_bot_accounts").select("id,display_name,status,auth_method,last_check_at,last_error").eq("id", job.account_id).maybeSingle() : Promise.resolve({ data: null }),
        db.from("admin_audit_log").select("id,admin_user_id,action,payload,created_at").like("action", "%job%").order("created_at", { ascending: false }).limit(50),
        job.campaign_id
          ? db.from("fb_jobs").select("id,status,progress,processed_items,total_items,error_message,created_at,started_at,completed_at").eq("campaign_id", job.campaign_id).neq("id", data.id).order("created_at", { ascending: false }).limit(20)
          : Promise.resolve({ data: [] as Array<{ id: string; status: string; progress: number; processed_items: number; total_items: number; error_message: string | null; created_at: string; started_at: string | null; completed_at: string | null }> }),
      ]);

      const results = (resultsRes.data ?? []).map((r) => ({
        id: r.id as string,
        target: (r.target as string | null) ?? null,
        status: r.status as string,
        error: (r.error as string | null) ?? null,
        data_json: r.data == null ? null : JSON.stringify(r.data),
        created_at: r.created_at as string,
      }));
      const audit = (auditRes.data ?? [])
        .filter((a) => {
          const p = a.payload as Record<string, unknown> | null;
          return p && (p as { id?: string }).id === data.id;
        })
        .map((a) => ({
          id: a.id as string,
          admin_user_id: a.admin_user_id as string,
          action: a.action as string,
          created_at: a.created_at as string,
          payload_json: JSON.stringify(a.payload ?? {}),
        }));

      const counts = {
        success: results.filter((r) => r.status === "success").length,
        failed: results.filter((r) => r.status === "failed").length,
        skipped: results.filter((r) => r.status === "skipped").length,
      };

      const related_attempts = (relatedRes.data ?? []).map((r) => ({
        id: r.id as string,
        status: String(r.status ?? ""),
        progress: Number(r.progress ?? 0),
        processed_items: Number(r.processed_items ?? 0),
        total_items: Number(r.total_items ?? 0),
        error_message: (r.error_message as string | null) ?? null,
        created_at: r.created_at as string,
        started_at: (r.started_at as string | null) ?? null,
        completed_at: (r.completed_at as string | null) ?? null,
      }));

      return {
        kind: "fb" as const,
        job: {
          id: job.id,
          user_id: job.user_id,
          job_type: job.job_type as string,
          status: job.status as string,
          progress: job.progress as number,
          total_items: job.total_items as number,
          processed_items: job.processed_items as number,
          scheduled_at: job.scheduled_at as string | null,
          started_at: job.started_at as string | null,
          completed_at: job.completed_at as string | null,
          error_message: job.error_message as string | null,
          created_at: job.created_at as string,
          updated_at: job.updated_at as string,
          campaign_id: job.campaign_id as string | null,
          account_id: job.account_id as string | null,
          payload_json: JSON.stringify(job.payload ?? {}, null, 2),
        },
        user: profileRes.data ?? null,
        campaign: campaignRes.data ?? null,
        account: accountRes.data ?? null,
        results,
        counts,
        audit,
        related_attempts,
      };

    }

    // bulk
    const { data: job, error } = await db
      .from("bulk_jobs")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!job) throw new Error("Job not found");

    const [profileRes, recipientsRes, auditRes] = await Promise.all([
      db.from("profiles").select("id,full_name,avatar_url,plan").eq("id", job.user_id).maybeSingle(),
      db.from("bulk_job_recipients").select("id,name,phone,status,sent_at,error_message,created_at").eq("job_id", data.id).order("created_at", { ascending: true }).limit(2000),
      db.from("admin_audit_log").select("id,admin_user_id,action,payload,created_at").like("action", "%job%").order("created_at", { ascending: false }).limit(50),
    ]);

    const recipients = (recipientsRes.data ?? []).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      phone: r.phone as string,
      status: r.status as string,
      sent_at: (r.sent_at as string | null) ?? null,
      error_message: (r.error_message as string | null) ?? null,
      created_at: r.created_at as string,
    }));
    const audit = (auditRes.data ?? [])
      .filter((a) => {
        const p = a.payload as Record<string, unknown> | null;
        return p && (p as { id?: string }).id === data.id;
      })
      .map((a) => ({
        id: a.id as string,
        admin_user_id: a.admin_user_id as string,
        action: a.action as string,
        created_at: a.created_at as string,
        payload_json: JSON.stringify(a.payload ?? {}),
      }));


    const counts = {
      success: recipients.filter((r) => (r.status as string) === "success").length,
      failed: recipients.filter((r) => (r.status as string) === "failed").length,
      pending: recipients.filter((r) => (r.status as string) === "pending").length,
      skipped: recipients.filter((r) => (r.status as string) === "skipped").length,
    };

    return {
      kind: "bulk" as const,
      job: {
        id: job.id,
        user_id: job.user_id,
        channel: job.channel as string,
        title: job.title as string,
        message: job.message as string,
        image_url: job.image_url as string | null,
        status: job.status as string,
        total_recipients: job.total_recipients as number,
        sent_count: job.sent_count as number,
        failed_count: job.failed_count as number,
        interval_seconds: job.interval_seconds as number,
        scheduled_at: job.scheduled_at as string,
        started_at: job.started_at as string | null,
        completed_at: job.completed_at as string | null,
        next_send_at: job.next_send_at as string | null,
        error_message: job.error_message as string | null,
        created_at: job.created_at as string,
        updated_at: job.updated_at as string,
        metadata_json: JSON.stringify(job.metadata ?? {}, null, 2),
      },
      user: profileRes.data ?? null,
      recipients,
      counts,
      audit,
    };
  });



// ============================================================
// Logs: send_log + admin_audit_log
// ============================================================
export const getAdminLogs = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((d: { kind?: "send" | "audit"; limit?: number; userId?: string; channel?: string; status?: string; search?: string }) =>
    z.object({
      kind: z.enum(["send", "audit"]).default("send"),
      limit: z.number().min(10).max(500).default(200),
      userId: z.string().uuid().optional(),
      channel: z.string().optional(),
      status: z.string().optional(),
      search: z.string().max(200).optional(),
    }).parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const db = admin();
    if (data.kind === "audit") {
      let q = db.from("admin_audit_log").select("*").order("created_at", { ascending: false }).limit(data.limit);
      if (data.userId) q = q.eq("target_user_id", data.userId);
      if (data.search) q = q.ilike("action", `%${data.search}%`);
      const [{ data: rows, error }, profilesRes] = await Promise.all([
        q,
        db.from("profiles").select("id,full_name,avatar_url"),
      ]);
      if (error) throw new Error(error.message);
      const profMap = new Map((profilesRes.data ?? []).map((p) => [p.id, p]));
      return {
        kind: "audit" as const,
        rows: (rows ?? []).map((r) => ({
          ...r,
          admin: profMap.get(r.admin_user_id) ?? null,
          target: r.target_user_id ? profMap.get(r.target_user_id) ?? null : null,
        })),
      };
    }
    let q = db.from("send_log").select("*").order("created_at", { ascending: false }).limit(data.limit);
    if (data.userId) q = q.eq("user_id", data.userId);
    if (data.channel) q = q.eq("channel", data.channel as never);
    if (data.status) q = q.eq("status", data.status as never);
    if (data.search) q = q.or(`title.ilike.%${data.search}%,description.ilike.%${data.search}%,recipient.ilike.%${data.search}%`);
    const [{ data: rows, error }, profilesRes] = await Promise.all([
      q,
      db.from("profiles").select("id,full_name,avatar_url"),
    ]);
    if (error) throw new Error(error.message);
    const profMap = new Map((profilesRes.data ?? []).map((p) => [p.id, p]));
    return {
      kind: "send" as const,
      rows: (rows ?? []).map((r) => ({ ...r, user: profMap.get(r.user_id) ?? null })),
    };
  });

// ============================================================
// Announcements (platform-wide)
// ============================================================
export const listAnnouncements = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => {
    const db = admin();
    const { data, error } = await db
      .from("platform_announcements")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return { rows: data ?? [] };
  });

export const createAnnouncement = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: {
    title: string; body: string; level: "info" | "success" | "warning" | "error";
    notif_type?: "info" | "alert" | "update" | "maintenance" | "warning" | "offer" | "success";
    priority?: "low" | "normal" | "high" | "urgent";
    require_ack?: boolean;
    show_as_popup?: boolean;
    target_kind: "all" | "plan" | "users" | "single_user" | "active_users" | "suspended_users";
    target_plan?: string | null; target_user_ids?: string[];
    starts_at?: string | null; ends_at?: string | null;
  }) =>
    z.object({
      title: z.string().min(1).max(200),
      body: z.string().min(1).max(4000),
      level: z.enum(["info", "success", "warning", "error"]),
      notif_type: z.enum(["info", "alert", "update", "maintenance", "warning", "offer", "success"]).optional(),
      priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
      require_ack: z.boolean().optional(),
      show_as_popup: z.boolean().optional(),
      target_kind: z.enum(["all", "plan", "users", "single_user", "active_users", "suspended_users"]),
      target_plan: z.string().max(40).nullable().optional(),
      target_user_ids: z.array(z.string().uuid()).max(500).optional(),
      starts_at: z.string().nullable().optional(),
      ends_at: z.string().nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const db = admin();
    const usesUserIds = data.target_kind === "users" || data.target_kind === "single_user";
    const { error, data: row } = await db.from("platform_announcements").insert({
      title: data.title,
      body: data.body,
      level: data.level,
      notif_type: data.notif_type ?? "info",
      priority: data.priority ?? "normal",
      require_ack: data.require_ack ?? false,
      show_as_popup: data.show_as_popup ?? true,
      target_kind: data.target_kind,
      target_plan: data.target_kind === "plan" ? data.target_plan ?? null : null,
      target_user_ids: usesUserIds ? data.target_user_ids ?? [] : [],
      starts_at: data.starts_at || new Date().toISOString(),
      ends_at: data.ends_at || null,
      created_by: context.adminUserId,
      updated_by: context.adminUserId,
    }).select().single();
    if (error) throw new Error(error.message);
    await logAction(context.adminUserId, "create_announcement", null, { id: row.id, title: data.title });
    return { ok: true, id: row.id };
  });

export const updateAnnouncement = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: {
    id: string;
    title: string; body: string; level: "info" | "success" | "warning" | "error";
    notif_type: "info" | "alert" | "update" | "maintenance" | "warning" | "offer" | "success";
    priority: "low" | "normal" | "high" | "urgent";
    require_ack: boolean;
    show_as_popup: boolean;
    target_kind: "all" | "plan" | "users" | "single_user" | "active_users" | "suspended_users";
    target_plan?: string | null; target_user_ids?: string[];
    ends_at?: string | null;
  }) =>
    z.object({
      id: z.string().uuid(),
      title: z.string().min(1).max(200),
      body: z.string().min(1).max(4000),
      level: z.enum(["info", "success", "warning", "error"]),
      notif_type: z.enum(["info", "alert", "update", "maintenance", "warning", "offer", "success"]),
      priority: z.enum(["low", "normal", "high", "urgent"]),
      require_ack: z.boolean(),
      show_as_popup: z.boolean(),
      target_kind: z.enum(["all", "plan", "users", "single_user", "active_users", "suspended_users"]),
      target_plan: z.string().max(40).nullable().optional(),
      target_user_ids: z.array(z.string().uuid()).max(500).optional(),
      ends_at: z.string().nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const db = admin();
    const usesUserIds = data.target_kind === "users" || data.target_kind === "single_user";
    const { error } = await db.from("platform_announcements").update({
      title: data.title,
      body: data.body,
      level: data.level,
      notif_type: data.notif_type,
      priority: data.priority,
      require_ack: data.require_ack,
      show_as_popup: data.show_as_popup,
      target_kind: data.target_kind,
      target_plan: data.target_kind === "plan" ? data.target_plan ?? null : null,
      target_user_ids: usesUserIds ? data.target_user_ids ?? [] : [],
      ends_at: data.ends_at || null,
      updated_by: context.adminUserId,
    }).eq("id", data.id);
    if (error) throw new Error(error.message);
    await logAction(context.adminUserId, "update_announcement", null, { id: data.id });
    return { ok: true };
  });

export const deleteAnnouncement = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const db = admin();
    const { error } = await db.from("platform_announcements").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await logAction(context.adminUserId, "delete_announcement", null, { id: data.id });
    return { ok: true };
  });

export const getAnnouncementStats = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: { id: string }) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const db = admin();
    const { data: ann, error: e1 } = await db
      .from("platform_announcements").select("*").eq("id", data.id).single();
    if (e1 || !ann) throw new Error(e1?.message ?? "Not found");

    // Compute audience size
    let audienceSize = 0;
    if (ann.target_kind === "all") {
      const { count } = await db.from("profiles").select("id", { count: "exact", head: true });
      audienceSize = count ?? 0;
    } else if (ann.target_kind === "plan") {
      const { count } = await db.from("profiles").select("id", { count: "exact", head: true }).eq("plan", ann.target_plan ?? "");
      audienceSize = count ?? 0;
    } else if (ann.target_kind === "active_users") {
      const { count } = await db.from("profiles").select("id", { count: "exact", head: true }).eq("status", "active");
      audienceSize = count ?? 0;
    } else if (ann.target_kind === "suspended_users") {
      const { count } = await db.from("profiles").select("id", { count: "exact", head: true }).in("status", ["suspended", "warned"]);
      audienceSize = count ?? 0;
    } else {
      audienceSize = ann.target_user_ids?.length ?? 0;
    }

    const { data: reads } = await db
      .from("notification_reads")
      .select("user_id,delivered_at,opened_at,read_at,ack_at")
      .eq("announcement_id", data.id);

    const list = reads ?? [];
    const delivered = list.length;
    const opened = list.filter((r) => r.opened_at).length;
    const read = list.filter((r) => r.read_at).length;
    const acked = list.filter((r) => r.ack_at).length;

    // Avg read latency (delivered -> read) in seconds
    const latencies = list
      .filter((r) => r.read_at && r.delivered_at)
      .map((r) => (new Date(r.read_at!).getTime() - new Date(r.delivered_at).getTime()) / 1000);
    const avgReadLatency = latencies.length
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : null;

    // Enrich with profile names (top 200)
    const userIds = list.map((r) => r.user_id).slice(0, 200);
    let profiles: Array<{ id: string; full_name: string | null }> = [];
    if (userIds.length) {
      const { data } = await db.from("profiles").select("id,full_name").in("id", userIds);
      profiles = data ?? [];
    }
    const pmap = new Map(profiles.map((p) => [p.id, p.full_name]));
    const readers = list.map((r) => ({
      user_id: r.user_id,
      full_name: pmap.get(r.user_id) ?? null,
      delivered_at: r.delivered_at,
      opened_at: r.opened_at,
      read_at: r.read_at,
      ack_at: r.ack_at,
    }));

    return {
      audienceSize,
      delivered,
      notDelivered: Math.max(0, audienceSize - delivered),
      opened,
      read,
      acked,
      avgReadLatency,
      readers,
    };

  });


// ============================================================
// Security overview
// ============================================================
export const getAdminSecurityOverview = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => {
    const db = admin();
    const [rolesRes, profilesRes, recentAuditRes, recentLoginsRes] = await Promise.all([
      db.from("user_roles").select("user_id,role,id"),
      db.from("profiles").select("id,full_name,avatar_url,plan,created_at"),
      db.from("admin_audit_log").select("*").order("created_at", { ascending: false }).limit(100),
      db.from("profiles").select("id,full_name,avatar_url,plan,created_at").order("created_at", { ascending: false }).limit(20),
    ]);

    const profMap = new Map((profilesRes.data ?? []).map((p) => [p.id, p]));
    const roleRows = rolesRes.data ?? [];
    const admins = roleRows.filter((r) => r.role === "admin").map((r) => ({
      ...r, profile: profMap.get(r.user_id) ?? null,
    }));
    const moderators = roleRows.filter((r) => r.role === "moderator").map((r) => ({
      ...r, profile: profMap.get(r.user_id) ?? null,
    }));

    const audit = (recentAuditRes.data ?? []).map((r) => ({
      ...r,
      admin: profMap.get(r.admin_user_id) ?? null,
      target: r.target_user_id ? profMap.get(r.target_user_id) ?? null : null,
    }));

    // Action frequency
    const actionCounts: Record<string, number> = {};
    for (const a of audit) actionCounts[a.action] = (actionCounts[a.action] ?? 0) + 1;
    const topActions = Object.entries(actionCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([action, count]) => ({ action, count }));

    return {
      admins,
      moderators,
      audit,
      topActions,
      recentUsers: recentLoginsRes.data ?? [],
      totals: {
        admins: admins.length,
        moderators: moderators.length,
        totalUsers: profilesRes.data?.length ?? 0,
        actions24h: audit.filter((a) => new Date(a.created_at).getTime() > Date.now() - 86400_000).length,
      },
    };
  });

// ---------- Impersonation (super-admin only) ----------
// Restricted exclusively to this email — even other admins can NOT use it.
const SUPER_IMPERSONATOR_EMAIL = "khaled.tawfiq2111@gmail.com";

export const canImpersonate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = admin();
    const { data: userRes } = await db.auth.admin.getUserById(context.userId);
    const email = userRes?.user?.email?.toLowerCase() ?? "";
    return { allowed: email === SUPER_IMPERSONATOR_EMAIL };
  });

export const impersonateUser = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: { userId: string }) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const db = admin();
    // Verify caller email is the whitelisted super-impersonator.
    const { data: callerRes, error: callerErr } = await db.auth.admin.getUserById(context.adminUserId);
    if (callerErr || !callerRes?.user) throw new Error("Caller not found");
    const callerEmail = callerRes.user.email?.toLowerCase() ?? "";
    if (callerEmail !== SUPER_IMPERSONATOR_EMAIL) {
      throw new Error("forbidden: impersonation is restricted");
    }
    // Load target user email.
    const { data: targetRes, error: targetErr } = await db.auth.admin.getUserById(data.userId);
    if (targetErr || !targetRes?.user?.email) throw new Error("Target user not found");
    const targetEmail = targetRes.user.email;
    // Generate a magiclink hashed token for the target — the client verifies it
    // and receives a real signed-in session as that user.
    const { data: linkRes, error: linkErr } = await db.auth.admin.generateLink({
      type: "magiclink",
      email: targetEmail,
    });
    if (linkErr || !linkRes?.properties?.hashed_token) {
      throw new Error(linkErr?.message || "Failed to create impersonation link");
    }
    await logAction(context.adminUserId, "impersonate_user", data.userId, {
      caller_email: callerEmail,
      target_email: targetEmail,
    });
    return {
      tokenHash: linkRes.properties.hashed_token,
      email: targetEmail,
    };
  });

// ---------- WA Session cleanup (admin, per-user, safe) ----------
// Safety model:
// - Only sessions whose IDs belong to Flowtix are touched: we require both
//   (a) the session exists in wa_sessions for the given user, OR
//   (b) the bridge session id starts with `flowtix-{first16OfUserIdNoHyphens}-`.
// - Sessions belonging to other tenants on the shared bridge (Bot-Xtra, Xtra)
//   are never returned or deletable via these endpoints.

function flowtixPrefix(userId: string) {
  const compact = userId.replace(/-/g, "").slice(0, 16);
  return `flowtix-${compact}-`;
}

function sleepMs(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const adminListUserWaSessions = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: { userId: string }) =>
    z.object({ userId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data }) => {
    const db = admin();
    const { waBridge } = await import("./wa-bridge.server");

    const { data: rows, error } = await db
      .from("wa_sessions")
      .select("id, session_id, phone_number, status, updated_at, created_at")
      .eq("user_id", data.userId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    const dbRows = rows ?? [];

    const prefix = flowtixPrefix(data.userId);
    let bridgeSessions: Array<{
      id: string;
      connected: boolean;
      phone: string | null;
      inDb: boolean;
    }> = [];
    let bridgeError: string | null = null;
    try {
      const resp = await waBridge.listSessions();
      const all = resp.sessions ?? [];
      const dbIds = new Set(dbRows.map((r) => r.session_id).filter(Boolean));
      bridgeSessions = all
        .filter((s) => {
          const id = s.id ?? "";
          return id.startsWith(prefix) || dbIds.has(id);
        })
        .map((s) => ({
          id: s.id ?? "",
          connected: !!s.connected,
          phone: s.phone ?? s.phoneNumber ?? null,
          inDb: dbIds.has(s.id ?? ""),
        }));
    } catch (e) {
      bridgeError = e instanceof Error ? e.message : "bridge_unreachable";
    }

    return { dbSessions: dbRows, bridgeSessions, bridgeError };
  });

export const adminCleanupUserWaSession = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: { userId: string; sessionId: string }) =>
    z
      .object({
        userId: z.string().uuid(),
        sessionId: z.string().min(3).max(200),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = admin();
    const { waBridge } = await import("./wa-bridge.server");

    // Safety check: session must either belong to this user in our DB, OR
    // its id must match the Flowtix prefix for this user.
    const prefix = flowtixPrefix(data.userId);
    const { data: owned } = await db
      .from("wa_sessions")
      .select("id, user_id, session_id")
      .eq("session_id", data.sessionId)
      .maybeSingle();

    const belongsToUser = owned?.user_id === data.userId;
    const matchesPrefix = data.sessionId.startsWith(prefix);
    if (!belongsToUser && !matchesPrefix) {
      throw new Error(
        "refused: session does not belong to this Flowtix user (protects Bot-Xtra/Xtra tenants).",
      );
    }
    if (owned && owned.user_id !== data.userId) {
      throw new Error("refused: session belongs to another Flowtix user.");
    }

    // 1) Bridge delete (best-effort — treat 404 as already gone).
    let bridgeDeleted = false;
    let bridgeError: string | null = null;
    try {
      await waBridge.deleteSession(data.sessionId);
      bridgeDeleted = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/404|not.?found/i.test(msg)) {
        bridgeDeleted = true;
      } else {
        bridgeError = msg;
      }
    }

    // 2) DB delete (only if row exists for this user).
    let dbDeleted = false;
    if (owned && owned.user_id === data.userId) {
      const { error: delErr } = await db
        .from("wa_sessions")
        .delete()
        .eq("id", owned.id);
      if (delErr) throw new Error(delErr.message);
      dbDeleted = true;
    }

    await logAction(context.adminUserId, "wa_session_cleanup", data.userId, {
      session_id: data.sessionId,
      bridge_deleted: bridgeDeleted,
      db_deleted: dbDeleted,
      bridge_error: bridgeError,
    });

    return { ok: true, bridgeDeleted, dbDeleted, bridgeError };
  });

// ---------- Bulk cleanup of Flowtix-only disconnected sessions ----------
// Scans BOTH sources and deletes only what safely belongs to Flowtix:
//  1) wa_sessions rows with status = 'disconnected' AND updated_at older than N days
//  2) bridge sessions whose id starts with "flowtix-" AND are not connected
//     AND either exist as disconnected in our DB or are orphaned (not in DB).
// Never touches sessions without the "flowtix-" prefix (Bot-Xtra / Xtra tenants).
export const adminBulkCleanupFlowtixDisconnected = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: { minAgeDays?: number; dryRun?: boolean }) =>
    z
      .object({
        minAgeDays: z.number().int().min(0).max(90).optional().default(3),
        dryRun: z.boolean().optional().default(false),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const db = admin();
    const { waBridge } = await import("./wa-bridge.server");

    const cutoffMs = Date.now() - data.minAgeDays * 86_400_000;
    const cutoffIso = new Date(cutoffMs).toISOString();

    const collectCandidates = async () => {
      const { data: dbRows, error: dbErr } = await db
        .from("wa_sessions")
        .select("id, user_id, session_id, status, updated_at")
        .eq("status", "disconnected")
        .lt("updated_at", cutoffIso);
      if (dbErr) throw new Error(dbErr.message);
      const dbCandidates = (dbRows ?? []).filter((r) => r.session_id?.startsWith("flowtix-"));

      let bridgeCandidates: string[] = [];
      let bridgeError: string | null = null;
      try {
        const resp = await waBridge.listSessions();
        const all = resp.sessions ?? [];
        const dbIds = new Set(dbCandidates.map((r) => r.session_id).filter(Boolean));
        const { data: allOurRows } = await db.from("wa_sessions").select("session_id");
        const allOurIds = new Set((allOurRows ?? []).map((r) => r.session_id).filter(Boolean));
        bridgeCandidates = all
          .filter((s) => {
            const id = s.id ?? "";
            if (!id.startsWith("flowtix-")) return false;
            if (s.connected) return false;
            return dbIds.has(id) || !allOurIds.has(id);
          })
          .map((s) => s.id!) as string[];
      } catch (e) {
        bridgeError = e instanceof Error ? e.message : "bridge_unreachable";
      }

      const dbSessionIds = dbCandidates.map((r) => r.session_id).filter(Boolean) as string[];
      const uniqueBridgeIds = Array.from(new Set([...dbSessionIds, ...bridgeCandidates]));
      return { dbCandidates, uniqueBridgeIds, bridgeError };
    };

    const initial = await collectCandidates();

    if (data.dryRun) {
      return {
        dryRun: true,
        dbCandidateCount: initial.dbCandidates.length,
        bridgeCandidateCount: initial.uniqueBridgeIds.length,
        uniqueCandidateCount: initial.uniqueBridgeIds.length,
        bridgeError: initial.bridgeError,
        preview: initial.uniqueBridgeIds.slice(0, 20),
      };
    }

    // 3) Delete from bridge + DB in repeated scan/delete passes. The bridge can
    // expose stale/orphan sessions in batches, so a single pass may show 9 → 6 →
    // 4 on later manual scans. Keep rescanning until it is clean or only hard
    // failures remain.
    let bridgeDeleted = 0;
    let bridgeFailed = 0;
    const failedIds: Array<{ id: string; error: string }> = [];
    let dbDeleted = 0;
    let bridgeError = initial.bridgeError;
    const failureCounts = new Map<string, number>();
    const passes: Array<{ pass: number; dbCandidates: number; bridgeCandidates: number; bridgeDeleted: number; dbDeleted: number }> = [];

    for (let pass = 1; pass <= 5; pass += 1) {
      const current = pass === 1 ? initial : await collectCandidates();
      bridgeError = bridgeError ?? current.bridgeError;
      const idsToDelete = current.uniqueBridgeIds.filter((id) => (failureCounts.get(id) ?? 0) < 2);
      if (current.dbCandidates.length === 0 && idsToDelete.length === 0) break;

      let passBridgeDeleted = 0;
      for (const id of idsToDelete) {
        try {
          await waBridge.deleteSession(id);
          bridgeDeleted += 1;
          passBridgeDeleted += 1;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/404|not.?found/i.test(msg)) {
            bridgeDeleted += 1;
            passBridgeDeleted += 1;
          } else {
            failureCounts.set(id, (failureCounts.get(id) ?? 0) + 1);
            bridgeFailed += 1;
            failedIds.push({ id, error: msg });
          }
        }
      }

      let passDbDeleted = 0;
      if (current.dbCandidates.length > 0) {
        const ids = current.dbCandidates.map((r) => r.id);
        const { error: delErr, count } = await db
          .from("wa_sessions")
          .delete({ count: "exact" })
          .in("id", ids);
        if (delErr) throw new Error(delErr.message);
        passDbDeleted = count ?? ids.length;
        dbDeleted += passDbDeleted;
      }

      passes.push({
        pass,
        dbCandidates: current.dbCandidates.length,
        bridgeCandidates: current.uniqueBridgeIds.length,
        bridgeDeleted: passBridgeDeleted,
        dbDeleted: passDbDeleted,
      });

      if (pass < 5) await sleepMs(800);
    }

    const remaining = await collectCandidates();
    bridgeError = bridgeError ?? remaining.bridgeError;

    await logAction(context.adminUserId, "wa_bulk_cleanup_flowtix", null, {
      min_age_days: data.minAgeDays,
      initial_candidates: initial.uniqueBridgeIds.length,
      db_deleted: dbDeleted,
      bridge_deleted: bridgeDeleted,
      bridge_failed: bridgeFailed,
      bridge_error: bridgeError,
      remaining_db_candidates: remaining.dbCandidates.length,
      remaining_bridge_candidates: remaining.uniqueBridgeIds.length,
      passes,
    });

    return {
      dryRun: false,
      initialCandidateCount: initial.uniqueBridgeIds.length,
      dbDeleted,
      bridgeDeleted,
      bridgeFailed,
      failedIds: failedIds.slice(0, 20),
      bridgeError,
      remainingDbCandidateCount: remaining.dbCandidates.length,
      remainingBridgeCandidateCount: remaining.uniqueBridgeIds.length,
      remainingTotal: remaining.uniqueBridgeIds.length,
      remainingPreview: remaining.uniqueBridgeIds.slice(0, 20),
      passes,
    };
  });

// ---------- Users with problematic WA sessions (auto-list for admin) ----------
export const adminListUsersWithBadWaSessions = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async () => {
    const db = admin();
    const { data: rows, error } = await db
      .from("wa_sessions")
      .select("user_id, session_id, status, updated_at, phone_number")
      .in("status", ["disconnected", "qr", "pairing"])
      .order("updated_at", { ascending: true });
    if (error) throw new Error(error.message);

    const byUser = new Map<
      string,
      { userId: string; sessions: number; disconnected: number; qr: number; oldest: string | null }
    >();
    for (const r of rows ?? []) {
      const cur = byUser.get(r.user_id) ?? {
        userId: r.user_id,
        sessions: 0,
        disconnected: 0,
        qr: 0,
        oldest: null,
      };
      cur.sessions += 1;
      if (r.status === "disconnected") cur.disconnected += 1;
      if (r.status === "qr" || r.status === "pairing") cur.qr += 1;
      if (!cur.oldest || (r.updated_at && r.updated_at < cur.oldest)) cur.oldest = r.updated_at;
      byUser.set(r.user_id, cur);
    }

    const userIds = Array.from(byUser.keys());
    if (userIds.length === 0) return { users: [] };

    const { data: profiles } = await db
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", userIds);
    const profMap = new Map((profiles ?? []).map((p) => [p.id, p]));

    const users = Array.from(byUser.values())
      .map((u) => ({
        ...u,
        full_name: profMap.get(u.userId)?.full_name ?? null,
        avatar_url: profMap.get(u.userId)?.avatar_url ?? null,
      }))
      .sort((a, b) => (a.oldest ?? "").localeCompare(b.oldest ?? ""));

    return { users };
  });

// ---------- Admin: send a WhatsApp test message from a specific user's session ----------
// Used from the admin cleanup panel to verify (after reconnect) that:
//   1) the session actually sends,
//   2) the message reaches the target device,
//   3) replies come back to the agent through the normal webhook path.
// Safety: only Flowtix-prefixed sessions belonging to this user are eligible.
export const adminSendWaTestMessage = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: { userId: string; to: string; text?: string; sessionId?: string }) =>
    z
      .object({
        userId: z.string().uuid(),
        to: z
          .string()
          .trim()
          .min(6)
          .max(32)
          .regex(/^\+?[0-9]+$/u, "invalid phone"),
        text: z.string().trim().min(1).max(1000).optional(),
        sessionId: z.string().min(3).max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const db = admin();
    const { waBridge } = await import("./wa-bridge.server");

    // Resolve the session: prefer explicit sessionId, else first connected row.
    let sessionId = data.sessionId ?? null;
    if (sessionId) {
      const { data: owned } = await db
        .from("wa_sessions")
        .select("user_id, status")
        .eq("session_id", sessionId)
        .maybeSingle();
      const prefix = flowtixPrefix(data.userId);
      const belongs = owned?.user_id === data.userId;
      const matchesPrefix = sessionId.startsWith(prefix);
      if (!belongs && !matchesPrefix) {
        throw new Error("refused: session does not belong to this Flowtix user.");
      }
    } else {
      const { data: row } = await db
        .from("wa_sessions")
        .select("session_id, status")
        .eq("user_id", data.userId)
        .eq("status", "connected")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!row?.session_id) {
        throw new Error("no connected session for this user — ask them to scan QR first.");
      }
      sessionId = row.session_id;
    }

    // Normalise phone to digits only.
    const phone = data.to.replace(/[^0-9]/g, "");
    if (phone.length < 6) throw new Error("invalid phone number");
    const jid = `${phone}@s.whatsapp.net`;
    const text =
      data.text?.trim() ||
      "✅ اختبار من Flowtix Tools — لو وصلتك الرسالة دي، الجلسة شغالة وردودك هترجع للوكيل تلقائيًا.";

    let providerMessageId: string | null = null;
    let bridgeError: string | null = null;
    try {
      const res = await waBridge.sendText(sessionId, jid, text, { phone });
      const anyRes = res as Record<string, unknown>;
      const keyObj =
        anyRes.key && typeof anyRes.key === "object"
          ? (anyRes.key as Record<string, unknown>)
          : null;
      providerMessageId =
        (anyRes.messageId as string | undefined) ??
        (anyRes.id as string | undefined) ??
        (keyObj?.id as string | undefined) ??
        null;
    } catch (e) {
      bridgeError = e instanceof Error ? e.message : String(e);
    }

    await logAction(context.adminUserId, "wa_admin_test_send", data.userId, {
      session_id: sessionId,
      to: phone,
      provider_message_id: providerMessageId,
      ok: !bridgeError,
      error: bridgeError,
    });

    if (bridgeError) throw new Error(bridgeError);
    return { ok: true, sessionId, to: phone, providerMessageId };
  });

// ---------- Admin: search users for WhatsApp cleanup ----------
// Same result shape as adminListUsersWithBadWaSessions so the UI can reuse
// the same list renderer. Matches by full_name (ILIKE), user_id (uuid), or
// phone digits (wa_sessions.phone_number). Includes users even if all
// their sessions are healthy — so an admin can still open their card and
// send a test message.
export const adminSearchUsersForWaCleanup = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: { query: string }) =>
    z.object({ query: z.string().trim().min(1).max(200) }).parse(d),
  )
  .handler(async ({ data }) => {
    const db = admin();
    const q = data.query.trim();
    const digits = q.replace(/[^0-9]/g, "");
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q);
    const isPhone = digits.length >= 4 && digits.length === q.replace(/[^0-9+\s-]/g, "").length;

    const userIds = new Set<string>();

    if (isUuid) {
      userIds.add(q.toLowerCase());
    } else {
      // Name match against profiles.
      const { data: profs } = await db
        .from("profiles")
        .select("id")
        .ilike("full_name", `%${q}%`)
        .limit(30);
      (profs ?? []).forEach((p) => userIds.add(p.id));

      // Phone match against wa_sessions.phone_number.
      if (isPhone) {
        const { data: rows } = await db
          .from("wa_sessions")
          .select("user_id")
          .ilike("phone_number", `%${digits}%`)
          .limit(30);
        (rows ?? []).forEach((r) => userIds.add(r.user_id));
      }
    }

    const ids = Array.from(userIds).slice(0, 30);
    if (ids.length === 0) return { users: [] };

    // Fetch sessions for these users to compute counts + oldest problem age.
    const { data: sessions } = await db
      .from("wa_sessions")
      .select("user_id, status, updated_at")
      .in("user_id", ids);

    const byUser = new Map<
      string,
      { userId: string; sessions: number; disconnected: number; qr: number; oldest: string | null }
    >();
    for (const id of ids) {
      byUser.set(id, { userId: id, sessions: 0, disconnected: 0, qr: 0, oldest: null });
    }
    for (const r of sessions ?? []) {
      const cur = byUser.get(r.user_id)!;
      cur.sessions += 1;
      if (r.status === "disconnected") cur.disconnected += 1;
      if (r.status === "qr" || r.status === "pairing") cur.qr += 1;
      const isProblem = r.status === "disconnected" || r.status === "qr" || r.status === "pairing";
      if (isProblem && (!cur.oldest || (r.updated_at && r.updated_at < cur.oldest))) {
        cur.oldest = r.updated_at;
      }
    }

    const { data: profiles } = await db
      .from("profiles")
      .select("id, full_name, avatar_url")
      .in("id", ids);
    const profMap = new Map((profiles ?? []).map((p) => [p.id, p]));

    const users = Array.from(byUser.values())
      .map((u) => ({
        ...u,
        full_name: profMap.get(u.userId)?.full_name ?? null,
        avatar_url: profMap.get(u.userId)?.avatar_url ?? null,
      }))
      .sort((a, b) => (b.disconnected + b.qr) - (a.disconnected + a.qr));

    return { users };
  });

// ---------- Admin: session status event history ----------
export const adminGetWaSessionEvents = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d: { userId: string; sessionId: string; limit?: number }) =>
    z
      .object({
        userId: z.string().uuid(),
        sessionId: z.string().min(3).max(200),
        limit: z.number().int().min(1).max(200).optional().default(50),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const db = admin();
    const { data: events, error } = await db
      .from("wa_session_events")
      .select("id, from_status, to_status, source, reason, bridge_event, created_at")
      .eq("user_id", data.userId)
      .eq("session_id", data.sessionId)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return { events: events ?? [] };
  });
