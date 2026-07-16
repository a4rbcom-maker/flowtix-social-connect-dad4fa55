// Facebook Graph API publishing path for fb_campaigns.
// Owns: listing Graph-connected accounts, fetching their pages, and
// publishing a campaign's content to selected pages via the official API.
//
// This is a hard separation from the Puppeteer bot worker path (fb_bot_accounts + fb_jobs
// of type 'post_to_groups'), which is still the only path Meta allows for Groups.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GRAPH = "https://graph.facebook.com/v21.0";

type GraphPage = {
  id: string;
  name: string;
  access_token: string;
  picture?: string | null;
  category?: string | null;
  fan_count?: number | null;
};

async function getUserToken(userId: string, connectionId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("facebook_connections")
    .select("access_token")
    .eq("id", connectionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.access_token) throw new Error("Facebook connection not found or missing token");
  return data.access_token;
}

function humanizeGraphError(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    const e = err as { code?: number; message?: string };
    if (e.code === 190) return "التوكن منتهي أو غير صالح — أعد ربط الحساب. / Token expired or invalid — reconnect the account.";
    if (e.code === 200 || (e.code && e.code >= 200 && e.code <= 299))
      return `صلاحيات ناقصة — أعد الربط وامنح pages_manage_posts. / Missing permission (${e.code}).`;
    if (e.code === 100) return "معرّف الصفحة غير صالح. / Invalid page ID.";
    if (e.code === 4 || e.code === 17 || e.code === 32) return "تم تجاوز حد Meta — انتظر قليلاً. / Meta rate limit — try again later.";
    if (e.message) return e.message;
  }
  return err instanceof Error ? err.message : String(err);
}

// ---------- List Graph-connected accounts (for account picker) ----------
export const listGraphAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("facebook_connections")
      .select("id, fb_user_id, fb_user_name, fb_user_email, last_synced_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { accounts: data ?? [] };
  });

// ---------- Fetch pages managed by a connected account ----------
export const fetchGraphPages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ connectionId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    try {
      const token = await getUserToken(userId, data.connectionId);
      const url = `${GRAPH}/me/accounts?fields=id,name,access_token,category,fan_count,picture{url}&limit=200&access_token=${encodeURIComponent(token)}`;
      const res = await fetch(url);
      const body = (await res.json().catch(() => ({}))) as {
        data?: Array<{
          id: string;
          name: string;
          access_token: string;
          category?: string;
          fan_count?: number;
          picture?: { data?: { url?: string } };
        }>;
        error?: { code?: number; message?: string };
      };
      if (!res.ok || body.error) {
        return { pages: [] as GraphPage[], error: humanizeGraphError(body.error ?? { message: `HTTP ${res.status}` }) };
      }
      const pages: GraphPage[] = (body.data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        access_token: p.access_token,
        category: p.category ?? null,
        fan_count: p.fan_count ?? null,
        picture: p.picture?.data?.url ?? null,
      }));
      return { pages, error: null as string | null };
    } catch (err) {
      return { pages: [] as GraphPage[], error: humanizeGraphError(err) };
    }
  });

