export interface MessagePacing {
  daily_cap: number;
  rate_per_hour: number;
  delay_min: number;
  delay_max: number;
  batch_size: number;
  batch_pause: number;
  max_errors: number;
  retry_max: number;
}

export const MESSAGE_PACING_DEFAULTS: MessagePacing = {
  daily_cap: 40,
  rate_per_hour: 12,
  delay_min: 45,
  delay_max: 150,
  batch_size: 8,
  batch_pause: 900,
  max_errors: 5,
  retry_max: 2,
};

/** Loose row shapes — DB types for message_jobs/recipients will be added to
 *  database.types.ts on the next supabase gen types; these unblock the UI. */
export interface MessageJobRow {
  id: string;
  status: string;
  progress: { sent?: number; failed?: number; skipped?: number; current_idx?: number; stop_reason?: string | null } | null;
  config: Record<string, unknown> | null;
}

export interface MessageRecipientRow {
  id: string;
  thread_id: string;
  name: string | null;
  status: string;
  attempts: number;
  error: string | null;
  sent_at: string | null;
  sent_via_session_id: string | null;
}

export interface MessageJobDetails {
  job: MessageJobRow;
  recent: MessageRecipientRow[];
}

export interface MessagePreview {
  eligible: number;
  skipped_unsupported: number;
  cold_outreach: boolean;
  source_type: string;
  has_variation: boolean;
  est_days: number;
  sample: string[];
}

export interface StartMessageInput {
  source_job_id: string;
  session_ids: string[];
  name?: string;
  body: string;
  media_keys?: string[];
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
