import { chromium, type Browser } from "playwright";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { ExtractionError, ErrorCodes } from "../errors.js";

const log = logger;

interface BrowserSlot {
  browser: Browser;
  activeContexts: number;
}

class BrowserPool {
  private slots: BrowserSlot[] = [];
  private maxBrowsers: number;
  private maxContextsPerBrowser: number;
  private isShuttingDown = false;

  constructor() {
    this.maxBrowsers = config.browserPoolSize;
    this.maxContextsPerBrowser = config.maxContextsPerBrowser;
  }

  async init(): Promise<void> {
    log.info("BrowserPool", `initializing ${this.maxBrowsers} browser(s)`);
    for (let i = 0; i < this.maxBrowsers; i++) {
      const browser = await this.launchBrowser();
      this.slots.push({ browser, activeContexts: 0 });
      log.info("BrowserPool", `browser #${i + 1} launched`);
    }
  }

  private async launchBrowser(): Promise<Browser> {
    return chromium.launch({
      headless: config.headless,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
      ],
    });
  }

  async acquire(): Promise<Browser> {
    if (this.isShuttingDown) {
      throw new ExtractionError(ErrorCodes.BROWSER_CRASH, "Browser pool is shutting down");
    }

    for (const slot of this.slots) {
      if (slot.activeContexts < this.maxContextsPerBrowser) {
        if (!slot.browser.isConnected()) {
          log.warn("BrowserPool", "browser disconnected, relaunching");
          slot.browser = await this.launchBrowser();
        }
        slot.activeContexts++;
        return slot.browser;
      }
    }

    throw new ExtractionError(ErrorCodes.QUEUE_FULL, "All browser slots are full");
  }

  release(browser: Browser): void {
    for (const slot of this.slots) {
      if (slot.browser === browser) {
        slot.activeContexts = Math.max(0, slot.activeContexts - 1);
        return;
      }
    }
  }

  getStats(): { total: number; active: number } {
    const total = this.slots.length;
    const active = this.slots.reduce((sum, s) => sum + s.activeContexts, 0);
    return { total, active };
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    log.info("BrowserPool", "shutting down — closing all browsers");
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      try {
        if (slot.browser.isConnected()) {
          await slot.browser.close();
        }
        log.info("BrowserPool", `browser #${i + 1} closed`);
      } catch (err) {
        log.warn("BrowserPool", `error closing browser #${i + 1}: ${String(err)}`);
      }
    }
    this.slots = [];
  }
}

export const browserPool = new BrowserPool();