// ---------- Publish one post to one page via Graph API ----------
async function publishToPage(
  pageId: string,
  pageToken: string,
  message: string,
  mediaUrls: string[],
): Promise<{ ok: true; postId: string } | { ok: false; error: string }> {
  try {
    // No media → text-only feed post
    if (mediaUrls.length === 0) {
      const res = await fetch(`${GRAPH}/${pageId}/feed`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ message, access_token: pageToken }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        id?: string;
        error?: { code?: number; message?: string };
      };
      if (!res.ok || body.error || !body.id)
        return { ok: false, error: humanizeGraphError(body.error ?? { message: `HTTP ${res.status}` }) };
      return { ok: true, postId: body.id };
    }

    // Single image → /{page-id}/photos
    if (mediaUrls.length === 1) {
      const res = await fetch(`${GRAPH}/${pageId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          url: mediaUrls[0],
          message,
          access_token: pageToken,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        id?: string;
        post_id?: string;
        error?: { code?: number; message?: string };
      };
      if (!res.ok || body.error || !(body.post_id || body.id))
        return { ok: false, error: humanizeGraphError(body.error ?? { message: `HTTP ${res.status}` }) };
      return { ok: true, postId: (body.post_id ?? body.id)! };
    }

    // Multiple images → upload each unpublished, then compose one feed post.
    const uploaded: string[] = [];
    for (const u of mediaUrls) {
      const upRes = await fetch(`${GRAPH}/${pageId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ url: u, published: "false", access_token: pageToken }),
      });
      const upBody = (await upRes.json().catch(() => ({}))) as {
        id?: string;
        error?: { code?: number; message?: string };
      };
      if (!upRes.ok || upBody.error || !upBody.id)
        return { ok: false, error: humanizeGraphError(upBody.error ?? { message: `HTTP ${upRes.status}` }) };
      uploaded.push(upBody.id);
    }
    const attached = uploaded.map((mid, i) => [`attached_media[${i}]`, JSON.stringify({ media_fbid: mid })] as const);
    const params = new URLSearchParams({ message, access_token: pageToken });
    for (const [k, v] of attached) params.append(k, v);
    const res = await fetch(`${GRAPH}/${pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    const body = (await res.json().catch(() => ({}))) as {
      id?: string;
      error?: { code?: number; message?: string };
    };
    if (!res.ok || body.error || !body.id)
      return { ok: false, error: humanizeGraphError(body.error ?? { message: `HTTP ${res.status}` }) };
    return { ok: true, postId: body.id };
  } catch (err) {
    return { ok: false, error: humanizeGraphError(err) };
  }
}

// ---------- Run a Graph-mode campaign inline ----------
// The bot worker never sees these jobs — they execute in-process and stream
// per-page results into fb_job_results / fb_campaigns counters.
export const runGraphCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ campaignId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: c, error: cErr } = await supabase
      .from("fb_campaigns")
      .select("*")
      .eq("id", data.campaignId)
      .eq("user_id", userId)
      .single();
    if (cErr || !c) throw new Error(cErr?.message ?? "Campaign not found");
    if (c.posting_mode !== "graph_api")
      throw new Error("Campaign is not a Graph API campaign");
    if (c.target_kind !== "pages")
      throw new Error("Graph API publishing supports Pages only. Groups require the bot worker.");
    if (!c.graph_connection_id) throw new Error("Campaign missing Facebook connection");
    const targetIds = (c.target_ids ?? []) as string[];
    if (targetIds.length === 0) throw new Error("No target pages selected");

    // Resolve content
    let message = (c.custom_text ?? "").trim();
    if (c.template_id) {
      const { data: t } = await supabase
        .from("fb_text_templates")
        .select("content")
        .eq("id", c.template_id)
        .eq("user_id", userId)
        .maybeSingle();
      if (t?.content) message = t.content;
    }
    let mediaUrls: string[] = [];
    if (c.content_type === "media" && c.media_ids && c.media_ids.length > 0) {
      const { data: m } = await supabase
        .from("fb_media_assets")
        .select("public_url")
        .in("id", c.media_ids as string[])
        .eq("user_id", userId);
      mediaUrls = (m ?? []).map((r) => r.public_url);
    }
    if (!message && mediaUrls.length === 0) throw new Error("Campaign has no content");

    // Fetch page tokens
    const userToken = await getUserToken(userId, c.graph_connection_id);
    const meRes = await fetch(
      `${GRAPH}/me/accounts?fields=id,access_token,name&limit=200&access_token=${encodeURIComponent(userToken)}`,
    );
    const meBody = (await meRes.json().catch(() => ({}))) as {
      data?: Array<{ id: string; name: string; access_token: string }>;
      error?: { code?: number; message?: string };
    };
    if (!meRes.ok || meBody.error) {
      throw new Error(humanizeGraphError(meBody.error ?? { message: `HTTP ${meRes.status}` }));
    }
    const tokenByPage = new Map((meBody.data ?? []).map((p) => [p.id, { token: p.access_token, name: p.name }]));

    // Create job row (running)
    const { data: job, error: jErr } = await supabase
      .from("fb_jobs")
      .insert({
        user_id: userId,
        account_id: null,
        campaign_id: c.id,
        job_type: "publish_pages_graph",
        payload: { pages: targetIds, mode: "graph_api" },
        total_items: targetIds.length,
        scheduled_at: new Date().toISOString(),
        status: "running",
      })
      .select("id")
      .single();
    if (jErr || !job) throw new Error(jErr?.message ?? "Failed to create job");

    await supabase
      .from("fb_campaigns")
      .update({
        status: "running",
        last_job_id: job.id,
        last_run_at: new Date().toISOString(),
        done_targets: 0,
        success_count: 0,
        failed_count: 0,
      })
      .eq("id", c.id);

    const delayMin = Math.max(0, c.delay_min_seconds ?? 0);
    const delayMax = Math.max(delayMin, c.delay_max_seconds ?? delayMin);
    let success = 0;
    let failed = 0;
    const targetNames = (c.target_names ?? {}) as Record<string, string>;

    for (let i = 0; i < targetIds.length; i++) {
      const pid = targetIds[i];
      const entry = tokenByPage.get(pid);
      let result: { ok: true; postId: string } | { ok: false; error: string };
      if (!entry) {
        result = {
          ok: false,
          error: "لم يتم العثور على توكن هذه الصفحة — تأكد أنك أدمن فيها ومنحت pages_manage_posts. / No page token; make sure you admin this page and granted pages_manage_posts.",
        };
      } else {
        result = await publishToPage(pid, entry.token, message, mediaUrls);
      }

      if (result.ok) success++; else failed++;

      await supabase.from("fb_job_results").insert({
        job_id: job.id,
        target: pid,
        status: result.ok ? "success" : "failed",
        error: result.ok ? null : result.error,
        data: result.ok
          ? { post_id: result.postId, page_name: entry?.name ?? targetNames[pid] ?? null }
          : { page_name: entry?.name ?? targetNames[pid] ?? null },
      });

      await supabase
        .from("fb_campaigns")
        .update({
          done_targets: i + 1,
          success_count: success,
          failed_count: failed,
        })
        .eq("id", c.id);

      // Delay between targets (skip on last)
      if (i < targetIds.length - 1) {
        const secs =
          delayMin === delayMax ? delayMin : delayMin + Math.floor(Math.random() * (delayMax - delayMin + 1));
        if (secs > 0) await new Promise((r) => setTimeout(r, secs * 1000));
      }
    }

    const finalStatus = failed === 0 ? "completed" : success === 0 ? "failed" : "completed";
    await supabase
      .from("fb_jobs")
      .update({ status: finalStatus, completed_at: new Date().toISOString() })
      .eq("id", job.id);
    await supabase
      .from("fb_campaigns")
      .update({ status: finalStatus === "completed" ? "completed" : "failed" })
      .eq("id", c.id);

    return { jobId: job.id, success, failed, total: targetIds.length };
  });
