import { Router } from "express";
import { z } from "zod";
import { supabaseClient as sb } from "../services/supabase.js";
import { igSupabaseService } from "../services/ig-supabase.js";
import { igContextManager } from "../services/ig-context-manager.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import { logger } from "../logger.js";
import type { CookieEntry } from "../types.js";

const log = logger;
const router = Router();

export const igSessionCheckSchema = z.object({
  session_id: z.string().min(1),
});

export const igSessionImportSchema = z.object({
  user_id: z.string().min(1),
  name: z.string().min(1),
  cookies: z.array(z.record(z.unknown())).min(1),
});

async function readIgUsernameAndAvatar(page: import("playwright").Page): Promise<{ username: string | null; avatar: string | null }> {
  const username = await page.evaluate(() => {
    const links = document.querySelectorAll('a[href^="/"]');
    for (const a of links) {
      const href = a.getAttribute("href");
      if (href && /^\/([a-zA-Z0-9._]+)\/?$/.test(href)) {
        return href.replace(/^\//, "").replace(/\/$/, "");
      }
    }
    return null;
  }).catch(() => null);

  const avatar = await page.evaluate(() => {
    const img = document.querySelector('img[alt*="profile" i], img[alt*="photo" i], header img[src*="scontent"]');
    return img?.getAttribute("src") || null;
  }).catch(() => null);

  return { username, avatar };
}

router.post("/ig/sessions/import", async (req, res) => {
  try {
    const parsed = igSessionImportSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { code: ErrorCodes.INVALID_INPUT, message: parsed.error.issues.map((i) => i.message).join(", ") },
      });
    }

    const { user_id, name, cookies } = parsed.data;

    // Check critical cookies
    const cookieMap = new Map<string, string>();
    for (const c of cookies) {
      const n = String(c.name ?? c.Name ?? "");
      const v = String(c.value ?? c.Value ?? "");
      if (n && v) cookieMap.set(n, v);
    }
    const missing = ["sessionid", "ds_user_id", "csrftoken"].filter((k) => !cookieMap.has(k));
    if (missing.length > 0) {
      return res.status(400).json({
        error: {
          code: "INVALID_COOKIES",
          message: `الكوكيز تفتقد القيم الحاسمة: ${missing.join(", ")}. تأكد من وجود sessionid و ds_user_id و csrftoken.`,
        },
      });
    }

    const igUserId = cookieMap.get("ds_user_id") || null;

    // Insert session
    const { data: session, error: sErr } = await sb
      .from("ig_sessions")
      .insert({ user_id, name, status: "connected", ig_user_id: igUserId })
      .select("id, name")
      .single();
    if (sErr) throw new ExtractionError(ErrorCodes.EXTRACTION_FAILED, `Create IG session failed: ${sErr.message}`);

    // Insert browser profile (store cookies as JSON string)
    const cookiesJson = JSON.stringify(cookies);
    const { error: pErr } = await sb
      .from("ig_browser_profiles")
      .insert({ session_id: session.id, cookies_enc: cookiesJson });
    if (pErr) throw new ExtractionError(ErrorCodes.EXTRACTION_FAILED, `Create IG profile failed: ${pErr.message}`);

    // Immediate session check
    let finalStatus = "connected";
    let igUsername: string | null = null;
    let avatarUrl: string | null = null;
    try {
      const cookieEntries: CookieEntry[] = cookies
        .map((c: Record<string, unknown>) => ({
          name: String(c.name ?? c.Name ?? ""),
          value: String(c.value ?? c.Value ?? ""),
          domain: String(c.domain || ".instagram.com"),
          path: String(c.path || "/"),
          expires: c.expirationDate ? Number(c.expirationDate) : undefined,
          httpOnly: !!c.httpOnly,
          secure: c.secure !== false,
        }))
        .filter((c) => c.name && c.value);

      const { page, contextId } = await igContextManager.createContext(session.id, cookieEntries);
      try {
        await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(3000);
        const url = page.url();
        if (url.includes("/accounts/login")) {
          finalStatus = "disconnected";
          log.info("IgSessions", `import: session ${session.id.slice(0, 8)} redirected to login`);
        } else {
          const info = await readIgUsernameAndAvatar(page);
          igUsername = info.username;
          avatarUrl = info.avatar;
          log.info("IgSessions", `import: session ${session.id.slice(0, 8)} checked, user=${igUsername}`);
        }
      } finally {
        await igContextManager.releaseContext(contextId);
      }
    } catch (err) {
      log.warn("IgSessions", `import immediate-check failed for session ${session.id.slice(0, 8)}: ${String(err).substring(0, 100)}`);
      finalStatus = "disconnected";
    }

    // Update session with check results
    await sb
      .from("ig_sessions")
      .update({
        status: finalStatus,
        ig_username: igUsername,
        avatar_url: avatarUrl,
        last_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", session.id);

    log.info("IgSessions", `import done: session ${session.id.slice(0, 8)} status=${finalStatus}`);

    return res.json({
      session_id: session.id,
      status: finalStatus,
      ig_username: igUsername,
    });
  } catch (err) {
    const code = err instanceof ExtractionError ? err.code : ErrorCodes.UNKNOWN_ERROR;
    const message = err instanceof Error ? err.message : String(err);
    log.error("IgSessions", `import error: ${code}`, { message });
    return res.status(500).json({ error: { code, message } });
  }
});

router.post("/ig/session-check", async (req, res) => {
  try {
    const parsed = igSessionCheckSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { code: ErrorCodes.INVALID_INPUT, message: parsed.error.issues.map((i) => i.message).join(", ") },
      });
    }

    const { session_id } = parsed.data;
    const { cookies } = await igSupabaseService.getIgSessionAndCookies(session_id);
    const { page, contextId } = await igContextManager.createContext(session_id, cookies);

    try {
      await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(3000);
      const url = page.url();
      const html = await page.content();

      const redirectedToLogin = url.includes("/accounts/login");
      const hasLoginForm = html.includes('name="username"') && html.includes('name="password"');
      const authenticated = !redirectedToLogin && !hasLoginForm;

      if (authenticated) {
        const info = await readIgUsernameAndAvatar(page);

        await sb
          .from("ig_sessions")
          .update({
            status: "connected",
            ig_username: info.username,
            avatar_url: info.avatar,
            last_checked_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", session_id);

        return res.json({
          session_id,
          status: "connected",
          auth_state: "authenticated",
          ig_username: info.username,
          avatar_url: info.avatar,
        });
      }

      await sb
        .from("ig_sessions")
        .update({
          status: "disconnected",
          last_checked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", session_id);

      return res.json({
        session_id,
        status: "disconnected",
        auth_state: "needs_login",
      });
    } finally {
      await igContextManager.releaseContext(contextId);
    }
  } catch (err) {
    const code = err instanceof ExtractionError ? err.code : ErrorCodes.UNKNOWN_ERROR;
    const message = err instanceof Error ? err.message : String(err);
    log.error("IgSessions", `session-check error: ${code}`, { message });
    return res.status(500).json({ error: { code, message } });
  }
});

export default router;
