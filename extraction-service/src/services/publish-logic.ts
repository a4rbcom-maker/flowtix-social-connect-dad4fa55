/**
 * Pure logic for the group publish service — no imports, fully unit-testable.
 * Extracted from publish-worker.ts so idempotency/completion rules can be
 * regression-tested without a browser or Supabase.
 */

export type PublishRowStatus = "posted" | "fail" | "skip";

export interface PublishResultRow {
  group_id: string;
  status: PublishRowStatus;
  at: string;
  reason?: string;
  retries?: number;
  batch?: number;
}

/** Group ids this job already SUCCESSFULLY posted into (any previous run). */
export function postedGroupIds(results: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(results)) return out;
  for (const r of results) {
    if (r && typeof r === "object" && (r as any).status === "posted" && typeof (r as any).group_id === "string") {
      out.add((r as any).group_id);
    }
  }
  return out;
}

/**
 * Final job status after the worker loop ends.
 * - `interrupted=false` → the loop reached the end of the group list (failed and
 *   skipped groups count as processed) → "completed".
 * - `interrupted=true` → stopped early (pause / max-errors) → "paused", resumable;
 *   resume skips already-posted groups (idempotency) and retries the rest.
 * Crash leaves the row "running"; boot-time orphan recovery pauses it.
 */
export function computeFinalStatus(interrupted: boolean): "completed" | "paused" {
  return interrupted ? "paused" : "completed";
}
