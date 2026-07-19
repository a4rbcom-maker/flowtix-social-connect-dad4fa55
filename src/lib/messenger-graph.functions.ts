// Messenger Graph API pipeline — the new "official" path.
// Uses a User Access Token extracted from an authenticated Facebook session
// (fb_bot_accounts.graph_token_encrypted) to call the Meta Graph API directly:
//   - GET /me/accounts   → discover managed pages (real names, real IDs)
//   - GET /{page-id}/conversations → real thread + participants (PSID)
//   - POST /{page-id}/messages → Send API for bulk messaging
//
// Every stage logs to public.messenger_sync_logs so the UI can show exactly
// where each run succeeded or failed instead of a blank "0 results".

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fbGet } from "@/lib/facebook.functions";

const STAGE = {
  SESSION: "session_validation",
  TOKEN: "token_extract",
  PAGES: "pages_discovery",
  CONVERSATIONS: "conversations",
  CONTACTS: "contacts_upsert",
  SEND: "bulk_send",
} as const;

type Stage = (typeof STAGE)[keyof typeof STAGE];

async function loadAccountToken(
  supabase: { from: (t: string) => any },
  userId: string,
  accountId: string,
): Promise<{ token: string; updatedAt: string | null }> {
  const { data, error } = await supabase
    .from("fb_bot_accounts")
    .select("id, user_id, graph_token_encrypted, graph_token_updated_at")
    .eq("id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("الحساب غير موجود أو لا يعود لك.");
  if (!data.graph_token_encrypted) {
    throw new Error("لا يوجد توكن Graph API لهذا الحساب. اضغط \"استخراج التوكن من الجلسة\" أولاً.");
  }
  const { decryptJson } = await import("@/server/crypto.server");
  let token: string;
  try {
    token = decryptJson<string>(data.graph_token_encrypted);
  } catch {
    throw new Error("فشل فك تشفير توكن الحساب. أعد استخراجه من الجلسة.");
  }
  return { token, updatedAt: data.graph_token_updated_at };
}

async function logStage(
  supabase: { from: (t: string) => any },
  userId: string,
  entry: {
    accountId?: string | null;
    pageId?: string | null;
    stage: Stage;
    status: "ok" | "failed" | "partial";
    message?: string;
    failureReason?: string | null;
    expected?: unknown;
    received?: unknown;
    durationMs?: number;
  },
) {
  await supabase.from("messenger_sync_logs").insert({
    user_id: userId,
    account_id: entry.accountId ?? null,
    page_id: entry.pageId ?? null,
    stage: entry.stage,
    status: entry.status,
    message: entry.message ?? null,
    failure_reason: entry.failureReason ?? null,
    expected: entry.expected ?? null,
    received: entry.received ?? null,
    duration_ms: entry.durationMs ?? null,
  });
}

function classifyGraphError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/expired|invalid|OAuth|c_user|Session has expired/i.test(msg)) return "INVALID_TOKEN";
  if (/permission|scope|not authorized/i.test(msg)) return "NO_PERMISSION";
  if (/rate|throttl|limit reached/i.test(msg)) return "RATE_LIMIT";
  if (/network|fetch failed|ENOTFOUND|ECONN/i.test(msg)) return "NETWORK";
  if (/not found|Unknown path/i.test(msg)) return "NOT_FOUND";
  return "UNKNOWN";
}

// ---------- 1) Enqueue token extraction (bot job) ----------
export const enqueueTokenExtraction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ accountId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: account, error: accErr } = await supabase
      .from("fb_bot_accounts")
      .select("id, user_id, status")
      .eq("id", data.accountId)
      .eq("user_id", userId)
      .maybeSingle();
    if (accErr) throw new Error(accErr.message);
    if (!account) throw new Error("الحساب غير موجود.");

    const { data: job, error: jobErr } = await supabase
      .from("fb_jobs")
      .insert({
        user_id: userId,
        account_id: data.accountId,
        job_type: "messenger_extract_token",
        payload: {} as never,
        status: "pending",
      } as never)
      .select("id")
      .single();
    if (jobErr) throw new Error(jobErr.message);
    return { jobId: job.id };
  });

