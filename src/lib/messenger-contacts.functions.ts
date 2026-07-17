// Server functions for the Messenger Contacts hub.
// Reads Messenger conversations from Meta Graph API (pages_messaging scope),
// upserts each participant into public.messenger_contacts, and exposes filtered
// list / status / tag / campaign endpoints. All handlers are RLS-scoped via
// requireSupabaseAuth. Meta policy is enforced on the server: outside the
// 24-hour window, a valid Message Tag is required.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fbGet, getPageAccessToken, getStoredAccessToken } from "@/lib/facebook.functions";

const MESSAGE_TAGS = [
  "HUMAN_AGENT",
  "CONFIRMED_EVENT_UPDATE",
  "POST_PURCHASE_UPDATE",
  "ACCOUNT_UPDATE",
] as const;
type MessageTag = (typeof MESSAGE_TAGS)[number];

const MS_24H = 24 * 60 * 60 * 1000;

// ---------- List pages (official Graph only) ----------
export const listMessengerPages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const mapDbPage = (p: {
      page_id: string;
      page_name: string;
      avatar_url: string | null;
      status: string | null;
    }) => ({
      pageId: p.page_id,
      pageName: p.page_name,
      avatarUrl: p.avatar_url,
      status: p.status,
    });

    const friendlyError = (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (/permissions?|الصلاحيات|pages_show_list|pages_messaging/i.test(msg)) {
        return `تعذر قراءة صفحات فيسبوك بسبب نقص الصلاحيات. أعد ربط حساب فيسبوك الرسمي ثم وافق على صلاحيات الصفحات والرسائل. التفاصيل: ${msg}`;
      }
      if (/token|OAuth|expired|invalid/i.test(msg)) {
        return `ربط فيسبوك الرسمي غير صالح أو منتهي. أعد الربط ثم جرّب مرة أخرى. التفاصيل: ${msg}`;
      }
      return `تعذر تحميل صفحات فيسبوك الآن. التفاصيل: ${msg}`;
    };

    // Messenger contacts must start from a real Facebook Page returned by
    // /me/accounts. Cookie/bot extraction can include UI entities such as
    // groups, friend requests, or the personal profile, so it is deliberately
    // not used here.
    const token = await getStoredAccessToken(userId);
    if (!token) return [];

    try {
      const result = await fbGet(
        "/me/accounts?fields=id,name,access_token,picture.type(square){url}&limit=200",
        token,
      );
      const arr = (result?.data ?? []) as Array<{
        id: string;
        name: string;
        access_token?: string;
        picture?: { data?: { url?: string } };
      }>;
      const graphPages = arr
        .map((p) => ({
          id: String(p.id ?? "").trim(),
          name: String(p.name ?? "").replace(/\s+/g, " ").trim(),
          accessToken: p.access_token,
          avatarUrl: p.picture?.data?.url ?? null,
        }))
        .filter((p) => /^\d{5,}$/.test(p.id) && p.name.length > 0);
      if (graphPages.length === 0) return [];

      const { encryptJson } = await import("@/server/crypto.server");
      const rows = graphPages.map((p) => ({
        user_id: userId,
        page_id: p.id,
        page_name: p.name,
        avatar_url: p.avatarUrl,
        connection_type: "official" as const,
        access_token_encrypted: p.accessToken ? encryptJson(p.accessToken) : null,
        status: "active" as const,
        last_error: null,
      }));

      const { error: upsertError } = await supabase
        .from("fb_pages")
        .upsert(rows, { onConflict: "user_id,page_id", ignoreDuplicates: false });
      if (upsertError) throw new Error(upsertError.message);

      return rows
        .map((row) => mapDbPage(row))
        .sort((a, b) => a.pageName.localeCompare(b.pageName, "ar"));
    } catch (err) {
      throw new Error(friendlyError(err));
    }
  });


// ---------- Sync status ----------
export const getMessengerSyncStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ pageId: z.string().min(1).max(100) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: job } = await supabase
      .from("messenger_sync_jobs")
      .select("*")
      .eq("user_id", userId)
      .eq("page_id", data.pageId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { count } = await supabase
      .from("messenger_contacts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("page_id", data.pageId);
    return { job: job ?? null, contactsCount: count ?? 0 };
  });

