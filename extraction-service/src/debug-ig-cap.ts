/**
 * Live probe: WHY is @yolya_qa capped at ~55 rows?
 * 1) Opens the followers dialog and dumps its full text (platform notice?).
 * 2) Checks friendships API: first page + next_max_id presence.
 * 3) Reports exact dialog row count vs header total.
 * Run locally with a connected session: npx tsx src/debug-ig-cap.ts <sessionId> yolya_qa
 */
import { browserPool } from "./services/browser-pool.js";
import { igContextManager } from "./services/ig-context-manager.js";
import { igSupabaseService } from "./services/ig-supabase.js";
import { config } from "./config.js";

async function main() {
  const sessionId = process.argv[2];
  const username = process.argv[3] || "yolya_qa";
  if (!sessionId) throw new Error("usage: tsx src/debug-ig-cap.ts <sessionId> <username>");

  await browserPool.init();
  const { cookies, userAgent } = await igSupabaseService.getIgSessionAndCookies(sessionId);
  const { page, contextId } = await igContextManager.createContext(sessionId, cookies, undefined, userAgent);

  try {
    await page.goto(`${config.igBaseUrl}/${username}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);

    // Header totals
    const header = await page.evaluate(() => {
      const out: string[] = [];
      document.querySelectorAll("header a, main a, header button").forEach((el) => {
        const t = (el.textContent || "").trim();
        if (t && /\d/.test(t) && t.length < 40) out.push(t);
      });
      return out;
    });
    console.log("HEADER COUNTERS:", JSON.stringify(header));

    // API probe BEFORE opening dialog
    const apiProbe1 = await page.evaluate(async (user: string) => {
      const html = await fetch(`https://www.instagram.com/${user}/`, { credentials: "include" }).then((r) => r.text());
      const m = html.match(/friendships\/(\d+)\//);
      return m ? m[1] : null;
    }, username);
    console.log("TARGET USER ID:", apiProbe1);

    if (apiProbe1) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        const res = await page.evaluate(async ({ uid }: { uid: string }) => {
          const r = await fetch(
            `https://www.instagram.com/api/v1/friendships/${uid}/followers/?count=50`,
            { credentials: "include", headers: { "x-ig-app-id": "936619743392459", accept: "*/*" } },
          );
          const j = await r.json().catch(() => null);
          return { status: r.status, users: j?.users?.length ?? -1, next: !!j?.next_max_id, err: j?.message ?? null };
        }, { uid: apiProbe1 });
        console.log(`API PROBE ${attempt}:`, JSON.stringify(res));
        if (res.status === 200 && res.users > 0 && res.next) break;
        await page.waitForTimeout(5000);
      }
    }

    // Open the dialog and dump text + rows
    const clicked = await page.evaluate((tab: string) => {
      const cands = Array.from(document.querySelectorAll('header a, main a, header button, [role="button"]')) as HTMLElement[];
      for (const el of cands) {
        const txt = (el.textContent || "").trim().toLowerCase();
        if (/\d/.test(txt) && txt.includes(tab)) { el.click(); return txt; }
      }
      return null;
    }, "followers");
    console.log("CLICKED:", clicked);
    await page.waitForTimeout(3500);

    const dlg = await page.evaluate(() => {
      const d = document.querySelector('div[role="dialog"]');
      return { exists: !!d, text: (d?.textContent || "").slice(0, 1500), rows: d ? d.querySelectorAll('a[href^="/"]').length : 0 };
    });
    console.log("DIALOG EXISTS:", dlg.exists, "| ROWS VISIBLE:", dlg.rows);
    console.log("DIALOG TEXT (first 1500 chars):", JSON.stringify(dlg.text));
  } finally {
    await igContextManager.releaseContext(contextId).catch(() => {});
  }
}

main().catch((e) => { console.error("PROBE FAILED:", e); process.exit(1); });