// ---------- 2) Discover pages via Graph API ----------
export const syncPagesForAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ accountId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const started = Date.now();

    let token: string;
    try {
      const t = await loadAccountToken(supabase, userId, data.accountId);
      token = t.token;
      await logStage(supabase, userId, {
        accountId: data.accountId,
        stage: STAGE.SESSION,
        status: "ok",
        message: "توكن الحساب متوفر",
        received: { updatedAt: t.updatedAt },
      });
    } catch (err) {
      await logStage(supabase, userId, {
        accountId: data.accountId,
        stage: STAGE.SESSION,
        status: "failed",
        failureReason: "NO_TOKEN",
        message: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      });
      throw err;
    }

    let pages: Array<{
      id: string;
      name: string;
      category?: string;
      access_token?: string;
      tasks?: string[];
      picture?: { data?: { url?: string } };
    }>;
    try {
      const res = await fbGet(
        "/me/accounts?fields=id,name,category,access_token,tasks,picture.type(square){url}&limit=200",
        token,
      );
      pages = ((res?.data ?? []) as typeof pages).filter((p) => p?.id && p?.name);
      await logStage(supabase, userId, {
        accountId: data.accountId,
        stage: STAGE.PAGES,
        status: pages.length > 0 ? "ok" : "partial",
        expected: { shape: "GET /me/accounts", minCount: 1 },
        received: { count: pages.length, sample: pages.slice(0, 3).map((p) => ({ id: p.id, name: p.name })) },
        message: pages.length > 0
          ? `تم اكتشاف ${pages.length} صفحة`
          : "الحساب لا يدير أي صفحات حسب Graph API. تأكد أنك Admin/Moderator على صفحة واحدة على الأقل بنفس الحساب.",
      });
    } catch (err) {
      await logStage(supabase, userId, {
        accountId: data.accountId,
        stage: STAGE.PAGES,
        status: "failed",
        failureReason: classifyGraphError(err),
        message: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      });
      throw err;
    }

    if (pages.length === 0) {
      return { count: 0, pages: [] };
    }

    const { encryptJson } = await import("@/server/crypto.server");
    const rows = pages.map((p) => ({
      user_id: userId,
      account_id: data.accountId,
      page_id: p.id,
      name: p.name,
      category: p.category ?? null,
      tasks: (Array.isArray(p.tasks) ? p.tasks : []) as never,
      access_token_encrypted: p.access_token ? encryptJson(p.access_token) : null,
      picture_url: p.picture?.data?.url ?? null,
      last_synced_at: new Date().toISOString(),
      source: "graph_api",
    }));

    const { error: upErr } = await supabase
      .from("messenger_pages")
      .upsert(rows as never, { onConflict: "user_id,page_id" });
    if (upErr) {
      await logStage(supabase, userId, {
        accountId: data.accountId,
        stage: STAGE.PAGES,
        status: "failed",
        failureReason: "DB_UPSERT",
        message: upErr.message,
      });
      throw new Error(upErr.message);
    }

    return {
      count: rows.length,
      pages: rows.map((r) => ({ pageId: r.page_id, name: r.name, tasks: r.tasks })),
    };
  });

// ---------- 3) Sync conversations for a single page ----------
export const syncPageConversations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ pageDbId: z.string().uuid(), maxPages: z.number().int().min(1).max(50).optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const started = Date.now();

    const { data: page, error: pErr } = await supabase
      .from("messenger_pages")
      .select("id, page_id, name, access_token_encrypted, account_id")
      .eq("id", data.pageDbId)
      .eq("user_id", userId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!page) throw new Error("الصفحة غير موجودة.");
    if (!page.access_token_encrypted) {
      throw new Error("لا يوجد توكن Page. أعد استخراج الصفحات لتحديث التوكنات.");
    }

    const { decryptJson } = await import("@/server/crypto.server");
    let pageToken: string;
    try {
      pageToken = decryptJson<string>(page.access_token_encrypted);
    } catch {
      throw new Error("فشل فك تشفير توكن الصفحة.");
    }

    const maxPages = data.maxPages ?? 20;
    let nextUrl: string | null =
      `/${page.page_id}/conversations?fields=id,updated_time,snippet,message_count,unread_count,participants{id,name,email}&limit=100`;
    let totalConvs = 0;
    let totalContacts = 0;
    const upsertRows: Array<Record<string, unknown>> = [];

    try {
      for (let i = 0; i < maxPages && nextUrl; i += 1) {
        const res: {
          data?: Array<{
            id: string;
            updated_time?: string;
            snippet?: string;
            message_count?: number;
            unread_count?: number;
            participants?: { data?: Array<{ id: string; name?: string }> };
          }>;
          paging?: { next?: string; cursors?: { after?: string } };
        } = await fbGet(nextUrl, pageToken);

        const convs = res?.data ?? [];
        totalConvs += convs.length;

        for (const c of convs) {
          const participants = c.participants?.data ?? [];
          // Exclude the page itself from participants
          const others = participants.filter((p) => p.id !== page.page_id);
          for (const p of others) {
            upsertRows.push({
              user_id: userId,
              page_id: page.page_id,
              page_name: page.name,
              psid: p.id,
              conversation_id: c.id,
              full_name: p.name ?? null,
              last_message_at: c.updated_time ?? null,
              last_message_preview: c.snippet ?? null,
              unread_count: c.unread_count ?? 0,
              messages_count: c.message_count ?? 0,
              source: "graph_api",
              metadata: { source: "graph_api", imported_at: new Date().toISOString() },
            });
            totalContacts += 1;
          }
        }

        // paging.next is a full URL — extract the path after graph host so fbGet keeps token handling.
        const next = res?.paging?.next;
        if (!next || convs.length === 0) {
          nextUrl = null;
        } else {
          const idx = next.indexOf("graph.facebook.com/");
          if (idx < 0) {
            nextUrl = null;
          } else {
            const afterHost = next.slice(idx + "graph.facebook.com/".length);
            // strip API version prefix (v21.0/) since fbGet re-adds it
            nextUrl = "/" + afterHost.replace(/^v\d+\.\d+\//, "").replace(/[?&]access_token=[^&]+/g, "");
          }
        }
      }

      if (upsertRows.length > 0) {
        // Chunked upsert to avoid single-request size blow-ups.
        const chunkSize = 200;
        for (let i = 0; i < upsertRows.length; i += chunkSize) {
          const slice = upsertRows.slice(i, i + chunkSize);
          const { error: upErr } = await supabase
            .from("messenger_contacts")
            .upsert(slice as never, { onConflict: "user_id,page_id,psid" });
          if (upErr) throw new Error(upErr.message);
        }
      }

      await supabase
        .from("messenger_pages")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("id", page.id);

      await logStage(supabase, userId, {
        accountId: page.account_id,
        pageId: page.page_id,
        stage: STAGE.CONVERSATIONS,
        status: totalConvs > 0 ? "ok" : "partial",
        expected: { shape: "GET /{page-id}/conversations", minCount: 1 },
        received: { conversations: totalConvs, contacts: totalContacts, pagesFetched: Math.min(maxPages, upsertRows.length > 0 ? maxPages : 1) },
        message: totalConvs > 0
          ? `تم جلب ${totalConvs} محادثة و ${totalContacts} جهة اتصال`
          : "الصفحة لا تحتوي على أي محادثات، أو التوكن لا يملك صلاحية pages_messaging.",
        durationMs: Date.now() - started,
      });

      return { conversations: totalConvs, contacts: totalContacts };
    } catch (err) {
      await logStage(supabase, userId, {
        accountId: page.account_id,
        pageId: page.page_id,
        stage: STAGE.CONVERSATIONS,
        status: "failed",
        failureReason: classifyGraphError(err),
        message: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      });
      throw err;
    }
  });