// ---------- Start sync ----------
export const startMessengerSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        pageId: z.string().min(1).max(100),
        mode: z.enum(["initial", "incremental"]).default("incremental"),
        maxConversations: z.number().int().min(10).max(2000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Verify page ownership + get page name for job log.
    const { data: page } = await supabase
      .from("fb_pages")
      .select("page_id, page_name")
      .eq("user_id", userId)
      .eq("page_id", data.pageId)
      .eq("connection_type", "official")
      .maybeSingle();
    if (!page) throw new Error("هذه ليست صفحة Facebook مُدارة عبر الربط الرسمي لهذا الحساب.");

    // Refuse to start when a job is already running for this page.
    const { data: running } = await supabase
      .from("messenger_sync_jobs")
      .select("id")
      .eq("user_id", userId)
      .eq("page_id", data.pageId)
      .in("status", ["queued", "running"])
      .maybeSingle();
    if (running) return { jobId: running.id, alreadyRunning: true };

    // Resolve Page Access Token via existing helper.
    const got = await getPageAccessToken(supabase, userId, data.pageId, [
      "pages_show_list",
      "pages_messaging",
    ]);
    if (!got.ok) {
      // Record the failure so the UI can show a stop reason.
      const { data: failedJob } = await supabase
        .from("messenger_sync_jobs")
        .insert({
          user_id: userId,
          page_id: data.pageId,
          page_name: page.page_name,
          status: "failed",
          mode: data.mode,
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          error_message: got.error.message,
          triggered_by: "manual",
        })
        .select("id")
        .single();
      return { jobId: failedJob?.id ?? null, alreadyRunning: false, error: got.error.message };
    }

    const { data: job, error: jobErr } = await supabase
      .from("messenger_sync_jobs")
      .insert({
        user_id: userId,
        page_id: data.pageId,
        page_name: page.page_name,
        status: "running",
        mode: data.mode,
        started_at: new Date().toISOString(),
        triggered_by: "manual",
      })
      .select("id")
      .single();
    if (jobErr || !job) throw new Error(jobErr?.message ?? "Failed to create sync job");

    // Determine incremental cutoff.
    let cutoff: string | null = null;
    if (data.mode === "incremental") {
      const { data: latest } = await supabase
        .from("messenger_contacts")
        .select("last_message_at")
        .eq("user_id", userId)
        .eq("page_id", data.pageId)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (latest?.last_message_at) {
        // Overlap by 1h so we don't miss updates on the boundary.
        cutoff = new Date(new Date(latest.last_message_at).getTime() - 60 * 60 * 1000).toISOString();
      }
    }

    // Page through /{page-id}/conversations. Meta caps at ~2min per call chain
    // in a serverless worker, so bound the total work and mark cursor for
    // future resumption.
    const maxConv = data.maxConversations ?? (data.mode === "initial" ? 1000 : 300);
    let after: string | undefined;
    let scannedConv = 0;
    let scannedMsg = 0;
    let upserted = 0;
    let stopReason: string | null = null;
    let lastCursor: string | null = null;

    outer: for (let pageIdx = 0; pageIdx < 40; pageIdx += 1) {
      const qs = new URLSearchParams();
      qs.set(
        "fields",
        "id,participants,snippet,updated_time,message_count,unread_count",
      );
      qs.set("limit", "100");
      if (after) qs.set("after", after);
      let res: {
        data?: unknown[];
        paging?: { cursors?: { after?: string }; next?: string };
      };
      try {
        res = await fbGet(
          `/${encodeURIComponent(data.pageId)}/conversations?${qs}`,
          got.pageToken,
        );
      } catch (err) {
        stopReason = `graph_error: ${err instanceof Error ? err.message : String(err)}`;
        break;
      }
      const rows = (res.data ?? []) as Array<{
        id: string;
        snippet?: string;
        updated_time?: string;
        message_count?: number;
        unread_count?: number;
        participants?: { data?: Array<{ id: string; name?: string }> };
      }>;

      if (rows.length === 0) {
        stopReason = "no_more_conversations";
        break;
      }

      // Bulk-upsert contacts for this batch.
      type ContactUpsert = {
        user_id: string;
        page_id: string;
        page_name: string | null;
        psid: string;
        conversation_id: string | null;
        full_name: string | null;
        profile_pic_url: string | null;
        last_message_at: string | null;
        messages_count: number;
        unread_count: number;
        last_message_preview: string | null;
      };
      const contactsPayload: ContactUpsert[] = [];
      for (const conv of rows) {
        scannedConv += 1;
        scannedMsg += conv.message_count ?? 0;

        // Incremental early-stop: once we hit conversations older than cutoff.
        if (cutoff && conv.updated_time && conv.updated_time < cutoff) {
          stopReason = "reached_incremental_cutoff";
        }

        const others = (conv.participants?.data ?? []).filter(
          (p) => String(p.id) !== String(data.pageId),
        );
        const other = others[0] ?? conv.participants?.data?.[0];
        if (!other?.id) continue;

        contactsPayload.push({
          user_id: userId,
          page_id: data.pageId,
          page_name: page.page_name ?? null,
          psid: other.id,
          conversation_id: conv.id,
          full_name: other.name ?? null,
          profile_pic_url: `https://graph.facebook.com/${encodeURIComponent(other.id)}/picture?type=normal`,
          last_message_at: conv.updated_time ?? null,
          messages_count: conv.message_count ?? 0,
          unread_count: conv.unread_count ?? 0,
          last_message_preview: conv.snippet ?? null,
        });
      }

      if (contactsPayload.length > 0) {
        const { error: upErr } = await supabase
          .from("messenger_contacts")
          .upsert(contactsPayload, {
            onConflict: "user_id,page_id,psid",
            ignoreDuplicates: false,
          });
        if (upErr) {
          stopReason = `db_error: ${upErr.message}`;
          break outer;
        }
        upserted += contactsPayload.length;

        // Backfill first_message_at once (only when null).
        const psids = contactsPayload.map((c) => c.psid);
        for (const psid of psids) {
          await supabase
            .from("messenger_contacts")
            .update({ first_message_at: new Date().toISOString() })
            .eq("user_id", userId)
            .eq("page_id", data.pageId)
            .eq("psid", psid)
            .is("first_message_at", null);
        }
      }

      if (stopReason === "reached_incremental_cutoff") break;
      if (scannedConv >= maxConv) {
        stopReason = "hit_max_conversations";
        break;
      }

      const nextCursor = res.paging?.next ? res.paging.cursors?.after ?? null : null;
      if (!nextCursor) {
        stopReason = "end_of_pages";
        break;
      }
      after = nextCursor;
      lastCursor = nextCursor;
    }

    await supabase
      .from("messenger_sync_jobs")
      .update({
        status: stopReason && stopReason.startsWith("graph_error") ? "failed" : "completed",
        finished_at: new Date().toISOString(),
        contacts_upserted: upserted,
        messages_scanned: scannedMsg,
        conversations_scanned: scannedConv,
        cursor: lastCursor,
        error_message: stopReason && stopReason.startsWith("graph_error") ? stopReason : null,
      })
      .eq("id", job.id);

    return {
      jobId: job.id,
      alreadyRunning: false,
      upserted,
      scannedConv,
      scannedMsg,
      stopReason,
    };
  });

