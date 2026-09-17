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

interface RawGroup {
  id: string;
  name: string;
  picture_url: string;
  privacy: string;
  member_count: string;
}

/** Extract group cards from the /groups/joins/ page.
 *  DOM: each group renders an <a href="/groups/<id>"> whose closest card container
 *  carries the name, avatar <image>, and role/membership text.
 *  Fallback: __typename:"Group" JSON nodes embedded in page scripts. */
function parseGroupsFromDom(): RawGroup[] {
  const cards = document.querySelectorAll<HTMLElement>('a[href*="/groups/"]');
  const out = new Map<string, RawGroup>();
  for (const a of cards) {
    const href = a.getAttribute("href") || "";
    const m = href.match(/facebook\.com\/groups\/([A-Za-z0-9._-]{3,})\/?/) || href.match(/^\/groups\/([A-Za-z0-9._-]{3,})\/?/);
    if (!m) continue;
    if (/^(feed|discover|joins|create|events)$/.test(m[1])) continue;
    const id = m[1];
    if (out.has(id)) continue;
    // climb to the card container for name/avatar
    let node: HTMLElement | null = a;
    for (let i = 0; i < 6 && node; i++) {
      const txt = (node.innerText || "").trim();
      if (txt.length > 3 && txt.includes("\n")) {
        const lines = txt.split("\n").map(s => s.trim()).filter(Boolean);
        const name = lines[0] || "";
        if (name.length > 1 && !/^(Groups|المجموعات|مجموعاتك|Your groups|See all|جميع المجموعات)$/.test(name)) {
          const img = (node.querySelector("image[href], img[src]") as SVGImageElement | HTMLImageElement | null);
          const metaLines = lines.slice(1).join(" · ");
          out.set(id, {
            id,
            name,
            picture_url: img ? (img.getAttribute("href") || img.getAttribute("src") || "") : "",
            privacy: /خصوصية|Private|خاص/i.test(metaLines) ? "Private" : "Public",
            member_count: (metaLines.match(/[\d.,]+\s*[KM]?\+?/) || [""])[0],
            // raw extras appended below
            ...({ membership_line: metaLines } as any),
          } as RawGroup & { membership_line: string });
          break;
        }
      }
      node = node.parentElement;
    }
  }
  return [...out.values()];
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
      await page.goto(`https://www.facebook.com/groups/joins/?nav_source=tab&ordering=viewer_added`, {
        waitUntil: "domcontentloaded", timeout: config.fbNavTimeoutMs,
      });
      await page.waitForTimeout(5000);
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1500);

      // Login guard — a guest/downgraded session renders the login form instead of groups
      const loginForm = await page.evaluate(`(() => !!document.querySelector('form[action*="login"]'))()`);
      if (loginForm) {
        throw new ExtractionError(ErrorCodes.SESSION_EXPIRED, "الجلسة منتهية أو غير موثوقة — أعد ربط الجلسة من صفحة الجلسات");
      }

      const groups = await page.evaluate(`(${parseGroupsFromDom.toString()})()`) as RawGroup[];

      // scroll to load more cards (FB virtualizes long lists)
      for (let i = 0; i < 6; i++) {
        const before = groups.length;
        await page.evaluate(`window.scrollTo(0, document.body.scrollHeight)`);
        await page.waitForTimeout(1800);
        const more = await page.evaluate(`(${parseGroupsFromDom})()`) as RawGroup[];
        for (const g of more) if (!groups.some(x => x.id === g.id)) groups.push(g);
        if (groups.length === before) break;
      }

      log.info("ListGroups", `harvested ${groups.length} groups via DOM cards`);
      if (groups.length === 0) {
        // platform may have removed the surface for this account — keep honest notice
        return res.json({
          groups: [],
          notice: {
            code: ErrorCodes.GROUPS_NOT_AVAILABLE,
            message: "قائمة الجروبات غير متاحة للعميل الحالي. فيسبوك لا يسمح بالوصول للجروبات عبر الويب.",
            platform_limitation: true
          }
        });
      }

      const managed: ManagedGroup[] = groups.map(g => {
        const line = (g as any).membership_line || "";
        return {
          id: g.id,
          name: g.name,
          picture_url: g.picture_url,
          member_count: g.member_count || "",
          privacy: g.privacy,
          role: /Admin|مدير/i.test(line) ? "admin" : /Moderator|مشرف/i.test(line) ? "moderator" : "member",
          last_active: "",
          can_post: true,
        };
      });
      return res.json({ groups: managed });
    } finally {
      await contextManager.releaseContext(contextId);
    }
  } catch (err) {
    if (err instanceof ExtractionError) {
      log.error("ListGroups", `error: ${err.code}`, { message: err.message });
      const status = err.code === ErrorCodes.SESSION_EXPIRED ? 401 : 500;
      return res.status(status).json({ error: { code: err.code, message: err.message } });
    }
    const code = ErrorCodes.UNKNOWN_ERROR;
    const message = err instanceof Error ? err.message : String(err);
    log.error("ListGroups", `error: ${code}`, { message });
    return res.status(500).json({ error: { code, message } });
  }
});

export default router;
