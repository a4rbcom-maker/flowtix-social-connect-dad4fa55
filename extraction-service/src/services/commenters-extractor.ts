import type { Page } from "playwright";
import { logger } from "../logger.js";
import type { PagePost } from "./post-scraper.js";

export interface Commenter {
  fb_id: string;
  name: string;
  profile_url: string;
  comment_text?: string;
}

const log = logger;

function buildPostPermalink(post: PagePost): string {
  if (post.permalink && post.permalink.includes("facebook.com") &&
      (post.permalink.includes("/posts/") || post.permalink.includes("permalink.php") ||
       post.permalink.includes("/reel/") || post.permalink.includes("/videos/") ||
       post.permalink.includes("/photo/"))) {
    return post.permalink;
  }
  return `https://www.facebook.com/permalink.php?story_fbid=${encodeURIComponent(post.postId)}`;
}

export async function extractCommentersFromPost(
  page: Page,
  post: PagePost,
  options: { maxCommenters?: number; maxScrollSeconds?: number } = {}
): Promise<Commenter[]> {
  const maxCommenters = options.maxCommenters ?? 1500;
  const maxScrollSeconds = options.maxScrollSeconds ?? 35;

  const users: Commenter[] = [];
  const seenIds = new Set<string>();

  log.info("CommentersExt", `extracting commenters for post ${post.postId.slice(0, 20)}... (limit=${maxCommenters})`);

  const interceptedUsers: Commenter[] = [];

  const onResponse = async (resp: any) => {
    const url = resp.url();
    if (!url.includes("graphql") || resp.status() !== 200) return;
    try {
      const text = await resp.text();
      const parsed = parseCommentersFromGraphQL(text);
      for (const u of parsed) {
        if (!interceptedUsers.some(iu => iu.fb_id === u.fb_id)) {
          interceptedUsers.push(u);
        }
      }
    } catch { /* skip */ }
  };

  page.on("response", onResponse);

  try {
    const permalink = buildPostPermalink(post);

    try {
      await page.goto(permalink, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(3000);
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    } catch {
      log.warn("CommentersExt", `failed to open post ${post.postId.slice(0, 20)}...`);
      return [];
    }

    // Click "View more comments" repeatedly
    for (let i = 0; i < 10; i++) {
      try {
        const clicked = await page.evaluate(() => {
          const allElements = document.querySelectorAll('[role="button"], a[role="link"], span, div[role="button"]');
          for (const b of allElements) {
            const t = (b as HTMLElement).textContent?.trim() || "";
            if (t.includes("more comments") || t.includes("عرض المزيد") || t.includes("comments") ||
                t.includes("تعليق") || t.includes("Most relevant") || t.includes("الأكثر ملاءمة") ||
                t.match(/^\d+\s*(more|reply|تعليق|رد)/i)) {
              (b as HTMLElement).click();
              return true;
            }
          }
          return false;
        });
        if (!clicked) break;
        await page.waitForTimeout(2000);
      } catch { break; }
    }

    const startTime = Date.now();
    let noProgressCount = 0;

    while (users.length < maxCommenters && Date.now() - startTime < maxScrollSeconds * 1000) {
      const beforeCount = interceptedUsers.length;

      while (interceptedUsers.length > 0) {
        const u = interceptedUsers.shift()!;
        if (!seenIds.has(u.fb_id)) {
          seenIds.add(u.fb_id);
          users.push(u);
        }
      }

      if (users.length >= maxCommenters) break;

      await page.evaluate(() => {
        const containers = [
          document.querySelector('[role="feed"]'),
          document.querySelector('[role="main"]'),
          document.querySelector('[aria-label*="comment"], [aria-label*="تعليق"]'),
        ];
        const container = containers.find(c => c) as HTMLElement | null;
        if (container) container.scrollTop = container.scrollHeight;
        else window.scrollTo(0, document.body.scrollHeight);
      });
      await page.waitForTimeout(500);

      const afterCount = interceptedUsers.length;
      if (afterCount === beforeCount) {
        noProgressCount++;
        if (noProgressCount >= 12) break;
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

  log.info("CommentersExt", `collected ${users.length} commenters`);
  return users;
}

function parseCommentersFromGraphQL(text: string): Commenter[] {
  const users: Commenter[] = [];
  let jsonText = text;
  const forIdx = text.indexOf("for (;;);");
  if (forIdx >= 0) jsonText = text.substring(forIdx + 9).trim();
  try {
    const data = JSON.parse(jsonText);
    walkForCommenters(data, users, 8);
  } catch { /* not JSON */ }
  return users;
}

function walkForCommenters(obj: any, users: Commenter[], depth: number): void {
  if (!obj || depth < 0) return;
  if (Array.isArray(obj)) { for (const item of obj) walkForCommenters(item, users, depth - 1); return; }
  if (typeof obj !== "object") return;

  const actor = obj.actor || obj.author || obj.node?.actor || obj.node?.author || obj.commenter || obj.profile;
  const id = obj.id || actor?.id || obj.fbid;
  const name = actor?.name || obj.author_name || obj.name || "";
  const url = actor?.url || obj.url || "";
  const body = obj.body?.text || obj.text || obj.message?.text || obj.comment_text || "";

  if (id && typeof id === "string" && /^\d{5,30}$/.test(id) && name && typeof name === "string" && name.trim().length >= 2) {
    const profileUrl = typeof url === "string" && url.includes("facebook.com")
      ? (url.startsWith("http") ? url : `https://www.facebook.com${url}`)
      : `https://www.facebook.com/profile.php?id=${id}`;
    users.push({
      fb_id: id, name: name.trim().substring(0, 200),
      profile_url: profileUrl,
      comment_text: typeof body === "string" ? body.substring(0, 300) : undefined,
    });
    return;
  }

  for (const key of Object.keys(obj)) {
    if (key === "edges" || key === "nodes" || key === "comments" || key === "toplevelcomments" ||
        key === "comment_list" || key === "thread") {
      walkForCommenters(obj[key], users, depth - 1);
    } else if (typeof obj[key] === "object" && obj[key] !== null) {
      walkForCommenters(obj[key], users, depth - 1);
    }
  }
}
