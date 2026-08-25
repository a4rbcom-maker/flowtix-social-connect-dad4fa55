import type { Page } from "playwright";
import { logger } from "../logger.js";
import { GraphQLInterceptor, parseGraphQLResponse, type GraphQLUser, type CapturedRequest } from "./graphql-interceptor.js";

const log = logger;

export interface EngagerResult {
  reactors: GraphQLUser[];
  commenters: GraphQLUser[];
}

export interface ExtractOptions {
  maxReactions?: number;
  maxCommenters?: number;
  maxCursorPages?: number;
  scrollDialogSeconds?: number;
}

const DEFAULT_OPTS: Required<ExtractOptions> = {
  maxReactions: 1000,
  maxCommenters: 500,
  maxCursorPages: 40,
  scrollDialogSeconds: 8,
};

/**
 * Extracts engagers (reactors + commenters) from a Facebook post
 * using GraphQL network interception and cursor-based pagination.
 *
 * Strategy:
 * 1. Navigate to the post permalink
 * 2. Set up GraphQL interceptor to capture requests/responses
 * 3. Click the reactions count → triggers a GraphQL request
 * 4. Capture that request's doc_id + variables
 * 5. Parse the response for users + end_cursor
 * 6. Replay the request with new cursors until exhausted
 * 7. Do the same for comments
 */
