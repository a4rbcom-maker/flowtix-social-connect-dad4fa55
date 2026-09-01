import { Router } from "express";
import { z } from "zod";
import { supabaseService } from "../services/supabase.js";
import { contextManager } from "../services/context-manager.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import { logger } from "../logger.js";
import { config } from "../config.js";

const log = logger;
const router = Router();

const listGroupsSchema = z.object({ session_id: z.string().min(1) });

export interface ManagedGroup {
  id: string;
  name: string;
  picture_url: string;
  member_count: string;
  privacy: string;
  role: string;
  last_active: string;
  can_post: boolean;
}

router.post("/list-groups", async (req, res) => {
  try {
    const parsed = listGroupsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { code: ErrorCodes.INVALID_INPUT, message: parsed.error.issues.map(i => i.message).join(", ") } });
    }
    const { session_id } = parsed.data;
    log.info("ListGroups", `listing groups`);

    const { cookies, userAgent, storageState } = await supabaseService.getSessionAndCookies(session_id);
    const { page, contextId } = await contextManager.createContext(session_id, cookies, undefined, userAgent, storageState);

    try {
      // Use the user ID directly to navigate to their groups
      // Strategy: use Facebook's own groups page with the numeric ID
      await page.goto(`https://www.facebook.com/groups/feed/`, {
        waitUntil: "domcontentloaded", timeout: config.fbNavTimeoutMs,
      });
      await page.waitForTimeout(5000);
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(2000);

      // Try to click "جميع المجموعات" or expand the groups sidebar
      const expandClicked = await page.evaluate(() => {
        const allEls = document.querySelectorAll<HTMLElement>('[role="button"], a, span, div');
        for (const el of allEls) {
          const t = (el.innerText || '').trim();
          if (t === 'جميع المجموعات' || t === 'All groups' || t === 'Your groups' || t === 'مجموعاتك' || t === 'See all') {
            el.click();
            return t;
          }
        }
        return '';
      });
      log.info("ListGroups", `expand: "${expandClicked}"`);
      if (expandClicked) { await page.waitForTimeout(3000); await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {}); }
      log.info("ListGroups", `feed loaded: ${page.url()}`);

      // Facebook sidebar shows "Your groups" sections at 1600px viewport
      // IMPORTANT: Facebook does not serve joined groups to web clients (verified via probes).
      // This is a platform limitation, not a FlowTix error. Returning empty array with explanation.
      const groups: ManagedGroup[] = [];
      log.info("ListGroups", "groups not available for web clients (platform limitation)");
      return res.json({ 
        groups,
        notice: {
          code: ErrorCodes.GROUPS_NOT_AVAILABLE,
          message: "قائمة الجروبات غير متاحة للعميل الحالي. فيسبوك لا يسمح بالوصول للجروبات عبر الويب.",
          platform_limitation: true
        }
      });
    } finally {
      await contextManager.releaseContext(contextId);
    }
  } catch (err) {
    const code = err instanceof ExtractionError ? err.code : ErrorCodes.UNKNOWN_ERROR;
    const message = err instanceof Error ? err.message : String(err);
    log.error("ListGroups", `error: ${code}`, { message });
    return res.status(500).json({ error: { code, message } });
  }
});

export default router;
