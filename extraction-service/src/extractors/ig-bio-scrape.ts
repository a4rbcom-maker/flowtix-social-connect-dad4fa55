/** Shared IG bio enrichment: scrapes bio_phone / bio_email from each collected
 *  user's public profile HTML (in-page fetch, session cookies) and patches the
 *  ExtractedMember objects IN PLACE — must run BEFORE any flush/processBatch
 *  (storeResults is a plain INSERT; post-hoc patching would miss stored rows).
 *
 *  Extracted from IgFollowersExtractor.scrapeBios (2026-09-02) so the post
 *  paths (ig_post_engagers / ig_post_commenters) get the same enrichment
 *  channel: bio contacts are the only source of CONFIRMED enrichment matches
 *  against the Egypt DB (full-name matching alone ≈ 0% coverage).
 *
 *  Hardening carried over from the 2026-08-27 production freeze (job a84dd160):
 *  - per-call 12s AbortController timeout (a hung TLS fetch cannot wedge the job);
 *  - wall-clock budget (default 2 min) — bios are a bonus, they never delay
 *    completion;
 *  - skipped entirely when the run stopped because IG throttled us;
 *  - per-batch progress heartbeat (ig_progress.bio_enrich) so the dashboard
 *    shows live "1200/9527" instead of a frozen counter. */
import type { Page } from "playwright";
import { logger } from "../logger.js";
import type { ExtractedMember } from "../types.js";

const log = logger;

export interface IgBioScrapeOptions {
  /** Heartbeat sink (e.g. this.updateIgProgress). Called once per batch. */
  onProgress?: (extra: Record<string, unknown>) => Promise<void>;
  /** Abort silently — set when IG already throttled this run. */
  throttled?: boolean;
  /** Cooperative stop signal checked between batches. */
  shouldStop?: () => boolean;
  /** Cooperative cancel signal checked between batches. */
  checkCanceled?: () => Promise<boolean>;
  /** Wall-clock budget for the whole phase (ms). Default 120_000. */
  budgetMs?: number;
  /** Parallel fetches per batch. Default 5 (matches the proven followers path). */
  batchSize?: number;
}

export interface IgBioScrapeResult {
  scraped: number;
  withContact: number;
  aborted: number;
  skipped: boolean;
}

/** Patch `collected` values in place with bio_phone / bio_email where found. */
export async function scrapeIgBios(
  page: Page,
  collected: Map<string, ExtractedMember>,
  opts: IgBioScrapeOptions = {},
): Promise<IgBioScrapeResult> {
  const all = Array.from(collected.values());
  const empty = { scraped: 0, withContact: 0, aborted: 0 };
  if (all.length === 0) return { ...empty, skipped: true };

  const BATCH = opts.batchSize ?? 5;
  const PER_CALL_TIMEOUT_MS = 12_000;
  const budgetMs = opts.budgetMs ?? 120_000;
  const phaseDeadline = Date.now() + budgetMs;

  if (opts.throttled || opts.shouldStop?.()) {
    log.info("IgBioScrape", `bio scrape skipped (${opts.throttled ? "platform throttled — avoid more requests" : "time budget exhausted"}) for ${all.length} users`);
    await opts.onProgress?.({ bio_enrich: { done: 0, total: all.length, skipped: true } }).catch(() => {});
    return { ...empty, skipped: true };
  }

  let withContact = 0;
  let aborted = 0;
  let scraped = 0;
  log.info("IgBioScrape", `scraping bios for ${all.length} users (batch=${BATCH} parallel, timeout=${PER_CALL_TIMEOUT_MS / 1000}s, budget=${Math.round(budgetMs / 1000)}s)`);

  for (let i = 0; i < all.length; i += BATCH) {
    if (await opts.checkCanceled?.()) break;
    if (Date.now() >= phaseDeadline || opts.shouldStop?.()) {
      log.warn("IgBioScrape", `bio scrape: time budget reached at ${i}/${all.length} — finishing without remaining bios`);
      await opts.onProgress?.({ bio_enrich: { done: i, total: all.length, budget_hit: true } }).catch(() => {});
      break;
    }
    const slice = all.slice(i, i + BATCH);
    const results = await Promise.all(
      slice.map((m) =>
        page
          .evaluate(async (user: string | undefined) => {
            if (!user) return null;
            const ac = new AbortController();
            const timer = setTimeout(() => ac.abort(), 12_000);
            try {
              const r = await fetch(`https://www.instagram.com/${user}/`, { credentials: "include", signal: ac.signal });
              if (!r.ok) return null;
              return await r.text();
            } catch {
              return null;
            } finally {
              clearTimeout(timer);
            }
          }, m.username)
          .then((html: string | null) => {
            if (!html) return null;
            const bioMatch = html.match(/"biography":"([^"]*)"/);
            const bio = bioMatch ? bioMatch[1].replace(/\\u[\dA-Fa-f]{4}/g, (s) => {
              try { return JSON.parse('"' + s + '"'); } catch { return ""; }
            }) : "";
            const phone = bio.match(/(?:\+?\d[\d\s().-]{7,}\d)/);
            const email = bio.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
            // Some accounts expose a public contact field directly.
            const pubPhone = html.match(/"public_phone_number":"([^"]*)"/);
            const pubEmail = html.match(/"public_email":"([^"]*)"/);
            return {
              bio_phone: (phone?.[0] || pubPhone?.[1] || "").replace(/[\s().-]/g, "").slice(0, 20) || null,
              bio_email: (email?.[0] || pubEmail?.[1] || "").toLowerCase().slice(0, 120) || null,
            };
          })
          .catch(() => null),
      ),
    );
    for (let k = 0; k < slice.length; k++) {
      const r = results[k];
      if (!r) { aborted++; continue; }
      scraped++;
      if (r.bio_phone) { slice[k].bio_phone = r.bio_phone; withContact++; }
      if (r.bio_email) { slice[k].bio_email = r.bio_email; withContact++; }
    }
    // Heartbeat every batch: dashboard shows live counts instead of freezing.
    await opts.onProgress?.({ bio_enrich: { done: Math.min(i + BATCH, all.length), total: all.length } }).catch(() => {});
    if ((i / BATCH) % 20 === 19) {
      log.info("IgBioScrape", `bio scrape: ${Math.min(i + BATCH, all.length)}/${all.length} done, ${withContact} contacts so far`);
    }
    // Gentle pacing between batches to avoid IG rate/ID blocks.
    await page.waitForTimeout(800);
  }
  log.info("IgBioScrape", `bio scrape complete: ${withContact} users with contact info (out of ${all.length}, ${aborted} empty/aborted)`);
  return { scraped, withContact, aborted, skipped: false };
}
