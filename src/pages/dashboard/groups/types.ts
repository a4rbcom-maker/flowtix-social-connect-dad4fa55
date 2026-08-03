export interface ManagedGroup {
  id: string;
  name: string;
  picture_url: string;
  member_count: string;
  privacy: string;
  role: string;
  last_active: string;
  can_post: boolean;
}

export interface PublishConfig {
  message: string;
  group_ids: string[];
  delay_min: number;
  delay_max: number;
  max_retries: number;
  skip_restricted: boolean;
  max_errors: number;
}

export interface PublishJob {
  id: string;
  status: string;
  config: PublishConfig;
  progress: { published: number; failed: number; skipped: number; current_idx?: number };
  results: { group_id: string; status: string; at: string; reason?: string }[];
}
