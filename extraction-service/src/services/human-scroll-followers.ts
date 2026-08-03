import type { Page } from "playwright";
import { logger } from "../logger.js";

const log = logger;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const randFloat = (min: number, max: number) => Math.random() * (max - min) + min;

export interface HumanScrollOptions {
  maxRounds?: number;
  maxIdleRounds?: number;
  targetCount?: number;
  onProgress?: (seen: number, round: number) => void;
  onInterceptedCount?: () => number;
  shouldStop?: () => Promise<boolean>;
}

/**
 * Human-like scroll engine for /followers/ page.
 * Implements:
 *  - Bezier mouse movements (curved, not straight)
 *  - Variable scroll velocity (sometimes slow, sometimes fast)
 *  - Reading pauses (3-15s randomly)
 *  - Profile hover effects (click whitespace + hover)
 *  - Scroll-back behavior (occasionally scroll up)
 *  - Long breaks (10-30s every 25-40 scrolls)
 *  - Pre-warmup (browse feed briefly first)
 */
export async function humanScrollFollowers(page: Page, opts: HumanScrollOptions = {}): Promise<{
  totalSeen: number;
  rounds: number;
  stoppedReason: "target_reached" | "max_rounds" | "idle_timeout" | "canceled" | "stopped";
}> {
  const maxRounds = opts.maxRounds ?? 800;
  const maxIdleRounds = opts.maxIdleRounds ?? 35;
  const targetCount = opts.targetCount ?? 50000;

  log.info("HumanScroll", `========================================`);
  log.info("HumanScroll", `human-like scroll engine starting`);
  log.info("HumanScroll", `maxRounds=${maxRounds} targetCount=${targetCount} maxIdle=${maxIdleRounds}`);
  log.info("HumanScroll", `========================================`);

  // ===== Pre-warmup: simulate arriving from another page =====
  await warmupSequence(page);

  let lastSeenCount = 0;
  let idleCount = 0;
  let lastLongBreakRound = 0;
  let nextLongBreakAt = rand(25, 40);
  let wakeUpAttempts = 0;
  const MAX_WAKEUP_ATTEMPTS = 3; // give up after 3 failed wake-ups

  for (let round = 0; round < maxRounds; round++) {
    if (opts.shouldStop && await opts.shouldStop()) {
      return { totalSeen: lastSeenCount, rounds: round, stoppedReason: "canceled" };
    }

    // ===== Long break every N rounds =====
    if (round - lastLongBreakRound >= nextLongBreakAt) {
      const breakMs = rand(8000, 25000);
      log.info("HumanScroll", `round ${round}: long break ${Math.round(breakMs / 1000)}s (reading/away)`);
      await sleep(breakMs);
      lastLongBreakRound = round;
      nextLongBreakAt = rand(25, 40);
    }

    // ===== 1. Random mouse movement (bezier curve) =====
    if (Math.random() < 0.7) {
      await moveMouseBezier(page);
    }

    // ===== 2. Variable scroll pattern =====
    const pattern = pickScrollPattern();
    await applyScrollPattern(page, pattern);

    // ===== 3. Variable wait (reading time) =====
    const waitMs = pickWaitTime(round);
    await sleep(waitMs);

    // ===== 4. Occasionally hover over a profile card =====
    if (Math.random() < 0.18) {
      await hoverRandomProfileCard(page);
      await sleep(rand(800, 2200));
    }

    // ===== 5. Occasionally scroll back up briefly =====
    if (Math.random() < 0.06) {
      const upAmount = rand(150, 400);
      await page.evaluate((amt) => window.scrollBy(0, -amt), upAmount);
      await sleep(rand(500, 1200));
    }

    // ===== 6. Occasionally click on whitespace (appear active) =====
    if (Math.random() < 0.10) {
      await clickWhitespace(page);
    }

    // ===== 7. Check progress =====
    const currentCount = opts.onInterceptedCount ? opts.onInterceptedCount() : lastSeenCount;
    if (currentCount > lastSeenCount) {
      const delta = currentCount - lastSeenCount;
      log.info("HumanScroll", `round ${round}: +${delta} users (total=${currentCount})`);
      idleCount = 0;
      wakeUpAttempts = 0; // reset on real progress
      lastSeenCount = currentCount;
      opts.onProgress?.(lastSeenCount, round);

      if (lastSeenCount >= targetCount) {
        return { totalSeen: lastSeenCount, rounds: round, stoppedReason: "target_reached" };
      }
    } else {
      idleCount++;
      if (idleCount % 5 === 0) {
        log.info("HumanScroll", `round ${round}: idle ${idleCount}/${maxIdleRounds} (total still ${currentCount}, wakeUpAttempts=${wakeUpAttempts})`);
      }

      if (idleCount >= maxIdleRounds) {
        wakeUpAttempts++;
        if (wakeUpAttempts > MAX_WAKEUP_ATTEMPTS) {
          log.info("HumanScroll", `round ${round}: giving up after ${MAX_WAKEUP_ATTEMPTS} wake-up attempts — stopping (idle_timeout)`);
          return { totalSeen: lastSeenCount, rounds: round, stoppedReason: "idle_timeout" };
        }
        log.info("HumanScroll", `round ${round}: idle limit reached — trying aggressive wake-up (attempt ${wakeUpAttempts}/${MAX_WAKEUP_ATTEMPTS})`);
        const countBefore = currentCount;
        await aggressiveWakeUp(page);
        // wait a bit after wake-up to see if it worked
        await sleep(rand(3000, 6000));
        const countAfter = opts.onInterceptedCount ? opts.onInterceptedCount() : lastSeenCount;
        if (countAfter > countBefore) {
          // real new users — reset idle
          idleCount = 0;
          wakeUpAttempts = 0;
          log.info("HumanScroll", `round ${round}: wake-up WORKED, +${countAfter - countBefore} users`);
        } else {
          // wake-up didn't help — keep counting idle, will retry on next idle limit
          idleCount = Math.floor(maxIdleRounds * 0.5); // start from middle, not 0
          log.info("HumanScroll", `round ${round}: wake-up did NOT help — continuing idle countdown`);
        }
      }
    }
  }

  return { totalSeen: lastSeenCount, rounds: maxRounds, stoppedReason: "max_rounds" };
}

