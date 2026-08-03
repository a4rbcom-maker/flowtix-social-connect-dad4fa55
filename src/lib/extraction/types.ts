import type { Database } from "@/types/database.types";

export type ExtractionJob = Database["public"]["Tables"]["extraction_jobs"]["Row"];
export type ExtractionJobInsert = Database["public"]["Tables"]["extraction_jobs"]["Insert"];
export type ExtractionResult = Database["public"]["Tables"]["extraction_results"]["Row"];
export type Export = Database["public"]["Tables"]["exports"]["Row"];

export type ExtractionType = Database["public"]["Enums"]["extraction_type"] | "post_comments" | "post_reactions" | "messenger_contacts";
export type JobStatus = Database["public"]["Enums"]["job_status"];
export type ExportFormat = Database["public"]["Enums"]["export_format"];

export type MemberSourceType = "group-members" | "page-followers" | "post-comments" | "post-reactions" | "messenger-contacts";

export const SOURCE_TO_DB_TYPE: Record<MemberSourceType, ExtractionType> = {
  "group-members": "groups",
  "page-followers": "pages",
  "post-comments": "post_comments",
  "post-reactions": "post_reactions",
  "messenger-contacts": "messenger_contacts",
};

export const DB_TO_SOURCE_TYPE: Record<string, MemberSourceType> = {
  groups: "group-members",
  pages: "page-followers",
  post_comments: "post-comments",
  post_reactions: "post-reactions",
  messenger_contacts: "messenger-contacts",
};

export interface StartExtractionInput {
  session_id: string;
  session_ids?: string[];
  type: MemberSourceType;
  source_url: string;
  job_name?: string;
  max_results?: number;
  skip_duplicates?: boolean;
}

export interface ExtractionProgress {
  job_id: string;
  status: JobStatus;
  result_count: number;
  progress: number;
  cursor?: string;
}

export interface ExportResult {
  export_id: string;
  download_url: string;
  row_count: number;
  file_size_bytes: number;
  format: string;
}

export type StopReason =
  | "session_rate_limited"
  | "no_secondary_session"
  | "source_exhausted"
  | "max_results_reached";

export type ExtractionPhase =
  | "navigating"
  | "scrolling"
  | "xhr_replay"
  | "enriching"
  | "completed";

export interface ExtractionJobConfig {
  max_results: number;
  skip_duplicates: boolean;
  session_ids: string[];
  total_followers_count?: number;
  total_followers_source?: string;
  cursor?: string;
}

export interface ExtractionJobProgress {
  discovered: number;
  processed: number;
  duplicates_skipped?: number;
  estimate?: string;
  phase?: ExtractionPhase;
  phase_cycle?: number;
  coverage_rate?: number | null;
  stop_reason?: StopReason | null;
  last_update?: string;
}
