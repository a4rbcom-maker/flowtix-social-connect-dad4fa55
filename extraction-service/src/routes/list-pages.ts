import { Router } from "express";
import { z } from "zod";
import { supabaseService } from "../services/supabase.js";
import { contextManager } from "../services/context-manager.js";
import { ExtractionError, ErrorCodes } from "../errors.js";
import { logger } from "../logger.js";
import { config } from "../config.js";
import { extractManagedPages, isManagedPageCandidate, type ManagedPageCandidate } from "./managed-pages-filter.js";

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

/** Parse concatenated/batch GraphQL JSON (same approach as messenger deepParse). */
function parseBodies(clean: string): unknown[] {
  const objects: unknown[] = [];
  try {
    objects.push(JSON.parse(clean));
  } catch {
    let depth = 0;
    let start = 0;
    let inStr = false;
    let esc = false;
    for (let i = 0; i < clean.length; i++) {
      const ch = clean[i];
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === "\"") { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{") { if (depth === 0) start = i; depth++; }
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try { objects.push(JSON.parse(clean.substring(start, i + 1))); } catch { /* skip */ }
        }
      }
    }
  }
  return objects;
}

/**
 * DOM fallback (probe 2026-09-20): the see-all profile-switcher sheet renders
 * one [role="button"] row per profile/page. The GraphQL interception layer can
 * miss the payload (relay cache renders the sheet with no fresh network call),
 * so harvest names from the sheet and match them against entities captured from
 * the page's embedded JSON (switcher/bookmark payloads).
 */
