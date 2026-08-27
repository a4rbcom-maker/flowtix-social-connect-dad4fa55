/** IG followers stop-reason + coverage gate — pure decision module.
 *
 *  Extracted from ig-followers.ts so the failure taxonomy is testable
 *  without Playwright. The extractor classifies every exit path into one
 *  of these reasons; progress.stop_reason is internal (never surfaced to
 *  end users, who only see phase/extracted/coverage). */

export type IgStopReason =
  | "api_list_exhausted"
  | "dom_dialog_exhausted"
  | "all_sessions_stagnant"
  | "max_results_reached"
  | "canceled"
  | "platform_limit";

/** Why an exit path is resumable: the platform did not cap us, we just
 *  stopped early (throttle/rotation/failure). Only `api_list_exhausted`,
 *  `dom_dialog_exhausted` after a full second patience cycle with zero
 *  rows ever beyond the last, and explicit platform limits are final. */
export const RESUMABLE_STOP_REASONS: ReadonlySet<IgStopReason> = new Set([
  "all_sessions_stagnant",
  "dom_dialog_exhausted",
]);

export interface CoverageGateInput {
  stored: number;
  total: number | null;
}

export interface CoverageGateResult {
  /** Fraction 0–100 as the extractor reports it (null when total unknown). */
  coverage: number | null;
  /** true → allowed to mark job completed; false → job should pause with cursor. */
  allowComplete: boolean;
  reason: "exhausted" | "coverage_met" | "below_target" | "total_unknown" | "zero_total";
}

const DEFAULT_MIN_COVERAGE = 70;

/** Minimum coverage required to declare a partial harvest "completed".
 *  Below it, jobs must pause (resumable) instead of silently completing —
 *  the exact failure mode that produced 51/27800 marked done. */
export function minCoverageToComplete(): number {
  return DEFAULT_MIN_COVERAGE;
}

/** Evaluate whether a finished extraction may be declared complete.
 *  `allowComplete=false` means: return nextCursor / paused to the caller. */
export function evaluateCoverageGate(input: CoverageGateInput): CoverageGateResult {
  const { stored, total } = input;
  if (!total || total <= 0) {
    // Unknown/zero total: cannot judge coverage — treat as exhausted so
    // normal small lists never hang pausable forever.
    return { coverage: null, allowComplete: true, reason: !total ? "total_unknown" : "zero_total" };
  }
  const coverage = Math.min(100, Math.round((stored / total) * 100));
  if (coverage >= minCoverageToComplete()) {
    return { coverage, allowComplete: true, reason: "coverage_met" };
  }
  if (stored <= 0) {
    // Nothing harvested at all — a hard block or private account style
    // outcome; completion is meaningless but there is nothing to resume
    // either. Callers handle this before the gate (failJob).
    return { coverage, allowComplete: true, reason: "zero_total" };
  }
  return { coverage, allowComplete: false, reason: "below_target" };
}

/** Classify a DOM-scroll exhaustion signal into a stop reason.
 *  `rowsEverSeen` > 0 means the dialog at least rendered some users. */
export function classifyDomExhaustion(rowsEverSeen: number): IgStopReason {
  return rowsEverSeen > 0 ? "dom_dialog_exhausted" : "all_sessions_stagnant";
}