export async function extractEngagers(page: Page, permalink: string, options: ExtractOptions = {}): Promise<EngagerResult> {
  const opts = { ...DEFAULT_OPTS, ...options };

  const reactorsMap = new Map<string, GraphQLUser>();
  const commentersMap = new Map<string, GraphQLUser>();

  const interceptor = new GraphQLInterceptor();

  // Step 1: Navigate to post
  try {
    await page.goto(permalink, { waitUntil: "domcontentloaded", timeout: 10000 });
    await page.waitForTimeout(1500);
  } catch {
    log.debug("EngagerExtractor", `failed to open: ${permalink.substring(0, 60)}`);
    return { reactors: [], commenters: [] };
  }

  // Step 2: Attach interceptor BEFORE clicking anything
  interceptor.attach(page);

  try {
    // Step 3: Extract reactors via GraphQL
    await extractReactorsViaGraphQL(page, interceptor, reactorsMap, opts);

    // Step 4: Commenters — the post page is usually still open after the
    // reactions dialog closes (Escape). Re-navigate only when the context
    // actually changed; skipping the reload saves ~5s per post (~25%).
    if (commentersMap.size < opts.maxCommenters) {
      if (samePostUrl(page.url(), permalink)) {
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(500);
      } else {
        await page.goto(permalink, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(2000);
      }
      await extractCommentersViaGraphQL(page, interceptor, commentersMap, opts);
    }
  } finally {
    interceptor.detach(page);
  }

  return {
    reactors: Array.from(reactorsMap.values()),
    commenters: Array.from(commentersMap.values()),
  };
}

/** True when the browser is still on the same facebook post path. */
function samePostUrl(current: string, permalink: string): boolean {
  try {
    const a = new URL(current);
    const b = new URL(permalink);
    return a.hostname.includes("facebook.com") && a.pathname === b.pathname;
  } catch {
    return false;
  }
}

async function extractReactorsViaGraphQL(
  page: Page,
  interceptor: GraphQLInterceptor,
  usersMap: Map<string, GraphQLUser>,
  opts: Required<ExtractOptions>,
): Promise<void> {
  // Click the reactions count to trigger GraphQL
  const clicked = await clickReactionsButton(page);
  if (!clicked) {
    log.debug("EngagerExtractor", "no reactions button found");
    return;
  }

  await page.waitForTimeout(2000);

  // Try clicking "All" tab (All reactions)
  try {
    await page.evaluate(() => {
      const tabs = document.querySelectorAll('[role="tab"], [role="menuitemradio"]');
      for (const t of tabs) {
        const text = (t.textContent || "").trim();
        if (text === "All" || text.includes("الكل")) { (t as HTMLElement).click(); return; }
      }
    });
    await page.waitForTimeout(1500);
  } catch { /* skip */ }

  // Parse all intercepted responses so far
  const interceptedTexts = interceptor.drainInterceptedTexts();
  for (const text of interceptedTexts) {
    const parsed = parseGraphQLResponse(text);
    for (const u of parsed.users) {
      if (!usersMap.has(u.id)) usersMap.set(u.id, u);
    }
  }

  // Find the captured reactions request for cursor replay
  const captured = interceptor.findCapturedRequest("reaction") ||
                   interceptor.findCapturedRequest("reactor") ||
                   interceptor.findCapturedRequest("feedback") ||
                   interceptor.findCapturedRequest();

  // Cursor replay fails (Facebook error 1357004 - auth tokens required)
  // So we rely ENTIRELY on dialog scrolling to trigger Facebook's own pagination
  // Facebook's JS handles all auth headers when it loads more reactors via scroll

  // Scroll dialog aggressively to trigger Facebook's own GraphQL pagination
  if (usersMap.size < opts.maxReactions) {
    await scrollDialogForMore(page, interceptor, usersMap, opts.scrollDialogSeconds);
  }

  if (usersMap.size > 0) {
    log.info("EngagerExtractor", `reactors: ${usersMap.size} (via scroll-triggered pagination)`);
  }

  // Close dialog
  try { await page.keyboard.press("Escape"); await page.waitForTimeout(300); } catch { /* ok */ }
}

async function extractCommentersViaGraphQL(
  page: Page,
  interceptor: GraphQLInterceptor,
  usersMap: Map<string, GraphQLUser>,
  opts: Required<ExtractOptions>,
): Promise<void> {
  // Click "view more comments" to trigger GraphQL
  for (let i = 0; i < 3; i++) {
    const clicked = await page.evaluate(() => {
      const els = document.querySelectorAll('[role="button"], a[role="link"], span, div[role="button"]');
      for (const el of els) {
        const t = (el as HTMLElement).textContent?.trim() || "";
        if (t.includes("more comments") || t.includes("عرض") || t.includes("تعليق") ||
            t.includes("comments") || t.match(/^\d+\s*(more|تعليق|رد)/i)) {
          (el as HTMLElement).click();
          return true;
        }
      }
      return false;
    }).catch(() => false);
    if (!clicked) break;
    await page.waitForTimeout(800);
  }

  // Parse intercepted comment responses
  const interceptedTexts = interceptor.drainInterceptedTexts();
  for (const text of interceptedTexts) {
    const parsed = parseGraphQLResponse(text);
    for (const u of parsed.users) {
      if (!usersMap.has(u.id)) usersMap.set(u.id, u);
    }
  }

  // Scroll comments section to trigger Facebook's own GraphQL pagination.
  // Budget responds to scrollDialogSeconds when a caller raises it (pages
  // path), but never drops below the 7s default used by every other caller.
  const commentBudgetMs = Math.max(7000, opts.scrollDialogSeconds * 1000);
  const startTime = Date.now();
  let noProgress = 0;
  while (Date.now() - startTime < commentBudgetMs && usersMap.size < opts.maxCommenters) {
    const before = usersMap.size;

    // Parse new intercepted responses
    const texts = interceptor.drainInterceptedTexts();
    for (const text of texts) {
      const parsed = parseGraphQLResponse(text);
      for (const u of parsed.users) {
        if (!usersMap.has(u.id)) usersMap.set(u.id, u);
      }
    }

    if (usersMap.size === before) {
      noProgress++;
      if (noProgress >= 12) break;
    } else {
      noProgress = 0;
    }

    // Scroll comment containers
    await page.evaluate(() => {
      const containers = [
        document.querySelector('[role="feed"]'),
        document.querySelector('[aria-label*="comment"]'),
        document.querySelector('[aria-label*="تعليق"]'),
        document.querySelector('[role="main"]'),
      ];
      const c = containers.find(x => x) as HTMLElement | null;
      if (c) {
        const el = c;
        el.scrollTop = el.scrollTop + el.clientHeight * 0.8;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50) {
          el.scrollTop = el.scrollHeight;
        }
      } else {
        window.scrollBy(0, 600);
      }
    });
    await page.waitForTimeout(300);

    // Try clicking "more replies" inline as we scroll
    if (noProgress === 3) {
      await page.evaluate(() => {
        const els = document.querySelectorAll('[role="button"], span, div[role="button"]');
        for (const el of els) {
          const t = (el as HTMLElement).textContent?.trim() || "";
          if (t.includes("more replies") || t.includes("عرض") || t.includes("رد") || t.match(/^view \d+/i)) {
            (el as HTMLElement).click();
            return;
          }
        }
      }).catch(() => {});
    }
  }

  if (usersMap.size > 0) {
    log.info("EngagerExtractor", `commenters: ${usersMap.size} (via scroll-triggered pagination)`);
  }
}

