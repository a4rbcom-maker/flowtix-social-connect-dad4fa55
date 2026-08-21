import { Router } from "express";
import { z } from "zod";
import { supabaseService } from "../services/supabase.js";
import { contextManager } from "../services/context-manager.js";
import { logger } from "../logger.js";

const log = logger;
const router = Router();

const schema = z.object({
  session_id: z.string().min(1),
  url: z.string().min(1),
  click_reactions: z.boolean().optional(),
});

router.post("/debug-page", async (req, res) => {
  try {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { code: "INVALID_INPUT", message: "Invalid input" } });
    }

    const { session_id, url, click_reactions } = parsed.data;
    log.info("Debug", `navigating to ${url}`, { click_reactions });

    const { cookies, userAgent } = await supabaseService.getSessionAndCookies(session_id);
    const { page, contextId } = await contextManager.createContext(session_id, cookies, undefined, userAgent);

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(5000);
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, 1000));
      await page.waitForTimeout(2000);

      let reactionDebug: Record<string, unknown> | undefined;

      if (click_reactions) {
        const clicked = await page.evaluate(() => {
          const reactionLinks = document.querySelectorAll<HTMLAnchorElement>('a[href*="/ufi/reaction/"]');
          if (reactionLinks.length > 0) { reactionLinks[0].click(); return { clicked: true, via: 'ufi_link' }; }

          const ariaMatched = document.querySelectorAll('[aria-label]');
          for (const el of ariaMatched) {
            const aria = (el.getAttribute('aria-label') || '').trim();
            if (/\b\d+([.,]\d+)*[kKmM]?\b/.test(aria) && aria.length <= 80) {
              (el as HTMLElement).click();
              return { clicked: true, via: 'aria_with_number', aria: aria.substring(0, 80) };
            }
          }

          const allEls = document.querySelectorAll('span, div, a');
          for (const el of allEls) {
            const text = (el as HTMLElement).innerText?.trim() || '';
            if (/^\d+([.,]\d+)*[kKmM]?$/.test(text) && text.length <= 8) {
              (el as HTMLElement).click();
              return { clicked: true, via: 'count_text', text };
            }
          }
          return { clicked: false };
        });

        await page.waitForTimeout(3000);

        for (let wait = 0; wait < 5; wait++) {
          const hasContent = await page.evaluate(() => {
            const dialog = document.querySelector('[role="dialog"]');
            if (!dialog) return false;
            return dialog.querySelectorAll('a[href], [role="listitem"]').length > 0 ||
                   (dialog.innerHTML.length > 15000);
          });
          if (hasContent) break;
          await page.waitForTimeout(2000);
        }

        const dialogBounds = await page.evaluate(() => {
          const dialog = document.querySelector('[role="dialog"]');
          if (!dialog) return null;
          const rect = dialog.getBoundingClientRect();
          return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
        });
        if (dialogBounds) {
          await page.mouse.move(dialogBounds.x + dialogBounds.w / 2, dialogBounds.y + dialogBounds.h / 2);
          for (let s = 0; s < 5; s++) {
            await page.mouse.wheel(0, 300);
            await page.waitForTimeout(500);
          }
          await page.waitForTimeout(2000);
        }

        reactionDebug = await page.evaluate(() => {
          const dialog = document.querySelector('[role="dialog"]') || document.querySelector('[aria-modal="true"]');
          if (!dialog) return { dialog: false };

          const allLinks = Array.from(dialog.querySelectorAll('a[href]'));
          const linkSample = allLinks.slice(0, 20).map(l => ({
            href: (l.getAttribute('href') || '').substring(0, 100),
            text: (l as HTMLElement).innerText?.trim().substring(0, 60) || '',
          }));

          const listItems = Array.from(dialog.querySelectorAll('[role="listitem"], [role="row"], [role="option"], li'));
          const listItemSample = listItems.slice(0, 15).map(el => ({
            tag: el.tagName,
            role: el.getAttribute('role') || '',
            text: (el as HTMLElement).innerText?.trim().substring(0, 100) || '',
            html: el.innerHTML.substring(0, 300),
          }));

          const allText = (dialog as HTMLElement).innerText?.substring(0, 1000) || '';

          const scrollables: { tag: string; sH: number; cH: number; ov: string }[] = [];
          const candidates = dialog.querySelectorAll('*');
          for (let i = 0; i < candidates.length; i++) {
            const el = candidates[i] as HTMLElement;
            const style = window.getComputedStyle(el);
            if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 10) {
              scrollables.push({ tag: el.tagName, sH: el.scrollHeight, cH: el.clientHeight, ov: style.overflowY });
            }
          }

          const tabs = Array.from(dialog.querySelectorAll('[role="tab"], [role="button"]')).slice(0, 10).map(el => ({
            text: (el as HTMLElement).innerText?.trim().substring(0, 40) || '',
            aria: el.getAttribute('aria-label') || '',
          }));

          return {
            dialog: true,
            dialog_links: allLinks.length,
            link_sample: linkSample,
            list_items: listItems.length,
            list_item_sample: listItemSample,
            dialog_text: allText,
            scrollables,
            tabs,
            dialog_innerHTML_length: dialog.innerHTML.length,
          };
        });
        reactionDebug = { ...reactionDebug, click_result: clicked };
      }

      const finalUrl = page.url();
      const title = await page.title();

      const screenshotPath = `D:\\Projects\\FlowTix\\extraction-service\\fb_screenshot_${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath, type: "png", fullPage: false }).catch(() => {});

      const htmlLength = (await page.content()).length;
      const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 2000) || "N/A");

      const keyIndicators = await page.evaluate(() => {
        const html = document.documentElement.innerHTML;
        const body = document.body?.innerText || "";
        return {
          hasCheckpoint: html.includes("checkpoint") || html.includes("Checkpoint"),
          hasSuspiciousLogin: html.includes("SuspiciousLogin") || html.includes("suspicious"),
          hasLoginForm: html.includes("login_form") || html.includes("login_popup"),
          hasFollowers: html.includes("followers") || html.includes("Followers") || html.includes("following"),
          hasNotifications: html.includes("notifications") || html.includes("Notifications"),
          hasPageContent: html.includes("pagelet") || html.includes("timeline") || html.includes("Page"),
          htmlLength: html.length,
          checkpointText: (html.match(/checkpoint[^<]*/i) || [])[0] || "",
          dialogRoles: Array.from(document.querySelectorAll('[role="dialog"]')).map(d => ({
            text: (d as HTMLElement).innerText?.substring(0, 200) || "",
            htmlLength: d.innerHTML.length,
          })),
        };
      });

      const analysis = await page.evaluate(() => {
        // 1. All links with profile patterns
        const allLinks = Array.from(document.querySelectorAll('a[href]'));
        const profileLinks = allLinks.map(link => {
          const href = link.getAttribute('href') || '';
          const text = (link as HTMLElement).innerText?.trim() || '';
          return { href, text: text.substring(0, 80) };
        }).filter(l => l.text && l.text.length >= 2 && l.text.length <= 100);

        // 2. Elements that look like user entries (have name + maybe image)
        const possibleUsers: { tag: string; text: string; href: string; role: string; aria: string }[] = [];
        const allElements = document.querySelectorAll('[role="listitem"], [role="row"], [data-visualcompletion], [class*="user"], [class*="member"], [class*="follower"], [class*="person"]');
        for (const el of allElements) {
          const text = (el as HTMLElement).innerText?.trim() || '';
          const link = el.querySelector('a[href]');
          const href = link?.getAttribute('href') || '';
          if (text && text.length >= 2 && text.length <= 100) {
            possibleUsers.push({
              tag: el.tagName,
              text: text.substring(0, 80),
              href,
              role: el.getAttribute('role') || '',
              aria: el.getAttribute('aria-label') || '',
            });
          }
        }

        // 3. Check for any element with data attributes containing user IDs
        const dataElements: { tag: string; dataAttrs: Record<string, string>; text: string }[] = [];
        const allWithData = document.querySelectorAll('[data-sigil], [data-store], [data-gt], [data-hovercard]');
        for (const el of allWithData) {
          const dataAttrs: Record<string, string> = {};
          for (const attr of ['data-sigil', 'data-store', 'data-gt', 'data-hovercard']) {
            const v = el.getAttribute(attr);
            if (v) dataAttrs[attr] = v.substring(0, 200);
          }
          const text = (el as HTMLElement).innerText?.trim() || '';
          if (text) dataElements.push({ tag: el.tagName, dataAttrs, text: text.substring(0, 80) });
        }

        // 4. Images with alt text (user avatars)
        const avatarImages = Array.from(document.querySelectorAll('img[alt]'))
          .map(img => ({
            alt: img.getAttribute('alt') || '',
            src: (img.getAttribute('src') || '').substring(0, 100),
          }))
          .filter(img => img.alt && img.alt.length >= 2 && img.alt.length <= 100 && !img.alt.includes('logo') && !img.alt.includes('cover'))
          .slice(0, 20);

        // 5. Scrollable containers
        const scrollables: { tag: string; cls: string; scrollH: number; clientH: number; overflow: string }[] = [];
        const allDivs = document.querySelectorAll('div, section, main, aside');
        for (const div of allDivs) {
          const style = window.getComputedStyle(div);
          const ov = style.overflowY;
          if ((ov === 'auto' || ov === 'scroll') && div.scrollHeight > div.clientHeight + 50) {
            scrollables.push({
              tag: div.tagName,
              cls: (div.className || '').toString().substring(0, 80),
              scrollH: div.scrollHeight,
              clientH: div.clientHeight,
              overflow: ov,
            });
          }
        }

        return {
          total_links: allLinks.length,
          profile_links: profileLinks.slice(0, 30),
          possible_users: possibleUsers.slice(0, 20),
          possible_users_count: possibleUsers.length,
          data_elements: dataElements.slice(0, 10),
          avatar_images: avatarImages.slice(0, 15),
          avatar_images_count: avatarImages.length,
          scrollables: scrollables.slice(0, 10),
          dialog: !!document.querySelector('[role="dialog"]'),
          body_text_preview: document.body?.innerText?.substring(0, 500) || '',
        };
      });

      return res.json({ url, final_url: finalUrl, title, htmlLength, bodyText, indicators: keyIndicators, analysis, reactionDebug, screenshot: screenshotPath });
    } finally {
      await contextManager.releaseContext(contextId);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("Debug", `error: ${message}`);
    return res.status(500).json({ error: { code: "ERROR", message } });
  }
});

export default router;