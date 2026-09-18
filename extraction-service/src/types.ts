export type ExtractionType =
  | "groups"
  | "pages"
  | "post_comments"
  | "post_reactions"
  | "messenger_contacts"
  | "ig_followers"
  | "ig_following"
  | "ig_post_commenters"
  | "ig_post_engagers"
  | "ig_hashtag_posts"
  | "ig_profile_info"
  | "ig_user_search";

export type AuthState = "authenticated" | "needs_login" | "restricted" | "unknown";

export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "paused"
  | "canceled";

export interface ExtractRequest {
  session_id: string;
  type: ExtractionType;
  source_url: string;
  job_name?: string;
  max_results?: number;
  skip_duplicates?: boolean;
  cursor?: string;
  job_id?: string;
}

export interface ExtractionProgress {
  job_id: string;
  status: JobStatus;
  result_count: number;
  progress: number;
  cursor?: string;
  error?: string;
  error_code?: string;
}

export interface SessionCheckResult {
  session_id: string;
  status: string;
  auth_state: AuthState;
  message: string;
  fb_user_id?: string;
}

export interface ExtractedMember {
  fb_id: string;
  name: string;
  profile_url: string;
  avatar_url?: string;
  type: string;
  comment_text?: string;
  comment_id?: string;
  username?: string;
  full_name?: string;
  bio_email?: string;
  bio_phone?: string;
  comments_count?: number;
}

export interface CookieEntry {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export interface StorageStateOrigin {
  origin: string;
  localStorage: Array<{ name: string; value: string }>;
}

/** Playwright-compatible storage state persisted per session so every run
 *  restores the SAME browser identity (cookies + localStorage). */
export interface StoredStorageState {
  cookies: CookieEntry[];
  origins: StorageStateOrigin[];
}

/**
 * A cookie set is only worth persisting when it still PROVES the same identity
 * Facebook already trusts.
 *
 * Facebook answers an expired/refused session with a login page whose cookie
 * jar still carries `c_user` and `xs` keys — empty or freshly minted. Checking
 * names alone therefore accepted that dead jar and wrote it over a live
 * session, which is what forced our users into a logout on their next task.
 * Names are not proof; validity is: a numeric user id, a non-trivial `xs`, no
 * expired auth cookie, and the `datr` device cookie a real browsing session
 * always carries.
 */
export function shouldPersistSessionCookies(cookies: CookieEntry[], essentialNames: string[] = ["c_user", "xs"]): boolean {
  // Callers hand us whatever the capture returned — a failed capture yields
  // undefined. Treat that as "no proof of identity", never as an exception.
  if (!Array.isArray(cookies) || cookies.length === 0) return false;

  const byName = new Map(cookies.map((c) => [c.name, c]));
  if (!essentialNames.every((n) => byName.has(n))) return false;

  if (!/^\d{6,}$/.test(byName.get("c_user")?.value ?? "")) return false;
  if ((byName.get("xs")?.value ?? "").length < 8) return false;

  const nowSec = Math.floor(Date.now() / 1000);
  for (const name of essentialNames) {
    const expires = byName.get(name)?.expires;
    // undefined/0 means a session cookie — valid for this run.
    if (typeof expires === "number" && expires > 0 && expires < nowSec) return false;
  }

  // A login-page capture never carries `datr`; a real browsing session does.
  return byName.has("datr");
}

export interface JobContext {
  jobId: string;
  workspaceId: string;
  /** Owning user — the live dedup/ownership scope since workspaces were
   *  removed (migration 2026072716). */
  userId: string;
  sessionId: string;
  type: ExtractionType;
  sourceUrl: string;
  maxResults: number;
  skipDuplicates: boolean;
  cursor?: string;
}

export interface HealthStatus {
  status: "ok" | "shutting_down";
  version: string;
  uptime: number;
  browsers: { total: number; active: number };
  contexts: { active: number };
  queue: { pending: number; size: number };
  memory: NodeJS.MemoryUsage;
}

export interface ProxyConfig {
  /** proxy URL: http://user:pass@host:port or socks5://host:port */
  url: string;
  /** optional friendly name for logging (e.g. "IPRoyal-res-1") */
  label?: string;
}

export interface SessionHealthSnapshot {
  session_id: string;
  state: "healthy" | "degraded" | "unavailable" | "recovery";
  failures: number;
  last_failure_kind?: string;
  last_failure_detail?: string;
}

export interface SourceProgressSnapshot {
  users: number;
  rate_per_min: number;
  duration_ms: number;
  errors: number;
  requests: number;
  stop_reason: string | null;
}

export interface OrchestratorCheckpoint {
  sources_done: string[];
  seen_count: number;
  posts_done?: number;
  saved_at: string;
}