// ---------- List contacts (filters + pagination) ----------
const listSchema = z.object({
  pageId: z.string().min(1).max(100).optional(),
  search: z.string().trim().max(120).optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  lastActivity: z
    .enum(["day", "week", "month", "quarter", "inactive_30d", "inactive_90d"])
    .optional(),
  sort: z.enum(["last_message_desc", "last_message_asc", "messages_desc", "name_asc"]).default("last_message_desc"),
  page: z.number().int().min(1).max(500).default(1),
  pageSize: z.number().int().min(10).max(200).default(50),
});

export const listMessengerContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => listSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let query = supabase
      .from("messenger_contacts")
      .select("*", { count: "exact" })
      .eq("user_id", userId);

    if (data.pageId) query = query.eq("page_id", data.pageId);
    if (data.tags && data.tags.length > 0) query = query.overlaps("tags", data.tags);
    if (data.search) query = query.ilike("full_name", `%${data.search}%`);

    const now = Date.now();
    if (data.lastActivity) {
      const map: Record<string, { since?: number; before?: number }> = {
        day: { since: now - MS_24H },
        week: { since: now - 7 * MS_24H },
        month: { since: now - 30 * MS_24H },
        quarter: { since: now - 90 * MS_24H },
        inactive_30d: { before: now - 30 * MS_24H },
        inactive_90d: { before: now - 90 * MS_24H },
      };
      const range = map[data.lastActivity];
      if (range?.since) query = query.gte("last_message_at", new Date(range.since).toISOString());
      if (range?.before) query = query.lte("last_message_at", new Date(range.before).toISOString());
    }

    switch (data.sort) {
      case "last_message_asc":
        query = query.order("last_message_at", { ascending: true, nullsFirst: true });
        break;
      case "messages_desc":
        query = query.order("messages_count", { ascending: false });
        break;
      case "name_asc":
        query = query.order("full_name", { ascending: true });
        break;
      default:
        query = query.order("last_message_at", { ascending: false, nullsFirst: false });
    }

    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;
    const { data: rows, error, count } = await query.range(from, to);
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], total: count ?? 0, page: data.page, pageSize: data.pageSize };
  });