// ---------- 4) List pages / logs for the UI ----------
export const listGraphPages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ accountId: z.string().uuid().optional() }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let q = supabase
      .from("messenger_pages")
      .select("id, page_id, name, category, tasks, picture_url, last_synced_at, account_id")
      .eq("user_id", userId)
      .order("name");
    if (data.accountId) q = q.eq("account_id", data.accountId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({
      id: r.id,
      pageId: r.page_id,
      name: r.name,
      category: r.category,
      tasks: r.tasks ?? [],
      pictureUrl: r.picture_url,
      lastSyncedAt: r.last_synced_at,
      accountId: r.account_id,
    }));
  });

export const listSyncLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        accountId: z.string().uuid().optional(),
        pageId: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let q = supabase
      .from("messenger_sync_logs")
      .select("id, account_id, page_id, stage, status, message, failure_reason, expected, received, duration_ms, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 50);
    if (data.accountId) q = q.eq("account_id", data.accountId);
    if (data.pageId) q = q.eq("page_id", data.pageId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ---------- 5) Bulk send via Send API ----------
const SEND_TAGS = ["HUMAN_AGENT", "CONFIRMED_EVENT_UPDATE", "POST_PURCHASE_UPDATE", "ACCOUNT_UPDATE"] as const;

export const sendBulkGraph = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        pageDbId: z.string().uuid(),
        psids: z.array(z.string().min(3)).min(1).max(500),
        text: z.string().min(1).max(2000),
        tag: z.enum(SEND_TAGS).default("HUMAN_AGENT"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const started = Date.now();

    const { data: page, error: pErr } = await supabase
      .from("messenger_pages")
      .select("id, page_id, name, access_token_encrypted, account_id")
      .eq("id", data.pageDbId)
      .eq("user_id", userId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!page || !page.access_token_encrypted) throw new Error("الصفحة أو توكنها غير متوفر.");

    const { decryptJson } = await import("@/server/crypto.server");
    const pageToken = decryptJson<string>(page.access_token_encrypted);

    const results: Array<{ psid: string; ok: boolean; error?: string }> = [];
    for (const psid of data.psids) {
      try {
        const url = `https://graph.facebook.com/v21.0/${page.page_id}/messages?access_token=${encodeURIComponent(pageToken)}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipient: { id: psid },
            message: { text: data.text },
            messaging_type: "MESSAGE_TAG",
            tag: data.tag,
          }),
        });
        const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        if (!res.ok) {
          results.push({ psid, ok: false, error: j?.error?.message || `HTTP ${res.status}` });
        } else {
          results.push({ psid, ok: true });
        }
      } catch (err) {
        results.push({ psid, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
      // small delay to avoid rate spikes
      await new Promise((r) => setTimeout(r, 120));
    }

    const okCount = results.filter((r) => r.ok).length;
    await logStage(supabase, userId, {
      accountId: page.account_id,
      pageId: page.page_id,
      stage: STAGE.SEND,
      status: okCount === results.length ? "ok" : okCount > 0 ? "partial" : "failed",
      message: `تم إرسال ${okCount}/${results.length}`,
      received: { ok: okCount, failed: results.length - okCount, tag: data.tag },
      durationMs: Date.now() - started,
    });

    return { ok: okCount, failed: results.length - okCount, results };
  });
