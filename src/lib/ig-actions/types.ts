export type IgActionMode = "mention" | "dm";

export interface IgActionPacing {
  mentions_per_comment: number;
  comments_per_hour: number;
  daily_cap: number;
  rate_per_hour: number;
  delay_min: number;
  delay_max: number;
  batch_size: number;
  batch_pause: number;
  respect_quiet_hours: boolean;
  max_errors: number;
  retry_max: number;
}

/** Defaults MUST match the server (ig-action-pacing.ts) — the UI is advisory;
 *  the server clamps and is the source of truth. */
export const IG_MENTION_DEFAULTS: IgActionPacing = {
  mentions_per_comment: 4,
  comments_per_hour: 8,
  daily_cap: 60,
  rate_per_hour: 8,
  delay_min: 380,
  delay_max: 520,
  batch_size: 6,
  batch_pause: 1800,
  respect_quiet_hours: true,
  max_errors: 5,
  retry_max: 2,
};

/** Two-session optimized config — used when exactly 2 sessions are available */
export const IG_MENTION_TWO_SESSIONS: IgActionPacing = {
  mentions_per_comment: 5, // Maximum allowed by Instagram
  comments_per_hour: 6, // 6 per session = 12 total
  daily_cap: 120, // 60 per session
  rate_per_hour: 6,
  delay_min: 480, // 8 minutes between comments
  delay_max: 600, // 10 minutes between comments
  batch_size: 5, // 5 comments per batch per session
  batch_pause: 600, // 10 minutes between batches
  respect_quiet_hours: true,
  max_errors: 3,
  retry_max: 2,
};

export const IG_DM_DEFAULTS: IgActionPacing = {
  mentions_per_comment: 1,
  comments_per_hour: 5,
  daily_cap: 15,
  rate_per_hour: 5,
  delay_min: 90,
  delay_max: 240,
  batch_size: 5,
  batch_pause: 1800,
  respect_quiet_hours: true,
  max_errors: 5,
  retry_max: 2,
};

export interface IgActionPreview {
  eligible: number;
  skipped_unsupported: number;
  mode: IgActionMode;
  source_type: string;
  cold_outreach: boolean;
  comments_needed: number;
  est_hours: number;
  est_days: number;
  sample: string[];
}

export interface StartIgActionInput {
  source_job_id: string;
  session_ids: string[];
  mode: IgActionMode;
  body: string;
  post_url?: string;
  name?: string;
  mentions_per_comment?: number;
  comments_per_hour?: number;
  daily_cap?: number;
  rate_per_hour?: number;
  delay_min?: number;
  delay_max?: number;
  batch_size?: number;
  batch_pause?: number;
  respect_quiet_hours?: boolean;
  max_errors?: number;
  retry_max?: number;
}

export interface IgActionRecipientRow {
  id: string;
  thread_id: string;
  name: string | null;
  status: string;
  attempts: number;
  error: string | null;
  sent_at: string | null;
  sent_via_session_id: string | null;
}

export interface IgActionJobRow {
  id: string;
  status: string;
  mode: IgActionMode;
  progress: { sent?: number; failed?: number; skipped?: number; current_idx?: number; stop_reason?: string | null } | null;
  config: Record<string, unknown> | null;
}

export interface IgActionJobDetails {
  job: IgActionJobRow;
  recent: IgActionRecipientRow[];
}
