// Server functions for the Messenger Contacts hub — Cookies (bot) path.
// Runs alongside the official Access Token path. Uses fb_bot_accounts +
// fb_jobs so the existing bot worker executes list-pages / sync / broadcast.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------- List bot accounts usable for Messenger ----------
export const listBotAccountsForMessenger = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("fb_bot_accounts")
      .select("id, display_name, status, last_error, last_check_at, cookie_expires_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((a) => ({
      id: a.id,
      displayName: a.display_name,
      status: a.status,
      lastError: a.last_error,
      lastCheckAt: a.last_check_at,
      cookieExpiresAt: a.cookie_expires_at,
    }));
  });

async function assertOwnedActiveAccount(
  supabase: { from: (table: string) => any },
  userId: string,
  accountId: string,
) {
  const { data, error } = await supabase
    .from("fb_bot_accounts")
    .select("id, status, last_error")
    .eq("user_id", userId)
    .eq("id", accountId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("حساب البوت غير موجود لهذا المستخدم.");
  if (data.status !== "active") {
    throw new Error(
      `حساب البوت ليس Active حالياً${data.last_error ? `: ${data.last_error}` : ""}. أعد ربط الحساب أولاً.`,
    );
  }
}

// ---------- Queue: list managed pages via cookies ----------
export const queueMessengerListPages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ accountId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertOwnedActiveAccount(supabase, userId, data.accountId);
    const { error: clearError } = await supabase
      .from("messenger_contacts")
      .delete()
      .eq("user_id", userId)
      .eq("page_id", data.pageId)
      .eq("source", "cookies_bot");
    if (clearError) throw new Error(`تعذّر تنظيف نتائج Cookies القديمة لهذه الصفحة: ${clearError.message}`);
    const { data: row, error } = await supabase
      .from("fb_jobs")
      .insert({
        user_id: userId,
        account_id: data.accountId,
        job_type: "messenger_list_pages",
        payload: {},
        scheduled_at: new Date().toISOString(),
        status: "pending",
      })
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("تم إنشاء المهمة لكن تعذّر قراءة رقمها.");
    return { jobId: row.id };
  });

// ---------- Queue: sync Messenger conversations for one Page via cookies ----------
export const queueMessengerCookiesSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        accountId: z.string().uuid(),
        pageId: z.string().trim().regex(/^\d{5,}$/, "اختر الصفحة مرة أخرى بعد جلب الصفحات؛ يجب أن يكون معرّف الصفحة رقميًا حتى لا يفتح Inbox خاطئ."),
        pageName: z.string().trim().max(200).optional().nullable(),
        maxConversations: z.number().int().min(50).max(10000).default(2000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertOwnedActiveAccount(supabase, userId, data.accountId);
    const { data: row, error } = await supabase
      .from("fb_jobs")
      .insert({
        user_id: userId,
        account_id: data.accountId,
        job_type: "messenger_sync_cookies",
        payload: {
          pageId: data.pageId,
          pageName: data.pageName ?? null,
          maxConversations: data.maxConversations,
        },
        scheduled_at: new Date().toISOString(),
        status: "pending",
      })
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("تم إنشاء المهمة لكن تعذّر قراءة رقمها.");
    return { jobId: row.id };
  });

// ---------- Queue: broadcast a message to selected contacts via cookies ----------
export const queueMessengerCookiesBroadcast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        accountId: z.string().uuid(),
        pageId: z.string().trim().min(3).max(100),
        contactIds: z.array(z.string().uuid()).min(1).max(2000),
        text: z.string().trim().min(1).max(4000),
        imageUrl: z.string().trim().url().max(1000).optional().nullable(),
        intervalSeconds: z.number().int().min(3).max(600).default(6),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertOwnedActiveAccount(supabase, userId, data.accountId);

    const { data: contacts, error: cErr } = await supabase
      .from("messenger_contacts")
      .select("id, psid, full_name")
      .eq("user_id", userId)
      .eq("page_id", data.pageId)
      .in("id", data.contactIds);
    if (cErr) throw new Error(cErr.message);
    const recipients = (contacts ?? [])
      .filter((c) => c.psid && /^\d{5,}$/.test(String(c.psid)))
      .map((c) => ({ psid: c.psid, name: c.full_name ?? "" }));
    if (recipients.length === 0) {
      throw new Error("لا يوجد مستلمون صالحون بمعرّف Messenger رقمي.");
    }

    const { data: row, error } = await supabase
      .from("fb_jobs")
      .insert({
        user_id: userId,
        account_id: data.accountId,
        job_type: "messenger_send_cookies",
        payload: {
          pageId: data.pageId,
          text: data.text,
          imageUrl: data.imageUrl ?? null,
          intervalSeconds: data.intervalSeconds,
          recipients,
        },
        total_items: recipients.length,
        scheduled_at: new Date().toISOString(),
        status: "pending",
      })
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("تم إنشاء الحملة لكن تعذّر قراءة رقمها.");
    return { jobId: row.id, queued: recipients.length };
  });

// ---------- Fetch bot-listed pages (results of messenger_list_pages) ----------
export const getBotMessengerPages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ accountId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Most recent completed/running list-pages job for this account.
    const { data: job } = await supabase
      .from("fb_jobs")
      .select("id, status, error_message, completed_at")
      .eq("user_id", userId)
      .eq("account_id", data.accountId)
      .eq("job_type", "messenger_list_pages")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!job) return { job: null, pages: [] };

    const { data: results, error } = await supabase
      .from("fb_job_results")
      .select("target, status, data")
      .eq("job_id", job.id)
      .eq("status", "success");
    if (error) throw new Error(error.message);

    const cleanPageName = (name: string) =>
      name
        .replace(/^\s*صورة\s+ملف\s+/u, "")
        .replace(/\s+الشخصية?$/u, "")
        .replace(/^\s*Profile\s+picture\s+of\s+/iu, "")
        .replace(/'s\s+profile\s+picture$/iu, "")
        .replace(/\s+/g, " ")
        .trim();

    const pages = (results ?? [])
      .map((r) => {
        const d = (r.data ?? {}) as { id?: string; name?: string; avatar_url?: string; avatarUrl?: string };
        const id = String(d.id ?? r.target ?? "").trim();
        const name = cleanPageName(String(d.name ?? ""));
        const avatar = String(d.avatar_url ?? d.avatarUrl ?? "").trim() || null;
        return id && name ? { pageId: id, pageName: name, avatarUrl: avatar } : null;
      })
      .filter((p): p is { pageId: string; pageName: string; avatarUrl: string | null } => !!p && /^\d{5,}$/.test(p.pageId));

    return { job, pages };
  });

// ---------- Latest sync/broadcast job status for the Cookies tab ----------
export const getBotMessengerJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        accountId: z.string().uuid(),
        jobType: z.enum([
          "messenger_list_pages",
          "messenger_sync_cookies",
          "messenger_send_cookies",
        ]),
        pageId: z.string().trim().regex(/^\d{5,}$/).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let query = supabase
      .from("fb_jobs")
      .select(
        "id, status, progress, total_items, processed_items, error_message, created_at, completed_at, payload",
      )
      .eq("user_id", userId)
      .eq("account_id", data.accountId)
      .eq("job_type", data.jobType);
    if (data.pageId && data.jobType === "messenger_sync_cookies") {
      query = query.eq("payload->>pageId", data.pageId);
    }
    const { data: job } = await query
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return { job: job ?? null };
  });
