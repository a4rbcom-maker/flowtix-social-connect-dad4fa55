import type { Browser, BrowserContext, Page } from "playwright";
import { browserPool } from "./browser-pool.js";
import { buildStealthContextOptions, getNextFingerprint } from "./browser-setup.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import type { CookieEntry, AuthState } from "../types.js";
import { detectAuthState } from "../extractors/base.js";

const log = logger;

interface ActiveSessionContext {
  contextId: string;
  context: BrowserContext;
  page: Page;
  browser: Browser;
  sessionId: string;
  fingerprint: ReturnType<typeof getNextFingerprint>;
  requestCount: number;
  errorCount: number;
  cooldownUntil: number;
  lastAnchorId: string | null;
}

const REQUEST_LIMIT_PER_SESSION = 150;
const COOLDOWN_AFTER_LIMIT_MS = 30000;
const MAX_ERRORS_PER_SESSION = 5;

class SessionContextManager {
  private active: Map<string, ActiveSessionContext> = new Map();

  async createSessionContext(
    sessionId: string,
    cookies: CookieEntry[],
    proxyConfig?: { server: string; username?: string; password?: string },
  ): Promise<{ contextId: string; context: BrowserContext; page: Page; fingerprint: ReturnType<typeof getNextFingerprint> }> {
    const browser = await browserPool.acquire();
    const contextId = `${sessionId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const fingerprint = getNextFingerprint();

    const contextOptions: Record<string, unknown> = {
      ...buildStealthContextOptions(fingerprint),
    };
    if (proxyConfig) {
      contextOptions.proxy = proxyConfig;
    }

    const context = await browser.newContext(contextOptions);

    const playwrightCookies = cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain || ".facebook.com",
      path: c.path || "/",
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite as "Strict" | "Lax" | "None" | undefined,
    }));
    await context.addCookies(playwrightCookies);

    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      Object.defineProperty(navigator, "languages", { get: () => ["ar", "ar-EG", "en-US", "en"] });
      Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, "deviceMemory", { get: () => 8 });
      Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });
      (window as any).chrome = { runtime: {} };
      const originalQuery = (window.navigator as any).permissions?.query;
      if (originalQuery) {
        (window.navigator as any).permissions.query = (parameters: any) =>
          parameters.name === "notifications"
            ? Promise.resolve({ state: Notification.permission })
            : originalQuery(parameters);
      }
    });

    const page = await context.newPage();
    page.setDefaultTimeout(config.fbNavTimeoutMs);
    page.setDefaultNavigationTimeout(config.fbNavTimeoutMs);

    this.active.set(contextId, {
      contextId, context, page, browser, sessionId,
      fingerprint,
      requestCount: 0, errorCount: 0, cooldownUntil: 0, lastAnchorId: null,
    });

    log.info("SessionManager", `session context created ${contextId}`, {
      sessionId,
      fingerprintLocale: fingerprint.locale,
      activeContexts: this.active.size,
    });

    return { contextId, context, page, fingerprint };
  }

  getSession(contextId: string): ActiveSessionContext | undefined {
    return this.active.get(contextId);
  }

  incrementRequestCount(contextId: string): void {
    const entry = this.active.get(contextId);
    if (!entry) return;
    entry.requestCount++;
    if (entry.requestCount >= REQUEST_LIMIT_PER_SESSION) {
      entry.cooldownUntil = Date.now() + COOLDOWN_AFTER_LIMIT_MS;
      log.info("SessionManager", `session[${contextId}] hit request limit (${entry.requestCount}), cooldown ${COOLDOWN_AFTER_LIMIT_MS / 1000}s`);
    }
  }

  recordError(contextId: string): void {
    const entry = this.active.get(contextId);
    if (!entry) return;
    entry.errorCount++;
    if (entry.errorCount >= MAX_ERRORS_PER_SESSION) {
      entry.cooldownUntil = Date.now() + COOLDOWN_AFTER_LIMIT_MS;
      log.warn("SessionManager", `session[${contextId}] hits max errors (${entry.errorCount}), cooldown ${COOLDOWN_AFTER_LIMIT_MS / 1000}s`);
    }
  }

  recordSuccess(contextId: string): void {
    const entry = this.active.get(contextId);
    if (!entry) return;
    entry.errorCount = 0;
  }

  setAnchor(contextId: string, anchorId: string): void {
    const entry = this.active.get(contextId);
    if (!entry) return;
    entry.lastAnchorId = anchorId;
  }

  getAnchor(contextId: string): string | null {
    const entry = this.active.get(contextId);
    return entry?.lastAnchorId ?? null;
  }

  isAvailable(contextId: string): boolean {
    const entry = this.active.get(contextId);
    if (!entry) return false;
    return Date.now() >= entry.cooldownUntil;
  }

  pickAvailable(contextIds: string[]): string | null {
    for (const id of contextIds) {
      if (this.isAvailable(id)) return id;
    }
    return null;
  }

  async verifyAuth(contextId: string, targetUrl: string): Promise<AuthState> {
    const entry = this.active.get(contextId);
    if (!entry) return "unknown";
    try {
      await entry.page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: config.fbNavTimeoutMs });
      await entry.page.waitForTimeout(3000);
      await entry.page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      await entry.page.waitForTimeout(2000);
      const html = await entry.page.content();
      const finalUrl = entry.page.url();
      const authState = detectAuthState(html, finalUrl);
      log.info("SessionManager", `auth check for ${contextId}: ${authState} (url=${finalUrl.substring(0, 80)})`);
      return authState;
    } catch (err) {
      log.warn("SessionManager", `auth check failed for ${contextId}: ${String(err)}`);
      return "unknown";
    }
  }

  async releaseContext(contextId: string): Promise<void> {
    const entry = this.active.get(contextId);
    if (!entry) return;

    try {
      await entry.context.close();
    } catch (err) {
      log.warn("SessionManager", `error closing context ${contextId}: ${String(err)}`);
    }

    browserPool.release(entry.browser);
    this.active.delete(contextId);
    log.debug("SessionManager", `session context released ${contextId}`, {
      activeContexts: this.active.size,
    });
  }

  async releaseAll(): Promise<void> {
    const contextIds = Array.from(this.active.keys());
    for (const id of contextIds) {
      await this.releaseContext(id);
    }
  }

  getActiveCount(): number {
    return this.active.size;
  }

  getStats() {
    let totalRequests = 0;
    let totalErrors = 0;
    for (const entry of this.active.values()) {
      totalRequests += entry.requestCount;
      totalErrors += entry.errorCount;
    }
    return { activeContexts: this.active.size, totalRequests, totalErrors };
  }

  getRequestLimit(): number {
    return REQUEST_LIMIT_PER_SESSION;
  }
}

export const sessionContextManager = new SessionContextManager();
export { REQUEST_LIMIT_PER_SESSION, COOLDOWN_AFTER_LIMIT_MS, MAX_ERRORS_PER_SESSION };
export type { ActiveSessionContext };
