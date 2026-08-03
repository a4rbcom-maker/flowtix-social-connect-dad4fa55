import type { Page } from "playwright";
import { logger } from "../logger.js";
import type { PagePost } from "./post-scraper.js";

export interface ReactionUser {
  fb_id: string;
  name: string;
  profile_url: string;
  reaction_type?: string;
}

const log = logger;

export async function extractReactionsFromPost(
  page: Page,
  post: PagePost,
  options: { maxReactions?: number; maxScrollSeconds?: number } = {}
): Promise<ReactionUser[]> {
  const maxReactions = options.maxReactions ?? 2000;
  const maxScrollSeconds = options.maxScrollSeconds ?? 40;

  const users: ReactionUser[] = [];
  const seenIds = new Set<string>();

  log.info("ReactionsExt", `extracting reactions for post ${post.postId.slice(0, 20)}... (limit=${maxReactions})`);

  const interceptedUsers: ReactionUser[] = [];

  const onResponse = async (resp: any) => {
    const url = resp.url();
    if (!url.includes("graphql") || resp.status() !== 200) return;
    try {
      const text = await resp.text();
      const parsed = parseReactionsFromGraphQL(text);
      for (const u of parsed) {
        if (!interceptedUsers.some(iu => iu.fb_id === u.fb_id)) {
          interceptedUsers.push(u);
        }
      }
    } catch { /* skip */ }
  };

  page.on("response", onResponse);

  try {
    // Primary: open post permalink, click reactions
    const permalink = buildPostPermalink(post);
    let dialogOpened = false;

    try {
      await page.goto(permalink, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(3000);
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

      // Click the reactions count to open dialog
      const clicked = await page.evaluate(() => {
        const all = document.querySelectorAll('div[role="button"], span[role="button"], a[role="link"]');
        for (const el of all) {
          const text = (el as HTMLElement).textContent?.trim() || "";
          const aria = (el as HTMLElement).getAttribute("aria-label") || "";
          if ((text.match(/^[\d,.KkM]+/) || aria.match(/[\d,KkM]+\s*(reaction|like|تفاعل|إعجاب)/i)) &&
              el.closest('[role="article"], [role="main"], div[data-pagelet]')) {
            (el as HTMLElement).click();
            return true;
          }
        }
        return false;
      });

      if (clicked) {
        dialogOpened = true;
        await page.waitForTimeout(2000);
        log.info("ReactionsExt", `reactions dialog opened via permalink`);
      }
    } catch { /* continue */ }

    // Fallback: direct dialog URL
    if (!dialogOpened) {
      const urls = [
        `https://www.facebook.com/ufi/reaction/profile/browser/?ft_ent_identifier=${encodeURIComponent(post.postId)}`,
        `https://www.facebook.com/ufi/reaction/profile/dialog/?ft_ent_identifier=${encodeURIComponent(post.postId)}`,
        `https://www.facebook.com/ufi/reaction/profile/browser/?ft_id_identifier=${encodeURIComponent(post.postId)}`,
      ];
      for (const url of urls) {
        try {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
          await page.waitForTimeout(2500);
          const hasDialog = await page.evaluate(() => {
            return !!document.querySelector('[role="dialog"] [role="list"], [role="dialog"] div[style*="overflow"]');
          });
          if (hasDialog) {
            dialogOpened = true;
            log.info("ReactionsExt", `dialog opened via URL`);
            break;
          }
        } catch { continue; }
      }
    }

    if (!dialogOpened) {
      log.warn("ReactionsExt", `could not open reactions dialog`);
      return [];
    }

    // Click "All" tab
    try {
      await page.evaluate(() => {
        const tabs = document.querySelectorAll('[role="tab"], [role="menuitemradio"]');
        for (const t of tabs) {
          const text = t.textContent || "";
          if (text.includes("All") || text.includes("الكل")) { (t as HTMLElement).click(); break; }
        }
      });
      await page.waitForTimeout(1500);
    } catch { /* skip */ }

    // Scroll and collect
    const startTime = Date.now();
    let noProgressCount = 0;

    while (users.length < maxReactions && Date.now() - startTime < maxScrollSeconds * 1000) {
      const beforeCount = interceptedUsers.length;

      while (interceptedUsers.length > 0) {
        const u = interceptedUsers.shift()!;
        if (!seenIds.has(u.fb_id)) {
          seenIds.add(u.fb_id);
          users.push(u);
        }
      }

      if (users.length >= maxReactions) break;

      await page.evaluate(() => {
        const containers = [
          document.querySelector('[role="dialog"] [role="list"]'),
          document.querySelector('[role="dialog"] div[style*="overflow"]'),
          document.querySelector('[role="dialog"]'),
        ];
        const container = containers.find(c => c) as HTMLElement | null;
        if (container) {
          container.scrollTop = container.scrollHeight;
        } else {
          window.scrollTo(0, document.body.scrollHeight);
        }
      });
      await page.waitForTimeout(500);

      const afterCount = interceptedUsers.length;
      if (afterCount === beforeCount) {
        noProgressCount++;
        if (noProgressCount >= 15) break;
      } else {
        noProgressCount = 0;
      }
    }

    while (interceptedUsers.length > 0) {
      const u = interceptedUsers.shift()!;
      if (!seenIds.has(u.fb_id)) {
        seenIds.add(u.fb_id);
        users.push(u);
      }
    }
  } finally {
    page.off("response", onResponse);
  }

  log.info("ReactionsExt", `collected ${users.length} reactions`);
  return users;
}

function buildPostPermalink(post: PagePost): string {
  if (post.permalink && post.permalink.includes("facebook.com") &&
      (post.permalink.includes("/posts/") || post.permalink.includes("permalink.php") ||
       post.permalink.includes("/reel/") || post.permalink.includes("/videos/") ||
       post.permalink.includes("/photo/"))) {
    return post.permalink;
  }
  return `https://www.facebook.com/permalink.php?story_fbid=${encodeURIComponent(post.postId)}`;
}

function parseReactionsFromGraphQL(text: string): ReactionUser[] {
  const users: ReactionUser[] = [];
  let jsonText = text;
  const forIdx = text.indexOf("for (;;);");
  if (forIdx >= 0) jsonText = text.substring(forIdx + 9).trim();

  try {
    const data = JSON.parse(jsonText);
    walkForReactors(data, users, 8);
  } catch { /* not JSON */ }
  return users;
}

function walkForReactors(obj: any, users: ReactionUser[], depth: number): void {
  if (!obj || depth < 0) return;
  if (Array.isArray(obj)) {
    for (const item of obj) walkForReactors(item, users, depth - 1);
    return;
  }
  if (typeof obj !== "object") return;

  const actor = obj.actor || obj.node?.actor || obj.profile;
  const id = obj.id || actor?.id || obj.uid || obj.user_id || obj.fbid;
  const name = actor?.name || obj.name || obj.display_name || obj.title?.text || "";
  const url = actor?.url || obj.url || obj.profile_url || "";
  const reactionType = obj.reaction_type || actor?.reaction_type || obj.reaction || null;

  if (id && typeof id === "string" && /^\d{5,30}$/.test(id) && name && typeof name === "string" && name.trim().length >= 2) {
    const profileUrl = typeof url === "string" && url.includes("facebook.com")
      ? (url.startsWith("http") ? url : `https://www.facebook.com${url}`)
      : `https://www.facebook.com/profile.php?id=${id}`;
    users.push({
      fb_id: id, name: name.trim().substring(0, 200),
      profile_url: profileUrl,
      reaction_type: typeof reactionType === "string" ? reactionType : undefined,
    });
    return;
  }

  for (const key of Object.keys(obj)) {
    if (key === "edges" || key === "nodes" || key === "reactors" || key === "profiles" ||
        key === "users" || key === "reaction_surface" || key === "reaction_list") {
      walkForReactors(obj[key], users, depth - 1);
    } else if (typeof obj[key] === "object" && obj[key] !== null) {
      walkForReactors(obj[key], users, depth - 1);
    }
  }
}