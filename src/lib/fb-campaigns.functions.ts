// Server functions for the Facebook Bulk Campaigns feature.
// All write paths are RLS-scoped to the calling user via requireSupabaseAuth.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildPostToGroupsPayload } from "@/lib/fb-job-payload";

// ---------- Schemas ----------
const saveTemplateSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(20_000),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  mediaIds: z.array(z.string().uuid()).max(10).optional(),
});

const recordMediaSchema = z.object({
  kind: z.enum(["image", "video"]),
  storagePath: z.string().min(1).max(500),
  publicUrl: z.string().url().max(1000),
  name: z.string().min(1).max(300),
  sizeBytes: z.number().int().nonnegative().max(200 * 1024 * 1024),
  mimeType: z.string().max(120).optional(),
});

const saveCampaignSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120),
  // Exactly one of accountId (bot_worker) or graphConnectionId (graph_api) is required.
  accountId: z.string().uuid().nullable().optional(),
  graphConnectionId: z.string().uuid().nullable().optional(),
  postingMode: z.enum(["bot_worker", "graph_api"]).default("bot_worker"),
  contentType: z.enum(["text", "media"]),
  templateId: z.string().uuid().nullable().optional(),
  customText: z.string().trim().max(20_000).nullable().optional(),
  mediaIds: z.array(z.string().uuid()).max(10).optional(),
  targetKind: z.enum(["groups", "pages"]),
  targets: z
    .array(z.object({ id: z.string().min(1).max(100), name: z.string().min(1).max(300) }))
    .min(1)
    .max(50),
  delayMinSeconds: z.number().int().min(10).max(3600),
  delayMaxSeconds: z.number().int().min(10).max(3600),
}).refine((v) => v.delayMaxSeconds >= v.delayMinSeconds, {
  message: "delay_max must be >= delay_min",
  path: ["delayMaxSeconds"],
}).refine(
  (v) => (v.postingMode === "bot_worker" ? !!v.accountId : !!v.graphConnectionId),
  { message: "account required for the chosen posting mode", path: ["accountId"] },
).refine(
  (v) => (v.postingMode === "graph_api" ? v.targetKind === "pages" : true),
  { message: "Graph API mode only supports Pages", path: ["targetKind"] },
);

