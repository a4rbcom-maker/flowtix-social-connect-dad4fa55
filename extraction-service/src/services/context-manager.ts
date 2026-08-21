import { type Browser, type BrowserContext } from "playwright";
import { browserPool } from "./browser-pool.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import { supabaseService } from "./supabase.js";
import type { CookieEntry, ProxyConfig } from "../types.js";
import { detectAuthState } from "../extractors/base.js";

const log = logger;

interface ActiveContext {
  context: BrowserContext;
  browser: Browser;
  sessionId: string;
}

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

/** Prefer the user agent captured when the session was imported — a different
 *  UA makes every extraction look like a login from an unknown device. */
export function resolveUserAgent(profileAgent?: string | null): string {
  const agent = profileAgent?.trim();
  return agent && agent.length >= 20 ? agent : DEFAULT_UA;
}

/** Convert Playwright context cookies to the persisted CookieEntry shape (JSON round-trip safe). */
export function toCookieEntries(playwrightCookies: Array<{ name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite?: string }>): CookieEntry[] {
  return playwrightCookies
    .filter((c) => c.name && c.value)
    .map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain || ".facebook.com",
      path: c.path || "/",
      expires: c.expires > 0 ? c.expires : undefined,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite as "Strict" | "Lax" | "None" | undefined,
    }));
}

/** Never overwrite a working profile with a cookie set that lacks the auth tokens —
 *  that would be saving a logged-OUT state over a logged-IN one. */
export function shouldPersistSessionCookies(cookies: CookieEntry[], essentialNames: string[] = ["c_user", "xs"]): boolean {
  const names = new Set(cookies.map((c) => c.name));
  return essentialNames.every((n) => names.has(n));
}

/** In-process per-session usage lock: Facebook invalidates sessions it sees
 *  active from two contexts at once (e.g. session-check during extraction). */
const sessionLocks = new Set<string>();

export function acquireSessionLock(platformKey: string): boolean {
  if (sessionLocks.has(platformKey)) return false;
  sessionLocks.add(platformKey);
  return true;
}

export function releaseSessionLock(platformKey: string): void {
  sessionLocks.delete(platformKey);
}

class ContextManager {
  private active: Map<string, ActiveContext> = new Map();

