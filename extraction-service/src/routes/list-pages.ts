import { Router } from "express";
import { z } from "zod";
import { supabaseService } from "../services/supabase.js";
import { contextManager } from "../services/context-manager.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import { logger } from "../logger.js";
import { config } from "../config.js";

const log = logger;
const router = Router();

const listPagesSchema = z.object({
  session_id: z.string().min(1),
});

export interface ManagedPage {
  id: string;
  name: string;
  username: string;
  followers: string;
  picture_url: string;
  category: string;
}

router.post("/list-pages", async (req, res) => {
  try {
    const parsed = listPagesSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { code: ErrorCodes.INVALID_INPUT, message: parsed.error.issues.map((i) => i.message).join(", ") },
      });
    }

    const { session_id } = parsed.data;
    log.info("ListPages", `listing pages for session ${session_id}`);

    const { cookies } = await supabaseService.getSessionAndCookies(session_id);
    const { page, contextId } = await contextManager.createContext(session_id, cookies);

    try {
      await page.goto("https://www.facebook.com/pages/?category=your_pages", {
        waitUntil: "domcontentloaded",
        timeout: config.fbNavTimeoutMs,
      });
      await page.waitForTimeout(3000);
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {
        log.debug("ListPages", "networkidle timed out, continuing");
      });
      await page.waitForTimeout(1500);

      const finalUrl = page.url();
      log.info("ListPages", `pages page loaded`, { finalUrl });

      const pages = await page.evaluate((): ManagedPage[] => {
        const results: ManagedPage[] = [];
        const seen = new Set<string>();

        const SKIP = new Set([
          "facebook", "www", "m", "mbasic", "business", "pages", "profile",
          "profile.php", "groups", "watch", "marketplace", "gaming", "settings",
          "messages", "notifications", "friends", "photos", "videos", "events",
          "about", "community", "followers", "following", "reviews", "posts",
          "channels", "home", "feed", "help", "login", "signup", "privacy",
          "terms", "search", "members", "ads", "stories", "reels", "live",
          "permalink", "photo", "share", "bookmarks", "saved", "explore",
          "stream", "tr", "findsupport", "legal", "payments", "fundraisers",
          "create", "developers", "careers", "policy", "latest", "switch", "page",
          "promote", "manage",
        ]);

        const allLinks = document.querySelectorAll<HTMLAnchorElement>("a[href]");

        for (const link of allLinks) {
          const href = link.getAttribute("href") || "";
          if (!href) continue;

          let username = "";
          const m = href.match(/facebook\.com\/([a-zA-Z0-9.]+)/);
          if (m && !SKIP.has(m[1].toLowerCase()) && m[1].length >= 3) username = m[1];

          if (!username) {
            const pid = href.match(/profile\.php\?id=(\d+)/);
            if (pid) username = `id_${pid[1]}`;
          }

          if (!username && href.startsWith("/")) {
            const s = href.split("?")[0].split("#")[0].replace(/\/+$/, "").split("/").filter(Boolean);
            if (s.length === 1 && /^[a-zA-Z0-9.]{3,60}$/.test(s[0]) && !SKIP.has(s[0].toLowerCase())) {
              username = s[0];
            }
          }
          if (!username || /^(pages|latest|business|switch)$/i.test(username)) continue;
          if (seen.has(username)) continue;
          seen.add(username);

          // Walk up to find the page card: must have substantial text and the username link
          let card: HTMLElement | null = link;
          for (let d = 0; d < 10 && card; d++) {
            const text = (card.innerText || "").trim();
            if (text.length > 30 && text.includes(username)) break;
            card = card.parentElement;
          }
          if (!card) card = link;

          const cardText = (card.innerText || "").trim();
          const lines = cardText.split("\n").map((l: string) => l.trim()).filter(Boolean);

          // First non-empty line that's NOT the username and NOT a notification/message count
          let name = "";
          for (const line of lines) {
            if (!line || line.length < 2 || line.length > 80) continue;
            if (line === username || line.toLowerCase() === username.toLowerCase()) continue;
            if (/^\d+/.test(line) && (line.includes("إشعار") || line.includes("رسالة") || line.includes("notification") || line.includes("message"))) continue;
            if (line.includes("إنشاء منشور") || line.includes("ترويج") || line.includes("Create Post") || line.includes("Promote")) continue;
            if (line.includes("Switch") || line.includes("تبديل")) continue;
            name = line;
            break;
          }
          if (!name || name.length < 2) name = username;

          let pictureUrl = "";
          const imgs = card.querySelectorAll("img");
          for (const img of imgs) {
            const src = (img as HTMLImageElement).src || "";
            if (src.startsWith("http")) { pictureUrl = src; break; }
          }

          let followers = "";
          for (const line of lines) {
            const fm = line.match(/(\d[\d,.]*\s*[kKmM]?)\s*(?:متابع|مُتابع|follower|like|إعجاب)/i);
            if (fm) { followers = fm[1].replace(/\s+/g, ""); break; }
          }

          results.push({ id: username, name, username, followers, picture_url: pictureUrl, category: "" });
        }

        return results;
      });

      log.info("ListPages", `found ${pages.length} pages`);
      return res.json({ pages });
    } finally {
      await contextManager.releaseContext(contextId);
    }
  } catch (err) {
    const code = err instanceof ExtractionError ? err.code : ErrorCodes.UNKNOWN_ERROR;
    const message = err instanceof Error ? err.message : String(err);
    log.error("ListPages", `error: ${code}`, { message });
    return res.status(500).json({ error: { code, message } });
  }
});

export default router;
