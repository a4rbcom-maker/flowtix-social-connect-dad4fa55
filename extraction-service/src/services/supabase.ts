import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import type { CookieEntry, ExtractedMember, ExtractionType, JobStatus, ProxyConfig } from "../types.js";

const log = logger;

const sb = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
});

export { sb as supabaseClient };

interface SessionRow {
  id: string;
  name: string;
  status: string;
  workspace_id: string;
  user_id: string;
}

interface ProfileRow {
  cookies_enc: string | null;
  user_agent: string | null;
}

interface JobRow {
  id: string;
  status: string;
  result_count: number;
  config: Record<string, unknown> | null;
  progress: Record<string, unknown> | null;
  error: string | null;
  workspace_id: string;
  user_id: string;
  type: string;
  source: string;
  name: string;
  started_at: string | null;
  completed_at: string | null;
}

function mapSameSite(v: string | undefined): "Strict" | "Lax" | "None" | undefined {
  if (!v) return undefined;
  const lower = v.toLowerCase();
  if (lower === "no_restriction" || lower === "none") return "None";
  if (lower === "lax") return "Lax";
  if (lower === "strict") return "Strict";
  return undefined;
}

export function parseCookiesToPlaywright(raw: string, defaultDomain = ".facebook.com"): CookieEntry[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      const cookies: CookieEntry[] = [];
      for (const item of arr) {
        if (item && typeof item === "object" && item.name && item.value) {
          cookies.push({
            name: String(item.name),
            value: String(item.value),
            domain: item.domain || defaultDomain,
            path: item.path || "/",
            expires: item.expirationDate ? Number(item.expirationDate) : undefined,
            httpOnly: !!item.httpOnly,
            secure: item.secure !== false,
            sameSite: mapSameSite(item.sameSite),
          });
        }
      }
      if (cookies.length > 0) return cookies;
    } catch { /* fall through */ }
  }

  if (trimmed.includes("\t")) {
    const cookies: CookieEntry[] = [];
    for (const line of trimmed.split("\n")) {
      const parts = line.trim().split("\t");
      if (parts.length >= 7) {
        cookies.push({
          name: parts[5].trim(),
          value: parts[6].trim(),
          domain: parts[0] || defaultDomain,
          path: parts[2] || "/",
          secure: parts[3] === "TRUE",
        });
      }
    }
    if (cookies.length > 0) return cookies;
  }

  if (trimmed.includes("=")) {
    const cookies: CookieEntry[] = [];
    for (const part of trimmed.split(";")) {
      const eq = part.trim().indexOf("=");
      if (eq > 0) {
        cookies.push({
          name: part.trim().substring(0, eq).trim(),
          value: part.trim().substring(eq + 1).trim(),
          domain: defaultDomain,
          path: "/",
        });
      }
    }
    if (cookies.length > 0) return cookies;
  }

  return [];
}