// ---------- Templates ----------
export const listTextTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("fb_text_templates")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const saveTextTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => saveTemplateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.id) {
      const { data: row, error } = await supabase
        .from("fb_text_templates")
        .update({
          name: data.name,
          content: data.content,
          tags: data.tags ?? [],
          media_ids: data.mediaIds ?? [],
        })
        .eq("id", data.id)
        .eq("user_id", userId)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return row;
    }
    const { data: row, error } = await supabase
      .from("fb_text_templates")
      .insert({
        user_id: userId,
        name: data.name,
        content: data.content,
        tags: data.tags ?? [],
        media_ids: data.mediaIds ?? [],
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteTextTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("fb_text_templates")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Media ----------
export const listMediaAssets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("fb_media_assets")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// Client uploads directly to Storage (with RLS on bucket), then registers the asset row.
export const recordMediaAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => recordMediaSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Storage path MUST start with userId/ (RLS enforces this on storage.objects).
    if (!data.storagePath.startsWith(`${userId}/`)) {
      throw new Error("Invalid storage path");
    }
    const { data: row, error } = await supabase
      .from("fb_media_assets")
      .insert({
        user_id: userId,
        kind: data.kind,
        storage_path: data.storagePath,
        public_url: data.publicUrl,
        name: data.name,
        size_bytes: data.sizeBytes,
        mime_type: data.mimeType ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteMediaAsset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error: fetchErr } = await supabase
      .from("fb_media_assets")
      .select("storage_path")
      .eq("id", data.id)
      .eq("user_id", userId)
      .single();
    if (fetchErr) throw new Error(fetchErr.message);
    await supabase.storage.from("fb-media").remove([row.storage_path]).catch(() => {});
    const { error } = await supabase
      .from("fb_media_assets")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Campaigns ----------
export const listCampaigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("fb_campaigns")
      .select("*, fb_bot_accounts(display_name)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getCampaign = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("fb_campaigns")
      .select("*, fb_bot_accounts(display_name)")
      .eq("id", data.id)
      .eq("user_id", userId)
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const saveCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => saveCampaignSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Verify ownership of the chosen account (bot OR graph connection).
    if (data.postingMode === "bot_worker") {
      const { data: acc } = await supabase
        .from("fb_bot_accounts")
        .select("id")
        .eq("id", data.accountId!)
        .eq("user_id", userId)
        .maybeSingle();
      if (!acc) throw new Error("Bot account not found");
    } else {
      const { data: conn } = await supabase
        .from("facebook_connections")
        .select("id")
        .eq("id", data.graphConnectionId!)
        .eq("user_id", userId)
        .maybeSingle();
      if (!conn) throw new Error("Facebook connection not found");
    }

    if (data.templateId) {
      const { data: t } = await supabase
        .from("fb_text_templates")
        .select("id")
        .eq("id", data.templateId)
        .eq("user_id", userId)
        .maybeSingle();
      if (!t) throw new Error("Template not found");
    }
    if (data.mediaIds && data.mediaIds.length > 0) {
      const { data: m } = await supabase
        .from("fb_media_assets")
        .select("id")
        .in("id", data.mediaIds)
        .eq("user_id", userId);
      if (!m || m.length !== data.mediaIds.length) throw new Error("Media not found");
    }

    const targetIds = data.targets.map((t) => t.id);
    const targetNames = Object.fromEntries(data.targets.map((t) => [t.id, t.name]));

    const payload = {
      name: data.name,
      account_id: data.postingMode === "bot_worker" ? data.accountId! : null,
      graph_connection_id: data.postingMode === "graph_api" ? data.graphConnectionId! : null,
      posting_mode: data.postingMode,
      content_type: data.contentType,
      template_id: data.templateId ?? null,
      custom_text: data.customText ?? null,
      media_ids: data.mediaIds ?? [],
      target_kind: data.targetKind,
      target_ids: targetIds,
      target_names: targetNames,
      delay_min_seconds: data.delayMinSeconds,
      delay_max_seconds: data.delayMaxSeconds,
      total_targets: targetIds.length,
    };

    if (data.id) {
      const { data: row, error } = await supabase
        .from("fb_campaigns")
        .update(payload)
        .eq("id", data.id)
        .eq("user_id", userId)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return row;
    }
    const { data: row, error } = await supabase
      .from("fb_campaigns")
      .insert({ ...payload, user_id: userId, status: "draft" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("fb_campaigns")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const startCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Load the campaign + resolve template content + media URLs.
    const { data: c, error: cErr } = await supabase
      .from("fb_campaigns")
      .select("*")
      .eq("id", data.id)
      .eq("user_id", userId)
      .single();
    if (cErr || !c) throw new Error(cErr?.message ?? "Campaign not found");
    if (!c.target_ids || c.target_ids.length === 0) throw new Error("No targets selected");

    // Graph API mode runs inline (not via VPS worker). Delegate to the dedicated function.
    if (c.posting_mode === "graph_api") {
      const { runGraphCampaign } = await import("./fb-graph-publish.functions");
      return runGraphCampaign({ data: { campaignId: c.id } } as never);
    }

    if (!c.account_id) throw new Error("Campaign missing bot account");

    let content = c.custom_text ?? "";
    if (c.template_id) {
      const { data: t } = await supabase
        .from("fb_text_templates")
        .select("content")
        .eq("id", c.template_id)
        .eq("user_id", userId)
        .maybeSingle();
      if (t?.content) content = t.content;
    }

    let mediaUrls: string[] = [];
    if (c.content_type === "media" && c.media_ids && c.media_ids.length > 0) {
      const { data: m } = await supabase
        .from("fb_media_assets")
        .select("public_url")
        .in("id", c.media_ids)
        .eq("user_id", userId);
      mediaUrls = (m ?? []).map((r) => r.public_url);
    }

    if (!content && mediaUrls.length === 0) {
      throw new Error("Campaign has no content");
    }

    // Create the job (reuses the existing `post_to_groups` worker action).
    const jobPayload = buildPostToGroupsPayload({
      content,
      groupIds: c.target_ids,
      targetKind: (c.target_kind as "groups" | "pages") ?? "groups",
      mediaUrls,
      delayMinSeconds: c.delay_min_seconds,
      delayMaxSeconds: c.delay_max_seconds,
    });

    const { data: job, error: jErr } = await supabase
      .from("fb_jobs")
      .insert({
        user_id: userId,
        account_id: c.account_id,
        campaign_id: c.id,
        job_type: "post_to_groups",
        payload: jobPayload,
        total_items: c.target_ids.length,
        scheduled_at: new Date().toISOString(),
        status: "pending",
      })
      .select("id")
      .single();
    if (jErr) throw new Error(jErr.message);

    await supabase
      .from("fb_campaigns")
      .update({
        status: "queued",
        last_job_id: job.id,
        last_run_at: new Date().toISOString(),
        done_targets: 0,
        success_count: 0,
        failed_count: 0,
      })
      .eq("id", c.id);

    return { jobId: job.id };
  });

export const pauseCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Mark campaign + active job as paused; worker checks this between targets.
    const { data: c } = await supabase
      .from("fb_campaigns")
      .select("last_job_id")
      .eq("id", data.id)
      .eq("user_id", userId)
      .single();
    await supabase.from("fb_campaigns").update({ status: "paused" }).eq("id", data.id).eq("user_id", userId);
    if (c?.last_job_id) {
      await supabase
        .from("fb_jobs")
        .update({ status: "paused" })
        .eq("id", c.last_job_id)
        .eq("user_id", userId);
    }
    return { ok: true };
  });

export const getCampaignResults = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: c } = await supabase
      .from("fb_campaigns")
      .select("last_job_id")
      .eq("id", data.id)
      .eq("user_id", userId)
      .single();
    if (!c?.last_job_id) return { results: [], job: null };
    const [{ data: job }, { data: results }] = await Promise.all([
      supabase.from("fb_jobs").select("*").eq("id", c.last_job_id).single(),
      supabase
        .from("fb_job_results")
        .select("*")
        .eq("job_id", c.last_job_id)
        .order("created_at", { ascending: false }),
    ]);
    return { results: results ?? [], job: job ?? null };
  });
