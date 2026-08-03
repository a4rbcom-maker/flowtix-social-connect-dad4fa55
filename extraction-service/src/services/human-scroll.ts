import type { Page } from "playwright";
import { logger } from "../logger.js";

const log = logger;

export async function humanScrollOnce(page: Page): Promise<void> {
  const scrollAmount = Math.floor(Math.random() * 300) + 200;
  await page.mouse.wheel(0, scrollAmount);
}

export async function humanScrollDialog(page: Page, opts: {
  maxScrolls: number;
  longPauseEvery?: number;
  onProgress?: (scroll: number) => Promise<void>;
  shouldStop?: () => boolean;
  isCanceled?: () => Promise<boolean>;
}): Promise<{ totalScrolls: number; stopped: boolean }> {
  const { maxScrolls, longPauseEvery = 10, onProgress, shouldStop, isCanceled } = opts;
  let totalScrolls = 0;
  let lastLongPause = 0;

  while (totalScrolls < maxScrolls) {
    if (shouldStop && shouldStop()) {
      log.debug("HumanScroll", `stop signal at scroll ${totalScrolls}`);
      return { totalScrolls, stopped: true };
    }
    if (isCanceled && await isCanceled()) {
      log.info("HumanScroll", `canceled at scroll ${totalScrolls}`);
      return { totalScrolls, stopped: true };
    }

    const scrollAmount = Math.floor(Math.random() * 300) + 200;
    const delay = Math.floor(Math.random() * 800) + 300;

    await page.evaluate((amount: number) => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      let scrolled = false;
      for (let i = 0; i < dialogs.length; i++) {
        const dialog = dialogs[i] as HTMLElement;
        if (dialog.offsetParent !== null && dialog.scrollHeight > dialog.clientHeight + 50) {
          dialog.scrollTop = Math.min(dialog.scrollHeight, dialog.scrollTop + amount);
          scrolled = true;
          break;
        }
      }
      if (!scrolled) {
        window.scrollBy(0, amount);
        for (const el of document.querySelectorAll('[style*="overflow"]')) {
          if (el instanceof HTMLElement && el.scrollHeight > el.clientHeight + 50) {
            el.scrollTop = Math.min(el.scrollHeight, el.scrollTop + amount);
          }
        }
      }
    }, scrollAmount);

    await page.waitForTimeout(delay);

    if (Math.random() > 0.7) {
      await page.mouse.move(
        Math.floor(Math.random() * 800) + 100,
        Math.floor(Math.random() * 400) + 100,
      );
    }

    totalScrolls++;

    if (totalScrolls - lastLongPause >= longPauseEvery + Math.floor(Math.random() * 5)) {
      const pauseMs = Math.floor(Math.random() * 2000) + 2000;
      log.debug("HumanScroll", `human pause at scroll ${totalScrolls} for ${pauseMs}ms`);
      await page.waitForTimeout(pauseMs);
      lastLongPause = totalScrolls;
    }

    if (onProgress && totalScrolls % 10 === 0) {
      await onProgress(totalScrolls);
    }
  }

  return { totalScrolls, stopped: false };
}

export async function randomHumanDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
  await new Promise((r) => setTimeout(r, delay));
}