function toCookieString(cookies: CookieEntry[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

export const supabaseService = {
  async getSessionAndCookies(sessionId: string): Promise<{
    session: SessionRow;
    cookies: CookieEntry[];
    cookieString: string;
    proxy: ProxyConfig | null;
    userAgent: string | null;
  }> {
    const { data: session, error: sErr } = await sb
      .from("fb_sessions")
      .select("id, name, status, workspace_id, user_id")
      .eq("id", sessionId)
      .is("deleted_at", null)
      .single();

    if (sErr || !session) {
      throw new ExtractionError(ErrorCodes.SESSION_NOT_FOUND, `Session not found: ${sErr?.message ?? "unknown"}`);
    }

    if (session.status !== "connected") {
      throw new ExtractionError(ErrorCodes.SESSION_NOT_CONNECTED, `الجلسة غير متصلة (الحالة: ${session.status}). يرجى إعادة توصيل الجلسة أولاً.`);
    }

    const { data: profile, error: pErr } = await sb
      .from("fb_browser_profiles")
      .select("cookies_enc, user_agent")
      .eq("session_id", sessionId)
      .single();

    if (pErr || !profile?.cookies_enc) {
      throw new ExtractionError(ErrorCodes.NO_COOKIES, "No cookies found for session");
    }

    const cookies = parseCookiesToPlaywright(profile.cookies_enc);
    if (cookies.length === 0) {
      throw new ExtractionError(ErrorCodes.NO_COOKIES, "Cookies could not be parsed");
    }

    log.info("Supabase", `session loaded: ${session.name} (status: ${session.status})`, {
      sessionId: session.id,
      cookieCount: cookies.length,
    });

    // Resolve proxy: check session config → env.FB_PROXY_{ID} → global PROXY_URL
    const proxy = resolveProxyForSession(session.id);
    if (proxy) {
      log.info("Supabase", `session ${session.id.slice(0, 8)}: proxy resolved (${proxy.label || proxy.url.split('@').pop()})`);
    }

    return { session, cookies, cookieString: toCookieString(cookies), proxy, userAgent: profile.user_agent ?? null };
  },

  /** Persist cookies rotated by Facebook during a browsing session back to the profile row.
   *  Without this the stored `xs` token goes stale and Facebook invalidates the whole session. */
  async updateSessionCookies(sessionId: string, cookies: CookieEntry[]): Promise<void> {
    if (cookies.length === 0) return;
    const payload = JSON.stringify(
      cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expirationDate: c.expires,
        httpOnly: c.httpOnly ?? false,
        secure: c.secure ?? true,
        sameSite: c.sameSite,
      })),
    );
    const { error } = await sb
      .from("fb_browser_profiles")
      .update({ cookies_enc: payload })
      .eq("session_id", sessionId);
    if (error) {
      log.warn("Supabase", `updateSessionCookies failed for ${sessionId.slice(0, 8)}: ${error.message}`);
    } else {
      log.info("Supabase", `session ${sessionId.slice(0, 8)}: rotated cookies persisted (${cookies.length} cookies)`);
    }
  },

  async createJob(params: {
    workspaceId: string;
    userId: string;
    type: ExtractionType;
    source: string;
    name: string;
    config: Record<string, unknown>;
    status?: string;
  }): Promise<JobRow> {
    const { data, error } = await sb
      .from("extraction_jobs")
      .insert({
        workspace_id: params.workspaceId,
        user_id: params.userId,
        type: params.type,
        source: params.source,
        name: params.name,
        config: params.config,
        status: params.status || "running",
        started_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw new ExtractionError(ErrorCodes.EXTRACTION_FAILED, `Create job failed: ${error.message}`);
      return data as JobRow;
  },

  async getJob(jobId: string): Promise<JobRow> {
    const { data, error } = await sb
      .from("extraction_jobs")
      .select("*")
      .eq("id", jobId)
      .single();
    if (error) throw new ExtractionError(ErrorCodes.EXTRACTION_FAILED, `Job not found: ${error.message}`);
    return data as JobRow;
  },

  async updateJob(jobId: string, updates: Record<string, unknown>): Promise<void> {
    const { error } = await sb
      .from("extraction_jobs")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", jobId);
    if (error) log.error("Supabase", `updateJob failed: ${error.message}`);
  },

  async incrementJobResultCount(jobId: string, delta: number): Promise<void> {
    const { error } = await sb.rpc("increment_job_result_count", { job_id: jobId, delta });
    if (error) {
      const { data } = await sb.from("extraction_jobs").select("result_count").eq("id", jobId).single();
      const next = (data?.result_count || 0) + delta;
      await this.updateJob(jobId, { result_count: next });
    }
  },

  async failJob(jobId: string, errorMessage: string): Promise<void> {
    await this.updateJob(jobId, {
      status: "failed",
      error: errorMessage,
      completed_at: new Date().toISOString(),
    });
  },

  async storeProgress(jobId: string, progress: Record<string, unknown>): Promise<void> {
    await this.updateJob(jobId, { progress, updated_at: new Date().toISOString() });
  },

  async getJobResults(jobId: string): Promise<any[]> {
    const PAGE_SIZE = 1000;
    const allData: any[] = [];
    let offset = 0;
    while (true) {
      const { data, error } = await sb
        .from("extraction_results")
        .select("fb_id, data, metadata, platform")
        .eq("job_id", jobId)
        .order("created_at", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw new ExtractionError(ErrorCodes.EXTRACTION_FAILED, `Get results failed: ${error.message}`);
      if (!data || data.length === 0) break;
      allData.push(...data);
      if (data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    return allData;
  },

  async storeResults(jobId: string, workspaceId: string, results: ExtractedMember[], platform: string = "facebook"): Promise<void> {
    if (results.length === 0) return;
    const rows = results.map((r) => ({
      job_id: jobId,
      workspace_id: workspaceId,
      platform,
      fb_id: r.fb_id,
      fb_type: r.type,
      data: {
        name: r.name,
        profile_url: r.profile_url,
        avatar_url: r.avatar_url,
        ...(r.username ? { username: r.username } : {}),
        ...(r.full_name ? { full_name: r.full_name } : {}),
        ...(r.comment_text ? { comment_text: r.comment_text } : {}),
        ...(r.comment_id ? { comment_id: r.comment_id } : {}),
        ...(r.comments_count ? { comments_count: r.comments_count } : {}),
        ...(r.bio_email ? { bio_email: r.bio_email } : {}),
        ...(r.bio_phone ? { bio_phone: r.bio_phone } : {}),
      },
      metadata: {},
    }));
    const { error } = await sb.from("extraction_results").insert(rows);
    if (error) throw new ExtractionError(ErrorCodes.EXTRACTION_FAILED, `Store results failed: ${error.message}`);
  },

  async getExistingIds(workspaceId: string, fbIds: string[]): Promise<Set<string>> {
    if (fbIds.length === 0) return new Set();
    const { data, error } = await sb
      .from("extraction_results")
      .select("fb_id")
      .eq("workspace_id", workspaceId)
      .in("fb_id", fbIds);
    if (error || !data) return new Set();
    return new Set(data.map((r: { fb_id: string }) => r.fb_id));
  },

  async getJobResultsForEnrichment(jobId: string): Promise<{ id: string; fb_id: string; data: Record<string, unknown>; platform?: string }[]> {
    const PAGE_SIZE = 1000;
    const allData: { id: string; fb_id: string; data: Record<string, unknown>; platform?: string }[] = [];
    let offset = 0;
    while (true) {
      const { data, error } = await sb
        .from("extraction_results")
        .select("id, fb_id, data, platform")
        .eq("job_id", jobId)
        .not("fb_id", "is", null)
        .order("created_at", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error || !data) {
        log.error("Supabase", `getJobResultsForEnrichment error at offset ${offset}: ${error?.message}`);
        break;
      }
      allData.push(...data);
      if (data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    log.info("Supabase", `getJobResultsForEnrichment: ${allData.length} results fetched for job ${jobId.slice(0, 8)}`);
    return allData;
  },

  async updateResultMetadataBatch(jobId: string, updates: { id: string; metadata: Record<string, unknown> }[]): Promise<void> {
    let successCount = 0;
    let failCount = 0;
    for (const batch of chunk(updates, 50)) {
      const results = await Promise.all(
        batch.map((u) =>
          sb
            .from("extraction_results")
            .update({ metadata: u.metadata })
            .eq("id", u.id)
            .eq("job_id", jobId)
            .then((res) => ({ id: u.id, error: res.error }))
        )
      );
      for (const r of results) {
        if (r.error) {
          failCount++;
          log.error("Supabase", `updateResultMetadata failed for ${r.id}: ${r.error.message}`);
        } else {
          successCount++;
        }
      }
    }
    log.info("Supabase", `updateResultMetadataBatch: ${successCount} updated, ${failCount} failed`);
  },

  async updateSessionStatus(sessionId: string, newStatus: string, reason?: string): Promise<void> {
    const { error } = await sb.rpc("transition_fb_session_status", {
      p_session_id: sessionId,
      p_new_status: newStatus,
      p_reason: reason ?? null,
      p_metadata: {},
    });
    if (error) log.error("Supabase", `transition_fb_session_status failed: ${error.message}`);
  },

  async updateSessionFbUserId(sessionId: string, fbUserId: string): Promise<void> {
    const { error } = await sb
      .from("fb_sessions")
      .update({ fb_user_id: fbUserId })
      .eq("id", sessionId);
    if (error) log.error("Supabase", `updateSessionFbUserId failed: ${error.message}`);
  },

  async getJobStatus(jobId: string): Promise<JobStatus | null> {
    const { data, error } = await sb
      .from("extraction_jobs")
      .select("status")
      .eq("id", jobId)
      .single();
    if (error || !data) return null;
    return data.status as JobStatus;
  },

  async getOldestQueuedJob(userId: string): Promise<{ id: string; config: Record<string, unknown> | null } | null> {
    const { data } = await sb
      .from("extraction_jobs")
      .select("id, config")
      .eq("user_id", userId)
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(1);
    if (!data || data.length === 0) return null;
    return data[0] as { id: string; config: Record<string, unknown> | null };
  },

  async countQueuedJobs(userId: string): Promise<number> {
    const { count } = await sb
      .from("extraction_jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "queued");
    return count ?? 0;
  },

  async getQueuedJobUserIds(): Promise<string[]> {
    const { data } = await sb
      .from("extraction_jobs")
      .select("user_id")
      .eq("status", "queued")
      .order("created_at", { ascending: true });
    if (!data) return [];
    return Array.from(new Set(data.map((r: { user_id: string }) => r.user_id)));
  },

  async pauseAllRunningJobs(reason: string): Promise<void> {
    const { error } = await sb
      .from("extraction_jobs")
      .update({ status: "paused", error: reason, updated_at: new Date().toISOString() })
      .eq("status", "running");
    if (error) log.error("Supabase", `pauseAllRunningJobs failed: ${error.message}`);
  },

  async cleanupOrphanedJobs(): Promise<number> {
    const { data, error } = await sb
      .from("extraction_jobs")
      .update({ status: "failed", error: "Service restarted - job was interrupted", completed_at: new Date().toISOString() })
      .eq("status", "running")
      .select("id");
    if (error) { log.error("Supabase", `cleanupOrphanedJobs failed: ${error.message}`); return 0; }
    return data?.length || 0;
  },

  async hasActiveJob(userId: string, excludeJobId?: string, statuses: string[] = ["running", "paused"]): Promise<{ active: boolean; jobId?: string; jobName?: string; jobStatus?: string }> {
    const buildQuery = (statusList: string[]) => {
      let q = sb
        .from("extraction_jobs")
        .select("id, name, status")
        .eq("user_id", userId)
        .in("status", statusList);
      if (excludeJobId) {
        q = q.neq("id", excludeJobId);
      }
      return q.limit(1);
    };

    if (statuses.includes("running")) {
      const { data: running } = await buildQuery(["running"]);
      if (running && running.length > 0) {
        return { active: true, jobId: running[0].id, jobName: running[0].name, jobStatus: running[0].status };
      }
    }

    if (statuses.includes("paused")) {
      const { data: paused } = await buildQuery(["paused"]);
      if (paused && paused.length > 0) {
        return { active: true, jobId: paused[0].id, jobName: paused[0].name, jobStatus: paused[0].status };
      }
    }

    return { active: false };
  },
};

function resolveProxyForSession(sessionId: string): ProxyConfig | null {
  // Per-session proxy via env var: FB_PROXY_{SESSION_ID}=http://user:pass@host:port
  const cleanId = sessionId.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();
  const perSessionProxy = process.env[`FB_PROXY_${cleanId}`];
  if (perSessionProxy) return { url: perSessionProxy, label: `session:${sessionId.slice(0, 8)}` };

  // Global proxy URL from config
  if (config.proxyUrl) return { url: config.proxyUrl, label: "global" };

  return null;
}