async function clickReactionsButton(page: Page): Promise<boolean> {
  // Strategy 0: Scroll the article into view first
  await page.evaluate(() => {
    const article = document.querySelector('[role="article"]') || document.querySelector('[data-pagelet]');
    if (article) (article as HTMLElement).scrollIntoView({ block: "center" });
  });
  await page.waitForTimeout(500);

  return await page.evaluate(() => {
    // Strategy 1: aria-label with reaction keyword (most reliable)
    const labeled = document.querySelectorAll('[aria-label]');
    for (const el of labeled) {
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      if ((aria.includes("reaction") || aria.includes("تفاعل") || aria.includes("إعجاب") || aria.includes("أعجب") || aria.includes("like")) && aria.match(/\d/)) {
        (el as HTMLElement).click(); return true;
      }
    }
    // Strategy 2: Click on any element containing reaction count bar
    const reactionBars = document.querySelectorAll('[data-visualcompletion], [class*="reaction"], [class*="LikeBar"]');
    for (const bar of reactionBars) {
      const parent = bar.closest('a, [role="button"], [role="link"]');
      if (parent) { (parent as HTMLElement).click(); return true; }
    }
    // Strategy 3: Links to reaction profiles
    const reactionLinks = document.querySelectorAll('a[href*="ufi/reaction"], a[href*="reaction/profile"]');
    for (const link of reactionLinks) { (link as HTMLElement).click(); return true; }
    // Strategy 4: Element with number near emoji/icon
    const buttons = document.querySelectorAll('div[role="button"], span[role="button"], a[role="link"]');
    for (const b of buttons) {
      const text = (b as HTMLElement).textContent?.trim() || "";
      if (text.match(/^[\d,.KkMم]+$/) && (b.querySelector('svg, img, i') || (b as HTMLElement).style.cssText.includes('emoji'))) {
        (b as HTMLElement).click(); return true;
      }
    }
    // Strategy 5: Click on the "Like/React" footer area (bottom of post)
    const footer = document.querySelector('[role="article"] > div:last-child') || document.querySelector('[data-pagelet] > div:last-child');
    if (footer) {
      const clickable = footer.querySelectorAll('a, [role="button"], span');
      for (const c of clickable) {
        const t = (c as HTMLElement).textContent?.trim() || "";
        if (t.match(/^\d/) || t.includes("تعليق") || t.includes("comment") || t.includes("مشاركة") || t.includes("share")) {
          (c as HTMLElement).click(); return true;
        }
      }
    }
    return false;
  }).catch(() => false);
}

