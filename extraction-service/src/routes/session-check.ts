import { Router } from "express";
import { z } from "zod";
import { supabaseService } from "../services/supabase.js";
import { contextManager } from "../services/context-manager.js";
import { detectAuthState, authStateToMessage, authStateToErrorCode } from "../extractors/base.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import { logger } from "../logger.js";
import { config } from "../config.js";
import type { AuthState } from "../types.js";

const log = logger;
const router = Router();

const schema = z.object({
  session_id: z.string().min(1),
});

router.post("/session-check", async (req, res) => {
  try {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { code: ErrorCodes.INVALID_INPUT, message: parsed.error.issues.map((i) => i.message).join(", ") },
      });
    }

    const { session_id } = parsed.data;
    log.info("SessionCheck", `checking session ${session_id}`);

    const { session, cookies, userAgent, storageState } = await supabaseService.getSessionAndCookies(session_id);

    // createContext verifies the session against Facebook and throws
    // SESSION_EXPIRED for guest cookies. Surface that as a clean
    // "disconnected" verdict (and persist it) instead of a 500 — otherwise
    // dead sessions keep showing "connected" in the dashboard forever.
    let page: import("playwright").Page;
    let contextId: string;
    try {
      ({ page, contextId } = await contextManager.createContext(session_id, cookies, undefined, userAgent, storageState));
    } catch (err) {
      if (err instanceof ExtractionError && (err.code === ErrorCodes.SESSION_EXPIRED || err.code === ErrorCodes.AUTH_FAILED)) {
        await supabaseService.updateSessionStatus(session_id, "disconnected", err.message).catch(() => {});
        return res.json({
          session_id,
          status: "disconnected",
          auth_state: "needs_login" as AuthState,
          message: err.message,
        });
      }
      throw err;
    }
    try {
      await page.goto("https://www.facebook.com/", {
        waitUntil: "domcontentloaded",
        timeout: config.fbNavTimeoutMs,
      });
      await page.waitForTimeout(3000);

      const html = await page.content();
      const finalUrl = page.url();
      const authState = detectAuthState(html, finalUrl);

      log.info("SessionCheck", `auth_state=${authState}`, {
        htmlLen: html.length,
        finalUrl,
        sessionId: session_id,
      });

      if (authState === "authenticated") {
        const cUserMatch = cookies.find((c) => c.name === "c_user");
        const fbUserId = cUserMatch?.value ?? null;

        if (session.status !== "connected") {
          await supabaseService.updateSessionStatus(session_id, "connected", "Live Facebook auth check passed");
        }
        if (fbUserId) {
          await supabaseService.updateSessionFbUserId(session_id, fbUserId);
        }

        return res.json({
          session_id,
          status: "connected",
          auth_state: "authenticated" as AuthState,
          message: "Session is live and authenticated.",
          fb_user_id: fbUserId,
        });
      }

      if (session.status === "connected") {
        await supabaseService.updateSessionStatus(session_id, "disconnected", authStateToMessage(authState));
      }

      return res.json({
        session_id,
        status: "disconnected",
        auth_state: authState,
        message: authStateToMessage(authState),
      });
    } finally {
      await contextManager.releaseContext(contextId);
    }
  } catch (err) {
    const code = err instanceof ExtractionError ? err.code : ErrorCodes.UNKNOWN_ERROR;
    const message = err instanceof Error ? err.message : String(err);
    log.error("SessionCheck", `error: ${code}`, { message });
    return res.status(500).json({ error: { code, message } });
  }
});

export default router;