async function warmupSequence(page: Page): Promise<void> {
  try {
    log.info("HumanScroll", `warmup: simulating human arrival (3-8s)`);
    // small initial mouse movement
    await page.mouse.move(rand(50, 1300), rand(50, 600), { steps: 8 });
    await sleep(rand(800, 1800));
    // another small mouse movement
    await page.mouse.move(rand(100, 1200), rand(100, 700), { steps: 12 });
    await sleep(rand(500, 1500));
    // initial slow scroll to start loading
    await page.evaluate(() => window.scrollBy(0, 200));
    await sleep(rand(1500, 3000));
  } catch {
    /* skip */
  }
}

async function moveMouseBezier(page: Page): Promise<void> {
  try {
    const startX = rand(100, 1200);
    const startY = rand(100, 600);
    const endX = rand(100, 1200);
    const endY = rand(100, 600);
    const ctrlX = (startX + endX) / 2 + rand(-200, 200);
    const ctrlY = (startY + endY) / 2 + rand(-200, 200);
    const steps = rand(15, 35);

    await page.mouse.move(startX, startY);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      // quadratic bezier
      const x = (1 - t) * (1 - t) * startX + 2 * (1 - t) * t * ctrlX + t * t * endX;
      const y = (1 - t) * (1 - t) * startY + 2 * (1 - t) * t * ctrlY + t * t * endY;
      await page.mouse.move(Math.round(x), Math.round(y));
      await sleep(randFloat(5, 25));
    }
  } catch {
    /* skip */
  }
}

type ScrollPattern = "small" | "medium" | "large" | "page-down" | "end-key";

function pickScrollPattern(): ScrollPattern {
  const r = Math.random();
  if (r < 0.30) return "small";
  if (r < 0.60) return "medium";
  if (r < 0.80) return "large";
  if (r < 0.93) return "page-down";
  return "end-key";
}

async function applyScrollPattern(page: Page, pattern: ScrollPattern): Promise<void> {
  try {
    switch (pattern) {
      case "small": {
        const amount = rand(80, 200);
        await page.evaluate((amt) => window.scrollBy(0, amt), amount);
        break;
      }
      case "medium": {
        const amount = rand(250, 500);
        await page.evaluate((amt) => window.scrollBy(0, amt), amount);
        break;
      }
      case "large": {
        const amount = rand(550, 900);
        await page.evaluate((amt) => window.scrollBy(0, amt), amount);
        break;
      }
      case "page-down":
        await page.keyboard.press("PageDown");
        break;
      case "end-key":
        await page.evaluate(() => {
          const feed = document.querySelector('[role="feed"], [aria-label*="Followers"], [aria-label*="متابعين"]');
          if (feed instanceof HTMLElement) {
            feed.scrollTop = feed.scrollHeight;
          } else {
            window.scrollTo(0, document.body.scrollHeight);
          }
        });
        break;
    }
  } catch {
    /* skip */
  }
}

function pickWaitTime(round: number): number {
  // Most scrolls: 600ms-2.5s
  // Sometimes: 3-7s (reading)
  // Rarely: 8-15s (deep reading)
  const r = Math.random();
  if (r < 0.60) return rand(600, 2500);
  if (r < 0.88) return rand(3000, 7000);
  return rand(8000, 15000);
}

async function hoverRandomProfileCard(page: Page): Promise<void> {
  try {
    await page.evaluate(() => {
      const cards = document.querySelectorAll('[role="listitem"], [role="article"], li[data-id]');
      if (cards.length === 0) return;
      const idx = Math.floor(Math.random() * Math.min(cards.length, 8));
      const card = cards[idx] as HTMLElement;
      if (card) {
        const rect = card.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        // dispatch mousemove via native event
        card.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: x, clientY: y }));
      }
    });
  } catch {
    /* skip */
  }
}

async function clickWhitespace(page: Page): Promise<void> {
  try {
    // click on a non-interactive area
    const x = rand(50, 1300);
    const y = rand(50, 100);
    await page.mouse.click(x, y);
  } catch {
    /* skip */
  }
}

async function aggressiveWakeUp(page: Page): Promise<boolean> {
  // Try multiple strategies to wake up pagination
  try {
    // strategy 1: move mouse a lot
    for (let i = 0; i < 5; i++) {
      await page.mouse.move(rand(100, 1200), rand(100, 700), { steps: 10 });
      await sleep(rand(200, 500));
    }

    // strategy 2: scroll up then down dramatically
    await page.evaluate(() => window.scrollBy(0, -800));
    await sleep(rand(800, 1500));
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(rand(1500, 2500));

    // strategy 3: page focus trigger
    await page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await sleep(rand(800, 1500));

    // strategy 4: keyboard activity
    await page.keyboard.press("End");
    await sleep(rand(500, 1000));

    return true;
  } catch {
    return false;
  }
}

// (legacy randInRange removed — use rand() instead)