async function scrollDialogForMore(
  page: Page,
  interceptor: GraphQLInterceptor,
  usersMap: Map<string, GraphQLUser>,
  maxSeconds: number,
): Promise<void> {
  const startTime = Date.now();
  let noProgress = 0;
  let lastReported = 0;

  while (Date.now() - startTime < maxSeconds * 1000) {
    const before = usersMap.size;

    // Parse any new intercepted responses
    const texts = interceptor.drainInterceptedTexts();
    for (const text of texts) {
      const parsed = parseGraphQLResponse(text);
      for (const u of parsed.users) {
        if (!usersMap.has(u.id)) usersMap.set(u.id, u);
      }
    }

    if (usersMap.size === before) {
      noProgress++;
      if (noProgress >= 15) break;
    } else {
      noProgress = 0;
      if (usersMap.size - lastReported >= 20) {
        lastReported = usersMap.size;
      }
    }

    // Scroll dialog (multiple small scrolls to trigger lazy loading)
    await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"] [role="list"]') ||
                  document.querySelector('[role="dialog"] div[style*="overflow"]') ||
                  document.querySelector('[role="dialog"]');
      if (dlg) {
        const el = dlg as HTMLElement;
        // Scroll in steps to trigger lazy loading
        const current = el.scrollTop;
        el.scrollTop = current + el.clientHeight * 0.8;
        // If at bottom, jump to absolute bottom
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50) {
          el.scrollTop = el.scrollHeight;
        }
      }
    });
    await page.waitForTimeout(250);
  }
}

/* ============================================================================
 * DEEP variants — page-followers ONLY.
 *
 * The shared `extractEngagers` relies on a single fixed dialog selector and a
 * 15-idle-cycle cap, which on today's Facebook UI yields only the first batch
 * of reactors (~8-12) before the scroll loop bails. For page-followers we need
 * thousands, so these variants:
 *   - try several dialog/scroll-container selectors (current FB markup varies),
 *   - keep scrolling until the budget is exhausted or the container truly stops
 *     growing (high idle tolerance), never a premature 4s bail.
 * The legacy functions above are untouched — other extractors keep their
 * exact prior behaviour.
 * ========================================================================== */

async function scrollContainerAggressively(page: Page, maxSeconds: number, logTag: string): Promise<number> {
  const startTime = Date.now();
  let noProgress = 0;
  let harvested = 0;
  const selectors = [
    '[role="dialog"] [role="list"]',
    '[role="dialog"] div[style*="overflow"]',
    '[role="dialog"] [data-visualcompletion]',
    '[role="dialog"] ul',
    '[role="dialog"]',
    '[aria-modal="true"] [role="list"]',
    'div[role="dialog"] > div',
  ];
  while (Date.now() - startTime < maxSeconds * 1000) {
    const before = await page.evaluate((sels: string[]) => {
      // Return how many user-ish rows we can currently see + scroll every candidate.
      let best: HTMLElement | null = null;
      let bestH = 0;
      for (const s of sels) {
        const el = document.querySelector(s) as HTMLElement | null;
        if (el && el.scrollHeight > bestH) { best = el; bestH = el.scrollHeight; }
      }
      // Also try the dialog's scrollable child generically.
      const dlg = document.querySelector('[role="dialog"]') as HTMLElement | null;
      if (dlg) {
        const kids = Array.from(dlg.querySelectorAll('div')) as HTMLElement[];
        for (const k of kids) {
          if (k.scrollHeight > k.clientHeight + 10 && k.scrollHeight > bestH) { best = k; bestH = k.scrollHeight; }
        }
      }
      if (best) {
        const cur = best.scrollTop;
        best.scrollTop = cur + best.clientHeight * 0.9;
        if (best.scrollTop + best.clientHeight >= best.scrollHeight - 40) best.scrollTop = best.scrollHeight;
        return best.querySelectorAll('a[href*="profile"], a[href*="user"], [role="listitem"], [data-visualcompletion]').length;
      }
      return 0;
    }, selectors).catch(() => 0);

    if (before === harvested) {
      noProgress++;
      if (noProgress >= 40) break; // genuine stall
    } else {
      harvested = before;
      noProgress = 0;
    }
    await page.waitForTimeout(300);
  }
  return harvested;
}