  async createContext(sessionId: string, cookies: CookieEntry[], proxy?: ProxyConfig | null, userAgent?: string | null): Promise<{ context: BrowserContext; page: import("playwright").Page; contextId: string }> {
    const lockKey = `fb:${sessionId}`;
    if (!acquireSessionLock(lockKey)) {
      throw new ExtractionError(
        ErrorCodes.SESSION_IN_USE,
        `الجلسة (${sessionId.slice(0, 8)}) قيد الاستخدام في عملية أخرى حالياً. يرجى الانتظار حتى تنتهي قبل إعادة الفحص أو الاستخدام.`,
      );
    }

    try {
      const browser = await browserPool.acquire();
      const contextId = `${sessionId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      // Log cookies being injected
      const essentialCookies = cookies.filter(c =>
        c.name === "c_user" || c.name === "xs" || c.name === "fr" || c.name === "datr"
      );
      const hasCUser = cookies.some(c => c.name === "c_user");
      const hasXs = cookies.some(c => c.name === "xs");
      const ua = resolveUserAgent(userAgent);
      log.info("ContextManager", `session ${sessionId.slice(0, 8)}: cookies injected = ${cookies.length} cookies (c_user=${hasCUser}, xs=${hasXs}, essential=${essentialCookies.length})${proxy ? `, proxy=${proxy.label || proxy.url.split('@').pop() || 'yes'}` : ''}, ua=${ua.substring(0, 40)}...`);

      const contextOpts: any = {
        userAgent: ua,
        viewport: { width: 1366, height: 768 },
        locale: "ar-AR",
        timezoneId: "Africa/Cairo",
        permissions: ["geolocation"],
        geolocation: { latitude: 30.0444, longitude: 31.2357 },
        serviceWorkers: "block",
        extraHTTPHeaders: {
          "Accept-Language": "ar-AR,ar;q=0.9,en-US;q=0.8,en;q=0.7",
        },
      };

      // Proxy support: parse proxy URL into Playwright format
      if (proxy && proxy.url) {
        const parsed = parseProxyUrl(proxy.url);
        if (parsed) {
          contextOpts.proxy = parsed;
          log.info("ContextManager", `session ${sessionId.slice(0, 8)}: proxy configured (${parsed.server})`);
        } else {
          log.warn("ContextManager", `session ${sessionId.slice(0, 8)}: invalid proxy URL, ignoring — ${proxy.url}`);
        }
      }

      const context = await browser.newContext(contextOpts);

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

      if (config.blockResources) {
        await applyResourceBlocking(context);
        log.info("ContextManager", `session ${sessionId.slice(0, 8)}: resource blocking ON (images/media/fonts)`);
      }

      const page = await context.newPage();
      page.setDefaultTimeout(config.fbNavTimeoutMs);
      page.setDefaultNavigationTimeout(config.fbNavTimeoutMs);

      // Verify session is logged in (not guest)
      try {
        await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(3000);
        const html = await page.content();
        const finalUrl = page.url();
        const authState = detectAuthState(html, finalUrl);
        const isVerified = authState === "authenticated";
        log.info("ContextManager", `session ${sessionId.slice(0, 8)}: verified = ${isVerified ? "logged_in" : "guest"} (authState=${authState}, url=${finalUrl.substring(0, 60)})`);

        if (!isVerified) {
          log.error("ContextManager", `session ${sessionId.slice(0, 8)}: GUEST session detected — cookies may be expired. Stopping job.`);
          await context.close();
          browserPool.release(browser);
          throw new ExtractionError(
            ErrorCodes.SESSION_EXPIRED,
            `Session ${sessionId.slice(0, 8)} is NOT logged in (guest). Cookies expired or invalid. Please re-import cookies.`
          );
        }
      } catch (err) {
        if (err instanceof ExtractionError) throw err;
        log.warn("ContextManager", `session ${sessionId.slice(0, 8)}: verification failed (continuing): ${String(err).substring(0, 100)}`);
      }

      this.active.set(contextId, { context, browser, sessionId });
      log.debug("ContextManager", `context created ${contextId}`, {
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

    // Capture rotated cookies BEFORE closing — Facebook refreshes the `xs`
    // token during browsing; dropping it invalidates the stored session.
    let rotated: CookieEntry[] = [];
    try {
      rotated = toCookieEntries(await entry.context.cookies());
    } catch (err) {
      log.warn("ContextManager", `error reading cookies from ${contextId}: ${String(err)}`);
    }

    try {
      await entry.context.close();
    } catch (err) {
      log.warn("ContextManager", `error closing context ${contextId}: ${String(err)}`);
    }

    browserPool.release(entry.browser);
    releaseSessionLock(`fb:${entry.sessionId}`);

    if (rotated.length > 0 && shouldPersistSessionCookies(rotated)) {
      try {
        await supabaseService.updateSessionCookies(entry.sessionId, rotated);
      } catch (err) {
        log.warn("ContextManager", `persisting rotated cookies failed for ${entry.sessionId.slice(0, 8)}: ${String(err)}`);
      }
    } else if (rotated.length > 0) {
      log.warn("ContextManager", `session ${entry.sessionId.slice(0, 8)}: rotated cookies lack auth tokens — keeping previous stored cookies`);
    }

    log.debug("ContextManager", `context released ${contextId}`, {
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

export async function applyResourceBlocking(context: BrowserContext): Promise<void> {
  await context.route("**/*", (route) => {
    const type = route.request().resourceType();
    if (type === "image" || type === "media" || type === "font") {
      return route.abort();
    }
    return route.continue();
  });
}

export function parseProxyUrl(proxyUrl: string): { server: string; username?: string; password?: string } | null {
  try {
    // supports: http://user:pass@host:port, socks5://host:port, http://host:port
    const m = proxyUrl.match(/^(https?|socks[45]):\/\/(?:([^:@]+):([^@]+)@)?([^:]+)(?::(\d+))?$/);
    if (!m) {
      // try without protocol
      const m2 = proxyUrl.match(/^(?:([^:@]+):([^@]+)@)?([^:]+)(?::(\d+))?$/);
      if (m2) {
        return {
          server: `http://${m2[3]}:${m2[4] || "8080"}`,
          username: m2[1] || undefined,
          password: m2[2] || undefined,
        };
      }
      return null;
    }
    const protocol = m[1];
    const host = m[4];
    const port = m[5] || (protocol === "socks5" ? "1080" : "8080");
    return {
      server: `${protocol}://${host}:${port}`,
      username: m[2] || undefined,
      password: m[3] || undefined,
    };
  } catch {
    return null;
  }
}

export const contextManager = new ContextManager();
