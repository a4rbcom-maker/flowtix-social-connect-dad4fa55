import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import type { CookieEntry, ExtractedMember, ExtractionType, JobStatus, ProxyConfig, StoredStorageState, StorageStateOrigin } from "../types.js";
import { shouldPersistSessionCookies } from "../types.js";

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
  storage_state_enc: StoredStorageState | string | null;
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

/** Validate + normalize a persisted storage state (jsonb object or legacy JSON
 *  string). Returns null when missing/malformed so callers fall back to the
 *  cookies-only path. */
export function parseStorageState(raw: StoredStorageState | string | null | undefined): StoredStorageState | null {
  if (!raw) return null;
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.cookies) || !Array.isArray(obj.origins)) return null;

  const cookies: CookieEntry[] = [];
  for (const item of obj.cookies) {
    if (item && typeof item === "object" && typeof (item as Record<string, unknown>).name === "string" && typeof (item as Record<string, unknown>).value === "string") {
      const c = item as Record<string, unknown>;
      cookies.push({
        name: String(c.name),
        value: String(c.value),
        domain: typeof c.domain === "string" && c.domain ? c.domain : ".facebook.com",
        path: typeof c.path === "string" && c.path ? c.path : "/",
        expires: typeof c.expires === "number" && c.expires > 0 ? c.expires : undefined,
        httpOnly: !!c.httpOnly,
        secure: c.secure !== false,
        sameSite: mapSameSite(typeof c.sameSite === "string" ? c.sameSite : undefined),
      });
    }
  }
  if (cookies.length === 0 || !shouldPersistSessionCookies(cookies)) return null;

  const origins: StorageStateOrigin[] = [];
  for (const originItem of obj.origins) {
    if (!originItem || typeof originItem !== "object") continue;
    const o = originItem as Record<string, unknown>;
    if (typeof o.origin !== "string" || !Array.isArray(o.localStorage)) continue;
    const entries: Array<{ name: string; value: string }> = [];
    for (const entry of o.localStorage) {
      if (entry && typeof entry === "object") {
        const e = entry as Record<string, unknown>;
        if (typeof e.name === "string" && typeof e.value === "string" && e.name && e.value) {
          entries.push({ name: e.name, value: e.value });
        }
      }
    }
    if (entries.length > 0) origins.push({ origin: o.origin, localStorage: entries });
  }

  return { cookies, origins };
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
    storageState: StoredStorageState | null;
    proxy: ProxyConfig | null;
    userAgent: string | null;
  }> {
    let sessionRes = await sb
      .from("fb_sessions")
      .select("id, name, status, workspace_id, user_id, proxy_url")
      .eq("id", sessionId)
      .is("deleted_at", null)
      .single();

    // Migration 2026082214 not applied yet — retry without proxy_url.
    if (sessionRes.error && sessionRes.error.message.includes("proxy_url")) {
      log.warn("Supabase", `proxy_url column missing (migration 2026082214 pending) — env/global proxy only`);
      sessionRes = await sb
        .from("fb_sessions")
        .select("id, name, status, workspace_id, user_id")
        .eq("id", sessionId)
        .is("deleted_at", null)
        .single();
    }

    const { data: session, error: sErr } = sessionRes;

    if (sErr || !session) {
      throw new ExtractionError(ErrorCodes.SESSION_NOT_FOUND, `Session not found: ${sErr?.message ?? "unknown"}`);
    }

    if (session.status !== "connected") {
      throw new ExtractionError(ErrorCodes.SESSION_NOT_CONNECTED, `الجلسة غير متصلة (الحالة: ${session.status}). يرجى إعادة توصيل الجلسة أولاً.`);
    }

    let profileRes = await sb
      .from("fb_browser_profiles")
      .select("cookies_enc, storage_state_enc, user_agent")
      .eq("session_id", sessionId)
      .single();

    // Migration 2026082210 not applied yet — degrade to cookies-only mode so
    // extraction keeps working until the column exists.
    if (profileRes.error && profileRes.error.message.includes("storage_state_enc")) {
      log.warn("Supabase", `storage_state_enc column missing (migration 2026082210 pending) — cookies-only mode`);
      profileRes = await sb
        .from("fb_browser_profiles")
        .select("cookies_enc, user_agent")
        .eq("session_id", sessionId)
        .single();
    }

    const profileData = profileRes.data as ProfileRow | null;
    if (profileRes.error || !profileData?.cookies_enc) {
      throw new ExtractionError(ErrorCodes.NO_COOKIES, "No cookies found for session");
    }

    const cookies = parseCookiesToPlaywright(profileData.cookies_enc);
    if (cookies.length === 0) {
      throw new ExtractionError(ErrorCodes.NO_COOKIES, "Cookies could not be parsed");
    }

    const storageState = parseStorageState(profileData.storage_state_enc ?? null);

    log.info("Supabase", `session loaded: ${session.name} (status: ${session.status})`, {
      sessionId: session.id,
      cookieCount: cookies.length,
      hasStorageState: !!storageState,
      localStorageOrigins: storageState?.origins.length ?? 0,
    });

    // Resolve proxy: session DB (BYOP) → env.FB_PROXY_{ID} → global PROXY_URL
    const dbProxy = typeof (session as { proxy_url?: unknown }).proxy_url === "string"
      ? ((session as { proxy_url?: string }).proxy_url || "").trim()
      : "";
    const proxy = dbProxy
      ? { url: dbProxy, label: "session-byop" }
      : resolveProxyForSession(session.id);
    if (proxy) {
      log.info("Supabase", `session ${session.id.slice(0, 8)}: proxy resolved (${proxy.label || proxy.url.split('@').pop()})`);
    }

    return { session, cookies, cookieString: toCookieString(cookies), storageState, proxy, userAgent: profileData.user_agent ?? null };
  },

  /** Persist the full browser identity captured from a live context:
   *  rotated cookies into the legacy `cookies_enc` format (frontend compat)
   *  and the complete storage state (cookies + localStorage) into
   *  `storage_state_enc`. Never called with a logged-out cookie set. */
  async persistSessionIdentity(sessionId: string, state: StoredStorageState): Promise<void> {
    if (state.cookies.length === 0) return;
    const legacyCookiesPayload = JSON.stringify(
      state.cookies.map((c) => ({
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
    let { error } = await sb
      .from("fb_browser_profiles")
      .update({ cookies_enc: legacyCookiesPayload, storage_state_enc: state })
      .eq("session_id", sessionId);
    if (error && error.message.includes("storage_state_enc")) {
      // Migration pending — still persist rotated cookies via the legacy column.
      ({ error } = await sb
        .from("fb_browser_profiles")
        .update({ cookies_enc: legacyCookiesPayload })
        .eq("session_id", sessionId));
    }
    if (error) {
      log.warn("Supabase", `persistSessionIdentity failed for ${sessionId.slice(0, 8)}: ${error.message}`);
    } else {
      log.info("Supabase", `session ${sessionId.slice(0, 8)}: identity persisted (${state.cookies.length} cookies, ${state.origins.length} localStorage origins)`);
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

  /** Jobs that finished extraction but were mid-enrichment when the service
   *  died — their enrichment must be re-run by the background queue. */
  async getJobsStuckEnriching(): Promise<string[]> {
    const { data, error } = await sb
      .from("extraction_jobs")
      .select("id")
      .in("status", ["completed", "paused"])
      .eq("progress->>phase", "enriching");
    if (error || !data) return [];
    return data.map((r: { id: string }) => r.id);
  },

  /** Settled jobs holding results whose enrichment NEVER ran (e.g. paused by
   *  a server shutdown mid-extraction, or failed before the enrich step).
   *  Enrichment is mandatory before download, so these are re-enqueued. */
  async getJobsMissingEnrichment(limit = 10): Promise<string[]> {
    const { data, error } = await sb
      .from("extraction_jobs")
      .select("id, progress, result_count")
      .in("status", ["completed", "paused", "canceled", "failed"])
      .gt("result_count", 0)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data
      .filter((r: { progress?: Record<string, unknown> | null }) => !(r.progress as { enrichment?: unknown } | null | undefined)?.enrichment)
      .map((r: { id: string }) => r.id);
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

  async countRunningJobs(userId: string): Promise<number> {
    const { count } = await sb
      .from("extraction_jobs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "running");
    return count ?? 0;
  },

  /** Atomic claim of a queued job into "running": the UPDATE carries its own
   *  status guard (queued → running), so two concurrent starters can never
   *  both succeed — Postgres serializes the row update; the loser updates
   *  zero rows. */
  async tryClaimQueuedJob(jobId: string): Promise<boolean> {
    const { data, error } = await sb
      .from("extraction_jobs")
      .update({ status: "running", started_at: new Date().toISOString(), error: null })
      .eq("id", jobId)
      .eq("status", "queued")
      .select("id");
    if (error) {
      log.error("Supabase", `tryClaimQueuedJob failed: ${error.message}`);
      return false;
    }
    return (data?.length ?? 0) > 0;
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