function dumpSwitcherSheetRows(): { name: string; notificationCount: number }[] {
  const rows: { name: string; notificationCount: number }[] = [];
  const dialogs = document.querySelectorAll('[role="dialog"]');
  for (const d of dialogs) {
    const heading = (d.querySelector("h2,h1,h3") as HTMLElement | null)?.innerText || "";
    // "ملفاتك الشخصية وصفحاتك" / "Your profiles and pages"
    if (!/(صفحاتك|profiles and pages|your profiles)/i.test(heading)) continue;
    for (const el of Array.from(d.querySelectorAll('[role="button"]'))) {
      const first = (el.textContent || "").trim().split("\n")[0]?.trim() || "";
      if (!first || first.length > 80) continue;
      if (/^(إنشاء|Create|الانتقال|See all|عرض كل)/.test(first)) continue;
      if (/إعدادات حساب|Meta$/.test(first)) continue;
      const m = first.match(/^(\d+)\s*(من الإشعارات|notifications)/);
      if (m) continue; // counter line, not a row title
      if (!rows.some(r => r.name === first)) rows.push({ name: first, notificationCount: 0 });
    }
  }
  return rows;
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
    const startedAt = Date.now();
    log.info("ListPages", `listing pages for session ${session_id}`);

    const { cookies, userAgent, storageState } = await supabaseService.getSessionAndCookies(session_id);
    // skipAuthProbe: the identity-switcher flow below navigates facebook.com
    // itself — a second home-page probe doubles the foreign signals on a young
    // session for nothing.
    const { page, contextId } = await contextManager.createContext(session_id, cookies, undefined, userAgent, storageState, { skipAuthProbe: true });

    // GraphQL responses captured while the identity switcher opens.
    const captured: string[] = [];
    const onResp = (resp: import("playwright").Response): void => {
      const url = resp.url();
      if (!url.includes("graphql") || resp.status() !== 200) return;
      captured.push("");
      const slot = captured.length - 1;
      resp.text().then((text) => {
        captured[slot] = text && text.length >= 20 ? text : "";
      }).catch(() => { captured[slot] = ""; });
    };
    page.on("response", onResp);

    try {
      // ─── One navigation, then open the identity switcher ───
      await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded", timeout: config.fbNavTimeoutMs });
      await page.waitForTimeout(3000);

      // Click the avatar button — label varies by account language
      // (probe 2026-09-20: "ملفك الشخصي" on ar accounts, "Your profile" on en).
      // Retry-poll instead of a single shot: on the VPS the cold page render
      // can take longer than the flat 3s wait (prod failed here at 9s).
      const clickWhenReady = async (labels: string[], scope: string, maxMs: number): Promise<string> => {
        const listJson = JSON.stringify(labels);
        const deadline = Date.now() + maxMs;
        let clicked = "";
        while (!clicked && Date.now() < deadline) {
          clicked = (await page.evaluate(`(() => {
            const want = ${listJson};
            const cands = Array.from(document.querySelectorAll(${JSON.stringify(scope)}));
            for (const el of cands) {
              const t = (el.innerText || "").trim();
              const al = (el.getAttribute && (el.getAttribute("aria-label") || el.getAttribute("alt"))) || "";
              const hay = (t + " " + al).toLowerCase();
              for (const w of want) {
                if (hay === w.toLowerCase() || (w.length > 12 && hay.includes(w.toLowerCase()))) { el.click(); return t || al; }
              }
            }
            return "";
          })()`)) as string;
          if (!clicked) await page.waitForTimeout(800);
        }
        return clicked;
      };

      const avatarClicked = await clickWhenReady(
        ["ملفك الشخصي", "Your profile", "الصورة الشخصية", "حسابي", "Facebook menu", "قائمة الحساب"],
        '[role="button"], a, img[aria-label], svg[aria-label]',
        45000,
      );
      log.info("ListPages", `avatar-click=${avatarClicked || "none"}`);
      if (!avatarClicked) {
        const topLabels = (await page.evaluate(`(() => {
          return Array.from(document.querySelectorAll('[role="banner"] [role="button"], [role="navigation"] [role="button"]'))
            .map(el => el.getAttribute("aria-label") || el.getAttribute("alt") || "")
            .filter(Boolean).slice(0, 15);
        })()`)) as string[];
        log.warn("ListPages", `avatar not found; banner labels: ${topLabels.join(" | ") || "none"}`);
        return res.status(500).json({ error: { code: ErrorCodes.UNKNOWN_ERROR, message: "تعذّر فتح قائمة الحساب على فيسبوك — أعد المحاولة" } });
      }
      await page.waitForTimeout(2000);

      // Click "عرض كل الملفات الشخصية" / "See all profiles" — opens the full
      // switcher sheet with every profile AND managed page.
      const profilesClicked = await clickWhenReady(
        ["عرض كل الملفات الشخصية", "عرض كل الملفات", "التبديل بين الملفات", "see all profiles", "see more profiles", "عرض المزيد من الملفات"],
        '[role="menuitem"], [role="menu"] [role="button"], [role="menu"] a, [role="dialog"] [role="button"], [role="dialog"] a, [role="button"]',
        20000,
      );
      log.info("ListPages", `profiles-click=${profilesClicked || "none"}`);
      if (!profilesClicked) {
        return res.status(500).json({ error: { code: ErrorCodes.UNKNOWN_ERROR, message: "تعذّر فتح قائمة الملفات والصفحات على فيسبوك — أعد المحاولة" } });
      }
      await page.waitForTimeout(3500);

      // ─── Primary: deep-walk captured switcher GraphQL for entities ───
      const found = new Map<string, ManagedPageCandidate>();
      for (const body of captured) {
        if (!body) continue;
        for (const obj of parseBodies(body.replace(/^for\s*\(\s*;;\s*\);?/, "").trim())) {
          for (const p of extractManagedPages(obj)) if (!found.has(p.id)) found.set(p.id, p);
        }
      }

      // ─── Fallback (probe 2026-09-20): the sheet itself renders from the relay
      // cache — no fresh network call fires, so captured[] can be empty while
      // the sheet lists every profile/page. Harvest names from the sheet rows
      // and resolve their numeric ids from the page's embedded script JSON
      // (switcher eligible-profile + bookmark payloads both carry id+name).
      if (found.size === 0) {
        const sheetRows = (await page.evaluate(`(${dumpSwitcherSheetRows})()`)) as { name: string }[];
        if (sheetRows.length > 0) {
          const embedded = await page.evaluate(`(() => {
            const chunks = [];
            const scripts = document.querySelectorAll('script');
            for (const s of scripts) {
              const t = s.textContent || "";
              if (t.includes("ProfileSwitcherEligibleProfile") || t.includes("delegate_page_id") || t.includes('"__typename":"Page"')) {
                chunks.push(t);
              }
            }
            return chunks;
          })()`) as string[];
          for (const chunk of embedded) {
            for (const obj of parseBodies(chunk.replace(/^for\s*\(\s*;;\s*\);?/, "").trim())) {
              for (const p of extractManagedPages(obj)) if (!found.has(p.id)) found.set(p.id, p);
            }
          }
          log.info("ListPages", `sheet-fallback: ${sheetRows.length} sheet rows, ${found.size} entities from embedded JSON`);
        }
      }

      log.info("ListPages", `graphql-switcher: ${found.size} managed pages from ${captured.length} graphql responses`);

      // NOTE: the old accountscenter.facebook.com fallback is REMOVED. Navigating
      // the Account Center from a datacenter IP on a minutes-old session is a
      // textbook account-theft signal — it killed session 1fcaec39 exactly 67s
      // after the visit (2026-09-20 05:31:07 → 05:32:21 guest). It also never
      // produced a single candidate. No managed pages in the switcher GraphQL
      // simply means the account manages none — return empty, fast.

      const pages: ManagedPage[] = Array.from(found.values()).map(p => ({
        id: p.id,
        name: p.name,
        username: p.id, // numeric id — legacy slug usernames are no longer trusted
        followers: "",
        picture_url: p.pictureUrl || "",
        category: "",
      }));

      log.info("ListPages", `found ${pages.length} pages in ${Date.now() - startedAt}ms (names=${pages.map(p => p.name).join(" | ").substring(0, 200)})`);
      return res.json({ pages });
    } finally {
      page.off("response", onResp);
      await contextManager.releaseContext(contextId);
    }
  } catch (err) {
    const code = err instanceof ExtractionError ? err.code : ErrorCodes.UNKNOWN_ERROR;
    const message = err instanceof Error ? err.message : String(err);
    log.error("ListPages", `error: ${code}`, { message });
    const status = code === ErrorCodes.SESSION_EXPIRED ? 401 : 500;
    return res.status(status).json({ error: { code, message } });
  }
});

export default router;
