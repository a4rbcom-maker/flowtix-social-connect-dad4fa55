/**
 * IG DM probe — verifies the live DOM shape of the DM composer and that a
 * direct message actually sends. MANDATORY before shipping ig-dm-sender.ts.
 * Run on a REAL connected session:
 *
 *   npx tsx src/debug-ig-dm.ts <igSessionId> <targetUsername> [--via-sender]
 *
 * --via-sender runs the real sendIgDm() from ig-dm-sender.ts.
 */
import { browserPool } from "./services/browser-pool.js";
import { igContextManager } from "./services/ig-context-manager.js";
import { igSupabaseService } from "./services/ig-supabase.js";
import { config } from "./config.js";
import { sendIgDm } from "./services/ig-dm-sender.js";

async function main() {
  const sessionId = process.argv[2];
  const username = process.argv[3];
  const viaSender = process.argv.includes("--via-sender");
  if (!sessionId || !username) throw new Error("usage: debug-ig-dm <igSessionId> <targetUsername> [--via-sender]");

  await browserPool.init();
  const { cookies, proxy, userAgent } = await igSupabaseService.getIgSessionAndCookies(sessionId);
  const created = await igContextManager.createContext(sessionId, cookies, proxy, userAgent);
  try {
    await created.page.goto(`${config.igBaseUrl}/${username.replace(/^@/, "")}/`, { waitUntil: "domcontentloaded", timeout: config.igNavTimeoutMs });
    await created.page.waitForTimeout(2500);
    const opened = await created.page.evaluate(`(() => {
      const els = [...document.querySelectorAll('a[aria-label*="Message" i], a[aria-label*="رسالة" i], header button')];
      const m = els.find(e => (e.getAttribute('aria-label')||e.innerText||'').match(/message|رسالة/i));
      if (m) { m.click(); return true; }
      return false;
    })()`);
    console.log("THREAD_OPENED:", opened);
    const TEXTBOX = 'div[contenteditable="true"][role="textbox"], textarea';
    let found = false;
    for (let i = 0; i < 22 && !found; i++) {
      if (await created.page.$(TEXTBOX)) { found = true; break; }
      await created.page.waitForTimeout(2000);
    }
    const probe = await created.page.evaluate(`(() => {
      const tb = document.querySelector('div[contenteditable="true"][role="textbox"], textarea');
      return { hasComposer: !!tb, tag: tb ? tb.tagName : null, aria: tb ? tb.getAttribute('aria-label') : null };
    })()`);
    console.log("DOM_PROBE:", JSON.stringify(probe));

    if (viaSender) {
      const outcome = await sendIgDm(created.page, username, "FlowTix probe — تجاهل 🙏");
      console.log("SENDER_OUTCOME:", JSON.stringify(outcome));
      console.log(outcome.ok ? "DM_SENT ✅" : "DM_FAILED ❌");
    } else {
      console.log("dm verdict: run with --via-sender to actually send");
    }
  } finally {
    await igContextManager.releaseContext(sessionId).catch(() => {});
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("PROBE-ERROR:", e); process.exit(1); });
