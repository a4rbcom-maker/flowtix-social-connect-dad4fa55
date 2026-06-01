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

