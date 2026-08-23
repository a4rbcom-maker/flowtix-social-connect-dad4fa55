export type ExtractionType =
  | "groups"
  | "pages"
  | "post_comments"
  | "post_reactions"
  | "messenger_contacts"
  | "ig_followers"
  | "ig_following"
  | "ig_post_commenters"
  | "ig_hashtag_posts"
  | "ig_profile_info";

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

/** Never overwrite a working profile with a state that lacks the auth tokens —
 *  that would be saving a logged-OUT state over a logged-IN one. */
export function shouldPersistSessionCookies(cookies: CookieEntry[], essentialNames: string[] = ["c_user", "xs"]): boolean {
  const names = new Set(cookies.map((c) => c.name));
  return essentialNames.every((n) => names.has(n));
}

export interface JobContext {
  jobId: string;
  workspaceId: string;
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