// ---------- Update tags ----------
export const updateMessengerContactTags = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        contactId: z.string().uuid(),
        tags: z.array(z.string().trim().min(1).max(40)).max(20),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("messenger_contacts")
      .update({ tags: data.tags })
      .eq("id", data.contactId)
      .eq("user_id", userId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

// ---------- Send Messenger broadcast (respects 24h window + tags) ----------
export const sendMessengerBroadcast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        pageId: z.string().min(1).max(100),
        contactIds: z.array(z.string().uuid()).min(1).max(500),
        text: z.string().trim().min(1).max(2000),
        messageTag: z.enum(MESSAGE_TAGS).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: contacts, error: cErr } = await supabase
      .from("messenger_contacts")
      .select("id, psid, last_message_at, full_name")
      .eq("user_id", userId)
      .eq("page_id", data.pageId)
      .in("id", data.contactIds);
    if (cErr) throw new Error(cErr.message);
    if (!contacts || contacts.length === 0) throw new Error("No contacts found");

    const now = Date.now();
    const outsideWindow = contacts.filter(
      (c) => !c.last_message_at || now - new Date(c.last_message_at).getTime() > MS_24H,
    );

    if (outsideWindow.length > 0 && !data.messageTag) {
      throw new Error(
        `POLICY_24H_WINDOW: ${outsideWindow.length} recipient(s) are outside the 24h window. A Message Tag is required.`,
      );
    }

    const got = await getPageAccessToken(supabase, userId, data.pageId, [
      "pages_show_list",
      "pages_messaging",
    ]);
    if (!got.ok) throw new Error(got.error.message);

    const results: Array<{ contactId: string; psid: string; ok: boolean; error?: string; messageId?: string }> = [];

    for (const c of contacts) {
      const insideWindow =
        c.last_message_at && now - new Date(c.last_message_at).getTime() <= MS_24H;
      const body: Record<string, unknown> = {
        recipient: { id: c.psid },
        message: { text: data.text },
        messaging_type: insideWindow ? "RESPONSE" : "MESSAGE_TAG",
      };
      if (!insideWindow) body.tag = data.messageTag as MessageTag;

      try {
        const url = `https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(got.pageToken)}`;
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const j = (await r.json()) as { message_id?: string; error?: { message?: string } };
        if (!r.ok || j.error) {
          results.push({ contactId: c.id, psid: c.psid, ok: false, error: j.error?.message ?? `HTTP ${r.status}` });
        } else {
          results.push({ contactId: c.id, psid: c.psid, ok: true, messageId: j.message_id });
          await supabase
            .from("messenger_contacts")
            .update({
              last_direction: "out",
              last_message_preview: data.text.slice(0, 200),
              last_agent_user_id: userId,
              last_message_at: new Date().toISOString(),
            })
            .eq("id", c.id)
            .eq("user_id", userId);
        }
      } catch (err) {
        results.push({
          contactId: c.id,
          psid: c.psid,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const success = results.filter((r) => r.ok).length;
    return { success, failed: results.length - success, total: results.length, results };
  });
