import { type Browser, type BrowserContext } from "playwright";
import { browserPool } from "./browser-pool.js";
import { parseProxyUrl, toCookieEntries, shouldPersistSessionCookies, acquireSessionLock, releaseSessionLock } from "./context-manager.js";
import { igSupabaseService } from "./ig-supabase.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import type { CookieEntry, ProxyConfig } from "../types.js";

const log = logger;

interface ActiveContext {
  context: BrowserContext;
  browser: Browser;
  sessionId: string;
}

const IG_DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

function resolveIgUserAgent(profileAgent?: string | null): string {
  const agent = profileAgent?.trim();
  return agent && agent.length >= 20 ? agent : IG_DEFAULT_UA;
}

class IgContextManager {
  private active: Map<string, ActiveContext> = new Map();

  async createContext(sessionId: string, cookies: CookieEntry[], proxy?: ProxyConfig | null, userAgent?: string | null): Promise<{ context: BrowserContext; page: import("playwright").Page; contextId: string }> {
    const lockKey = `ig:${sessionId}`;
    if (!acquireSessionLock(lockKey)) {
      throw new ExtractionError(
        ErrorCodes.SESSION_IN_USE,
        `جلسة إنستجرام (${sessionId.slice(0, 8)}) قيد الاستخدام في عملية أخرى حالياً. يرجى الانتظار حتى تنتهي.`,
      );
    }

    try {
      const browser = await browserPool.acquire();
      const contextId = `${sessionId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      const hasSessionId = cookies.some((c) => c.name === "sessionid");
      const hasDsUserId = cookies.some((c) => c.name === "ds_user_id");
      const ua = resolveIgUserAgent(userAgent);
      log.info("IgContextManager", `session ${sessionId.slice(0, 8)}: cookies injected = ${cookies.length} cookies (sessionid=${hasSessionId}, ds_user_id=${hasDsUserId})${proxy ? `, proxy=${proxy.label || proxy.url.split("@").pop() || "yes"}` : ""}, ua=${ua.substring(0, 40)}...`);

      const contextOpts: any = {
        userAgent: ua,
        viewport: { width: 1366, height: 768 },
        locale: "en-US",
        timezoneId: "Africa/Cairo",
        extraHTTPHeaders: {
          "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
        },
      };

      if (proxy && proxy.url) {
        const parsed = parseProxyUrl(proxy.url);
        if (parsed) {
          contextOpts.proxy = parsed;
          log.info("IgContextManager", `session ${sessionId.slice(0, 8)}: proxy configured (${parsed.server})`);
        } else {
          log.warn("IgContextManager", `session ${sessionId.slice(0, 8)}: invalid proxy URL, ignoring — ${proxy.url}`);
        }
      }

      const context = await browser.newContext(contextOpts);

      const playwrightCookies = cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain || ".instagram.com",
        path: c.path || "/",
        expires: c.expires,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite as "Strict" | "Lax" | "None" | undefined,
      }));

      await context.addCookies(playwrightCookies);

      const page = await context.newPage();
      page.setDefaultTimeout(config.igNavTimeoutMs);
      page.setDefaultNavigationTimeout(config.igNavTimeoutMs);

      // Verify session is logged in (not redirected to /accounts/login)
      try {
        await page.goto(`${config.igBaseUrl}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(3000);
        const finalUrl = page.url();
        const redirectedToLogin = finalUrl.includes("/accounts/login");
        const html = await page.content();
        const hasLoginForm = html.includes('name="username"') && html.includes('name="password"');
        const isVerified = !redirectedToLogin && !hasLoginForm;
        log.info("IgContextManager", `session ${sessionId.slice(0, 8)}: verified = ${isVerified ? "logged_in" : "guest"} (url=${finalUrl.substring(0, 60)})`);

        if (!isVerified) {
          log.error("IgContextManager", `session ${sessionId.slice(0, 8)}: GUEST session detected — cookies may be expired.`);
          await context.close();
          browserPool.release(browser);
          throw new ExtractionError(
            ErrorCodes.SESSION_EXPIRED,
            `IG session ${sessionId.slice(0, 8)} is NOT logged in (guest). Cookies expired or invalid. Please re-import cookies.`
          );
        }
      } catch (err) {
        if (err instanceof ExtractionError) throw err;
        log.warn("IgContextManager", `session ${sessionId.slice(0, 8)}: verification failed (continuing): ${String(err).substring(0, 100)}`);
      }

      this.active.set(contextId, { context, browser, sessionId });
      log.debug("IgContextManager", `context created ${contextId}`, {
        cookieCount: cookies.length,
        activeContexts: this.active.size,
      });

      return { context, page, contextId };
    } catch (err) {
      releaseSessionLock(lockKey);
      throw err;
    }
  }

  async releaseContext(contextId: string): Promise<void> {
    const entry = this.active.get(contextId);
    if (!entry) return;
    this.active.delete(contextId);

    let rotated: CookieEntry[] = [];
    try {
      rotated = toCookieEntries(await entry.context.cookies()).map((c) => ({
        ...c,
        domain: c.domain || ".instagram.com",
      }));
    } catch (err) {
      log.warn("IgContextManager", `error reading cookies from ${contextId}: ${String(err)}`);
    }

    try {
      await entry.context.close();
    } catch (err) {
      log.warn("IgContextManager", `error closing context ${contextId}: ${String(err)}`);
    }

    browserPool.release(entry.browser);
    releaseSessionLock(`ig:${entry.sessionId}`);

    if (rotated.length > 0 && shouldPersistSessionCookies(rotated, ["sessionid", "ds_user_id"])) {
      try {
        await igSupabaseService.updateIgSessionCookies(entry.sessionId, rotated);
      } catch (err) {
        log.warn("IgContextManager", `persisting rotated IG cookies failed for ${entry.sessionId.slice(0, 8)}: ${String(err)}`);
      }
    } else if (rotated.length > 0) {
      log.warn("IgContextManager", `IG session ${entry.sessionId.slice(0, 8)}: rotated cookies lack auth tokens — keeping previous stored cookies`);
    }

    log.debug("IgContextManager", `context released ${contextId}`, {
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
}

export const igContextManager = new IgContextManager();
