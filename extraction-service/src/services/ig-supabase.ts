import { supabaseClient as sb, supabaseService, parseCookiesToPlaywright } from "./supabase.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import type { CookieEntry, ExtractedMember, ProxyConfig } from "../types.js";

const log = logger;

interface IgSessionRow {
  id: string;
  name: string;
  status: string;
  user_id: string;
  ig_username: string | null;
  ig_user_id: string | null;
  avatar_url: string | null;
}

interface IgProfileRow {
  cookies_enc: string | null;
  user_agent: string | null;
}

const IG_CRITICAL_COOKIES = ["sessionid", "ds_user_id", "csrftoken"];

function toCookieString(cookies: CookieEntry[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

function resolveProxyForIgSession(sessionId: string): ProxyConfig | null {
  const cleanId = sessionId.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();
  const perSessionProxy = process.env[`IG_PROXY_${cleanId}`];
  if (perSessionProxy) return { url: perSessionProxy, label: `ig-session:${sessionId.slice(0, 8)}` };

  if (config.proxyUrl) return { url: config.proxyUrl, label: "global" };

  return null;
}

export const igSupabaseService = {
  /** اشتقاق workspace_id لمستخدم IG من fb_sessions ثم extraction_jobs (ig_sessions لا يحوي workspace_id) */
  async resolveIgWorkspaceId(userId: string): Promise<string> {
    const { data: fbSession } = await sb
      .from("fb_sessions")
      .select("workspace_id")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .not("workspace_id", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (fbSession?.workspace_id) return fbSession.workspace_id;

    const { data: job } = await sb
      .from("extraction_jobs")
      .select("workspace_id")
      .eq("user_id", userId)
      .not("workspace_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (job?.workspace_id) return job.workspace_id;

    throw new ExtractionError(
      ErrorCodes.EXTRACTION_FAILED,
      "لا يمكن تحديد مساحة عمل المستخدم. أضف جلسة فيسبوك واحدة على الأقل ثم حاول مجدداً."
    );
  },

  async getIgSessionAndCookies(sessionId: string): Promise<{
    session: IgSessionRow;
    cookies: CookieEntry[];
    cookieString: string;
    proxy: ProxyConfig | null;
    userAgent: string | null;
  }> {
    const { data: session, error: sErr } = await sb
      .from("ig_sessions")
      .select("id, name, status, user_id, ig_username, ig_user_id, avatar_url")
      .eq("id", sessionId)
      .is("deleted_at", null)
      .single();

    if (sErr || !session) {
      throw new ExtractionError(ErrorCodes.SESSION_NOT_FOUND, `IG session not found: ${sErr?.message ?? "unknown"}`);
    }

    if (session.status !== "connected") {
      throw new ExtractionError(ErrorCodes.SESSION_NOT_CONNECTED, `جلسة إنستجرام غير متصلة (الحالة: ${session.status}). يرجى إعادة توصيل الجلسة أولاً.`);
    }

    const { data: profile, error: pErr } = await sb
      .from("ig_browser_profiles")
      .select("cookies_enc, user_agent")
      .eq("session_id", sessionId)
      .single();

    if (pErr || !profile?.cookies_enc) {
      throw new ExtractionError(ErrorCodes.NO_COOKIES, "No cookies found for IG session");
    }

    const cookies = parseCookiesToPlaywright(profile.cookies_enc, ".instagram.com");
    if (cookies.length === 0) {
      throw new ExtractionError(ErrorCodes.NO_COOKIES, "Cookies could not be parsed");
    }

    const missing = IG_CRITICAL_COOKIES.filter((name) => !cookies.some((c) => c.name === name));
    if (missing.length > 0) {
      throw new ExtractionError(ErrorCodes.NO_COOKIES, `IG cookies missing critical values: ${missing.join(", ")}`);
    }

    log.info("IgSupabase", `IG session loaded: ${session.name} (status: ${session.status})`, {
      sessionId: session.id,
      cookieCount: cookies.length,
    });

    const proxy = resolveProxyForIgSession(session.id);
    if (proxy) {
      log.info("IgSupabase", `IG session ${session.id.slice(0, 8)}: proxy resolved (${proxy.label || proxy.url.split("@").pop()})`);
    }

    return { session, cookies, cookieString: toCookieString(cookies), proxy, userAgent: profile.user_agent ?? null };
  },

  /** Persist cookies rotated by Instagram during a browsing session back to the profile row. */
  async updateIgSessionCookies(sessionId: string, cookies: CookieEntry[]): Promise<void> {
    if (cookies.length === 0) return;
    const payload = JSON.stringify(
      cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain || ".instagram.com",
        path: c.path || "/",
        expirationDate: c.expires,
        httpOnly: c.httpOnly ?? false,
        secure: c.secure ?? true,
        sameSite: c.sameSite,
      })),
    );
    const { error } = await sb
      .from("ig_browser_profiles")
      .update({ cookies_enc: payload })
      .eq("session_id", sessionId);
    if (error) {
      log.warn("IgSupabase", `updateIgSessionCookies failed for ${sessionId.slice(0, 8)}: ${error.message}`);
    } else {
      log.info("IgSupabase", `IG session ${sessionId.slice(0, 8)}: rotated cookies persisted (${cookies.length} cookies)`);
    }
  },

  async updateIgSessionStatus(sessionId: string, newStatus: string, reason?: string): Promise<void> {
    const { error } = await sb
      .from("ig_sessions")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", sessionId);
    if (error) log.error("IgSupabase", `updateIgSessionStatus failed: ${error.message}`);
    else if (reason) log.info("IgSupabase", `IG session ${sessionId.slice(0, 8)} status -> ${newStatus}: ${reason}`);
  },

  async storeIgResults(jobId: string, workspaceId: string, results: ExtractedMember[]): Promise<void> {
    await supabaseService.storeResults(jobId, workspaceId, results, "instagram");
  },
};
