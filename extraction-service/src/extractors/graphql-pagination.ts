/**
 * Pure, browser-independent GraphQL pagination loop for FB post
 * reactions/comments extraction.
 *
 * The loop authority is Facebook's own `page_info` (end_cursor / has_next_page)
 * harvested from the captured GraphQL request — NOT scroll heuristics. The
 * browser-dependent bits (capturing the request, replaying it in-page) are
 * injected via callbacks so this module is fully unit-testable without a
 * browser.
 *
 * See plan: .hermes/plans/2026-08-26_155505-fb-post-comments-reactions-extraction-fix.md
 */

import type { ExtractedMember } from "../types.js";

export type { ExtractedMember };

export interface PageData {
  /** Users found on this page (already shape-normalised to ExtractedMember). */
  users: ExtractedMember[];
  /** Next cursor (end_cursor / after), or null when the page had none. */
  cursor: string | null;
  /** Whether Facebook reported more pages after this one. */
  hasNext: boolean;
}

export type PaginateStopReason =
  | "max_results_reached"
  | "has_next_page_false"
  | "budget_exhausted"
  | "canceled"
  | "empty_pages_exhausted"
  | "replay_error";

export interface PaginateCallbacks {
  /** Fetch one page. cursor=null fetches the first page. Returns parsed users + pagination info. */
  fetchPage: (cursor: string | null) => Promise<PageData>;
  /** Persist a batch of users; returns how many were actually stored (after DB dedup). */
  store: (users: ExtractedMember[]) => Promise<number>;
  /** Optional: when it returns true, the loop aborts (job budget / cancel). */
  shouldAbort?: () => boolean | Promise<boolean>;
  /** Optional live telemetry hook (logging / progress). */
  onPage?: (info: {
    page: number;
    added: number;
    total: number;
    cursor: string | null;
    hasNext: boolean;
  }) => void;
}

export interface PaginateConfig {
  maxResults: number;
  /** Resume cursor (first page already consumed client-side). */
  seedCursor?: string | null;
  /** Hard safety cap on pages (default 200). */
  maxPages?: number;
  /** Delay between pages in ms (default 1200). */
  paceMs?: number;
  /** Consecutive empty pages tolerated before giving up (default 12). */
  maxEmptyPages?: number;
}

export interface PaginateResult {
  extracted: number;
  /** Last cursor seen — safe to persist as resume cursor. */
  lastCursor: string | null;
  /** Whether Facebook signalled more pages after the final page. */
  hasNext: boolean;
  pages: number;
  emptyPages: number;
  stopReason: PaginateStopReason;
  /** True only when the source is genuinely exhausted (has_next_page=false or cursor stalled). */
  exhausted: boolean;
}

/**
 * Drive cursor pagination until the source is exhausted, the budget is hit,
 * or the result cap is reached. In-memory `seen` dedups across pages so the
 * same user counted twice by FB is stored once; the store callback performs
 * the cross-job DB dedup.
 */
export async function paginateGraphQL(cfg: PaginateConfig, cb: PaginateCallbacks): Promise<PaginateResult> {
  const maxPages = cfg.maxPages ?? 200;
  const paceMs = cfg.paceMs ?? 1200;
  const maxEmpty = cfg.maxEmptyPages ?? 12;
  const seen = new Set<string>();

  let total = 0;
  let cursor: string | null = cfg.seedCursor ?? null;
  let pages = 0;
  let emptyPages = 0;
  let hasNext = true;
  let lastCursor: string | null = cursor;

  while (hasNext && total < cfg.maxResults && pages < maxPages) {
    if (cb.shouldAbort?.()) {
      const abort = await cb.shouldAbort();
      if (abort) {
        return { extracted: total, lastCursor, hasNext, pages, emptyPages, stopReason: "canceled", exhausted: false };
      }
    }

    let page: PageData;
    try {
      page = await cb.fetchPage(cursor);
    } catch {
      // A single page error is not fatal — report and let the caller decide.
      return { extracted: total, lastCursor, hasNext: true, pages, emptyPages, stopReason: "replay_error", exhausted: false };
    }

    pages++;
    const fresh = page.users.filter((u) => {
      if (!u.fb_id || seen.has(u.fb_id)) return false;
      seen.add(u.fb_id);
      return true;
    });

    let added = 0;
    if (fresh.length > 0) {
      // Never overshoot the result cap by a full page.
      const remaining = cfg.maxResults - total;
      const toStore = remaining > 0 ? fresh.slice(0, remaining) : [];
      if (toStore.length > 0) {
        added = await cb.store(toStore);
        total += added;
      }
      emptyPages = 0;
    } else {
      emptyPages++;
    }

    hasNext = page.hasNext;
    if (page.cursor) lastCursor = page.cursor;
    cb.onPage?.({ page: pages, added, total, cursor: page.cursor, hasNext });

    if (!hasNext) {
      return { extracted: total, lastCursor: page.cursor, hasNext: false, pages, emptyPages, stopReason: "has_next_page_false", exhausted: true };
    }
    if (total >= cfg.maxResults) {
      return { extracted: total, lastCursor: page.cursor, hasNext: true, pages, emptyPages, stopReason: "max_results_reached", exhausted: false };
    }
    if (emptyPages >= maxEmpty) {
      return { extracted: total, lastCursor: page.cursor, hasNext: true, pages, emptyPages, stopReason: "empty_pages_exhausted", exhausted: false };
    }
    // Cursor did not advance — avoid an infinite same-page loop.
    if (page.cursor && page.cursor === cursor) {
      return { extracted: total, lastCursor: page.cursor, hasNext: false, pages, emptyPages, stopReason: "has_next_page_false", exhausted: true };
    }
    cursor = page.cursor;
    if (paceMs > 0) await new Promise((r) => setTimeout(r, paceMs));
  }

  const stopReason: PaginateStopReason = total >= cfg.maxResults ? "max_results_reached" : "budget_exhausted";
  return {
    extracted: total,
    lastCursor,
    hasNext,
    pages,
    emptyPages,
    stopReason,
    exhausted: stopReason === "max_results_reached",
  };
}