async function extractReactorsDeep(
  page: Page,
  interceptor: GraphQLInterceptor,
  usersMap: Map<string, GraphQLUser>,
  opts: Required<ExtractOptions>,
): Promise<void> {
  const clicked = await clickReactionsButton(page);
  if (!clicked) {
    log.debug("EngagerExtractor", "deep: no reactions button found");
    return;
  }
  await page.waitForTimeout(2000);
  // Click "All" tab if present
  try {
    await page.evaluate(() => {
      const tabs = document.querySelectorAll('[role="tab"], [role="menuitemradio"]');
      for (const t of Array.from(tabs)) {
        const text = (t.textContent || "").trim();
        if (text === "All" || text.includes("الكل")) { (t as HTMLElement).click(); return; }
      }
    });
    await page.waitForTimeout(1500);
  } catch { /* skip */ }

  const drain = () => {
    const texts = interceptor.drainInterceptedTexts();
    for (const text of texts) {
      const parsed = parseGraphQLResponse(text);
      for (const u of parsed.users) {
        if (!usersMap.has(u.id)) usersMap.set(u.id, u);
      }
    }
  };
  drain();

  if (usersMap.size < opts.maxReactions) {
    await scrollContainerAggressively(page, opts.scrollDialogSeconds, "reactors");
    drain();
  }
  if (usersMap.size > 0) {
    log.info("EngagerExtractor", `deep reactors: ${usersMap.size}`);
  }
  // Close dialog
  try { await page.keyboard.press("Escape"); await page.waitForTimeout(300); } catch { /* ok */ }
}

async function extractCommentersDeep(
  page: Page,
  interceptor: GraphQLInterceptor,
  usersMap: Map<string, GraphQLUser>,
  opts: Required<ExtractOptions>,
): Promise<void> {
  // Trigger comment loading
  for (let i = 0; i < 3; i++) {
    const clicked = await page.evaluate(() => {
      const els = document.querySelectorAll('[role="button"], a[role="link"], span, div[role="button"]');
      for (const el of Array.from(els)) {
        const t = (el as HTMLElement).textContent?.trim() || "";
        if (t.includes("more comments") || t.includes("عرض") || t.includes("تعليق") ||
            t.includes("comments") || t.match(/^\d+\s*(more|تعليق|رد)/i)) {
          (el as HTMLElement).click();
          return true;
        }
      }
      return false;
    }).catch(() => false);
    if (!clicked) break;
    await page.waitForTimeout(800);
  }
  const drain = () => {
    const texts = interceptor.drainInterceptedTexts();
    for (const text of texts) {
      const parsed = parseGraphQLResponse(text);
      for (const u of parsed.users) {
        if (!usersMap.has(u.id)) usersMap.set(u.id, u);
      }
    }
  };
  drain();
  if (usersMap.size < opts.maxCommenters) {
    await scrollContainerAggressively(page, Math.max(7, opts.scrollDialogSeconds), "commenters");
    drain();
  }
  if (usersMap.size > 0) {
    log.info("EngagerExtractor", `deep commenters: ${usersMap.size}`);
  }
}

/**
 * Page-followers deep extractor. Same semantics as extractEngagers but uses the
 * deep scroll variants so a single post can yield up to maxReactions/maxCommenters
 * follower-style rows. Legacy extractEngagers is left untouched.
 */
export async function extractEngagersDeep(page: Page, permalink: string, options: ExtractOptions = {}): Promise<EngagerResult> {
  const opts = { ...DEFAULT_OPTS, ...options };
  const reactorsMap = new Map<string, GraphQLUser>();
  const commentersMap = new Map<string, GraphQLUser>();
  const interceptor = new GraphQLInterceptor();

  try {
    await page.goto(permalink, { waitUntil: "domcontentloaded", timeout: 10000 });
    await page.waitForTimeout(1500);
  } catch {
    log.debug("EngagerExtractor", `deep: failed to open ${permalink.substring(0, 60)}`);
    return { reactors: [], commenters: [] };
  }

  interceptor.attach(page);
  try {
    await extractReactorsDeep(page, interceptor, reactorsMap, opts);
    if (commentersMap.size < opts.maxCommenters && samePostUrl(page.url(), permalink)) {
      await extractCommentersDeep(page, interceptor, commentersMap, opts);
    }
  } finally {
    interceptor.detach(page);
  }

  return {
    reactors: Array.from(reactorsMap.values()),
    commenters: Array.from(commentersMap.values()),
  };
}
