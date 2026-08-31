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
      if (ch === '"') { inStr = !inStr; continue; }
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
    const { page, contextId } = await contextManager.createContext(session_id, cookies, undefined, userAgent, storageState);

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
      // ─── One navigation, then open the identity switcher (probe 2026-08-31) ───
      await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded", timeout: config.fbNavTimeoutMs });
      await page.waitForTimeout(3500);
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

      // Click the avatar button ("Your profile" en / "الصورة الشخصية" ar) — scan
      // label-by-label so it wins over "Facebook menu".
      const avatarClicked: string = await page.evaluate(`(() => {
        const labels = ["Your profile", "الصورة الشخصية", "حسابي", "Facebook menu", "قائمة الحساب"];
        for (const want of labels) {
          const els = Array.from(document.querySelectorAll('[role="button"], a, img[aria-label]'));
          for (const el of els) {
            const al = (el.getAttribute && (el.getAttribute("aria-label") || el.getAttribute("alt"))) || "";
            if (al && al.toLowerCase() === want.toLowerCase()) { el.click(); return al; }
          }
        }
        return "";
      })()`);
      log.info("ListPages", `avatar-click=${avatarClicked || "none"}`);
      await page.waitForTimeout(3500);
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});

      // Click "See all profiles" / "التبديل بين الملفات" in the opened menu —
      // this fires the switcher GraphQL carrying profile_switcher_eligible_profiles.
      const profilesClicked: string = await page.evaluate(`(() => {
        const want = ["see all profiles", "see more profiles", "التبديل بين الملفات", "عرض المزيد من الملفات", "الصفحات", "profiles"];
        const cands = Array.from(document.querySelectorAll('[role="menuitem"], [role="dialog"] a, [role="dialog"] [role="button"], [role="button"]'));
        for (const el of cands) {
          const t = (el.innerText || "").trim();
          const al = (el.getAttribute && el.getAttribute("aria-label")) || "";
          if ((t && want.some(w => t.toLowerCase().includes(w))) || (al && want.some(w => al.toLowerCase().includes(w)))) {
            el.click(); return t || al;
          }
        }
        return "";
      })()`);
      log.info("ListPages", `profiles-click=${profilesClicked || "none"}`);
      await page.waitForTimeout(3500);
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});

      // ─── Primary: deep-walk captured switcher GraphQL for Page entities ───
      const found = new Map<string, ManagedPageCandidate>();
      const viewerUserIds = new Set<string>();
      for (const body of captured) {
        if (!body) continue;
        for (const obj of parseBodies(body.replace(/^for\s*\(\s*;;\s*\);?/, "").trim())) {
          for (const p of extractManagedPages(obj)) if (!found.has(p.id)) found.set(p.id, p);
        }
        // Remember the viewer's own User id so the AC fallback can exclude the
        // personal profile (a personal profile is NOT a managed page).
        for (const m of body.matchAll(/"__typename":"User","id":"(\d{5,})"/g)) viewerUserIds.add(m[1]);
        for (const m of body.matchAll(/"id":"(\d{5,})","__typename":"User"/g)) viewerUserIds.add(m[1]);
      }
      log.info("ListPages", `graphql-switcher: ${found.size} managed pages from ${captured.length} graphql responses (viewerIds=${viewerUserIds.size})`);

      // ─── Fallback: Accounts Center profiles (numeric ids in /profiles/<id>/ links) ───
      if (found.size === 0) {
        log.info("ListPages", `fallback: accountscenter profiles DOM`);
        await page.goto("https://accountscenter.facebook.com/profiles/", { waitUntil: "domcontentloaded", timeout: config.fbNavTimeoutMs });
        await page.waitForTimeout(5000);
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
        const rawDom: unknown = await page.evaluate(`(() => {
          const out = [];
          const seen = new Set();
          for (const a of document.querySelectorAll('a[href*="/profiles/"]')) {
            const m = (a.getAttribute("href") || "").match(/\\/profiles\\/(\\d{5,})\\/?(\\?|$)/);
            if (!m || seen.has(m[1])) continue;
            seen.add(m[1]);
            let name = (a.innerText || "").trim().split("\\n")[0] || "";
            let picture = "";
            const img = a.querySelector("img");
            if (img) picture = img.src || "";
            out.push({ id: m[1], name, picture });
          }
          return out;
        })()`).catch(() => null);
        const domPages: Array<{ id: string; name: string; picture: string }> = Array.isArray(rawDom)
          ? (rawDom as Array<{ id: string; name: string; picture: string }>)
          : [];
        for (const dp of domPages) {
          // AC lists personal profiles too — exclude the viewer's own User id
          // captured from the switcher GraphQL. Without __typename we cannot
          // fully prove "Page", so the extractor's own mailbox resolution
          // rejects non-manageable ids safely.
          if (viewerUserIds.has(dp.id)) continue;
          if (isManagedPageCandidate(dp.id, dp.name) && !found.has(dp.id)) {
            found.set(dp.id, { id: dp.id, name: dp.name, pictureUrl: dp.picture });
          }
        }
        log.info("ListPages", `accountscenter DOM: ${found.size} candidates`);
      }

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
    return res.status(500).json({ error: { code, message } });
  }
});

export default router;
