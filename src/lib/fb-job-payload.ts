// Canonical shape of the `payload` JSON column for jobs of type
// `post_to_groups`. This is the SINGLE source of truth shared between:
//   - createPostJob (single-post flow in fb-bot.functions.ts)
//   - startCampaign (bulk-campaign flow in fb-campaigns.functions.ts)
//   - the VPS worker that consumes fb_jobs.payload
//
// Naming convention: camelCase (matches the existing worker contract).
// Any new field MUST be added here and in both producers + the worker.

import { z } from "zod";

/**
 * Zod schema for the post_to_groups job payload.
 * Producers should build payloads with `buildPostToGroupsPayload` and consumers
 * (e.g. tests, worker mirrors) can parse with this schema.
 */
export const postToGroupsPayloadSchema = z.object({
  /** Text content for the post. May be empty when mediaUrls is non-empty. */
  content: z.string().default(""),
  /** Facebook group OR page IDs to post into (resolved by `targetKind`). */
  groupIds: z.array(z.string().min(1).max(100)).min(1).max(500),
  /** Target type — "groups" (default, legacy) or "pages". */
  targetKind: z.enum(["groups", "pages"]).default("groups"),
  /** Public URLs of media assets to attach. Empty array when text-only. */
  mediaUrls: z.array(z.string().url()).default([]),
  /** Lower bound for the random delay between posts, in SECONDS. */
  delayMinSeconds: z.number().int().min(10).max(3600),
  /** Upper bound for the random delay between posts, in SECONDS. */
  delayMaxSeconds: z.number().int().min(10).max(3600),
  /**
   * Legacy field used by older worker versions that only understood minutes.
   * Keep populating for backwards compat until all workers ship the new schema.
   */
  intervalMinutes: z.number().int().min(1).max(1440),
});

export type PostToGroupsJobPayload = z.infer<typeof postToGroupsPayloadSchema>;

/** Producer input — only the canonical inputs; defaults are filled in. */
export interface BuildPostToGroupsPayloadInput {
  content?: string | null;
  groupIds: string[];
  targetKind?: "groups" | "pages";
  mediaUrls?: string[];
  delayMinSeconds?: number;
  delayMaxSeconds?: number;
  /** Optional legacy override. If omitted, derived from delayMinSeconds. */
  intervalMinutes?: number;
}

const DEFAULT_DELAY_MIN_SECONDS = 60;
const DEFAULT_DELAY_MAX_SECONDS = 120;

/**
 * Build a canonical post_to_groups payload with safe defaults for all fields.
 * Use this in EVERY producer of fb_jobs rows with job_type="post_to_groups".
 */
export function buildPostToGroupsPayload(
  input: BuildPostToGroupsPayloadInput,
): PostToGroupsJobPayload {
  const delayMinSeconds = input.delayMinSeconds ?? DEFAULT_DELAY_MIN_SECONDS;
  const delayMaxSeconds = Math.max(
    input.delayMaxSeconds ?? DEFAULT_DELAY_MAX_SECONDS,
    delayMinSeconds,
  );
  const intervalMinutes =
    input.intervalMinutes ?? Math.max(1, Math.round(delayMinSeconds / 60));

  return {
    content: (input.content ?? "").trim(),
    groupIds: input.groupIds,
    targetKind: input.targetKind ?? "groups",
    mediaUrls: input.mediaUrls ?? [],
    delayMinSeconds,
    delayMaxSeconds,
    intervalMinutes,
  };
}
