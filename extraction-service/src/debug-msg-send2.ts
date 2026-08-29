/** Messenger send probe v2 — verifies the message actually left the composer
 *  by counting outgoing bubbles before/after. Run: npx tsx src/debug-msg-send2.ts <sessionId> <threadId> */
import { browserPool } from "./services/browser-pool.js";
import { contextManager } from "./services/context-manager.js";
import { supabaseService } from "./services/supabase.js";

async function main() {
  const sessionId = process.argv[2];
  const threadId = process.argv[3];
  if (!sessionId || !threadId) throw new Error("usage: debug-msg-send2 <sessionId> <threadId>");

  await browserPool.init();
  const { cookies, proxy, userAgent, storageState } = await supabaseService.getSessionAndCookies(sessionId);
  const { page, contextId } = await contextManager.createContext(sessionId, cookies, proxy, userAgent, storageState);
  try {
    await page.goto(`https://www.facebook.com/messages/t/${threadId}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    const TB = 'div[contenteditable="true"][role="textbox"]';
    await page.waitForSelector(TB, { timeout: 45000 });
    await page.waitForTimeout(2000);

    // Dismiss any overlay (PIN / E2E banner) that could swallow the composer focus
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(500);

    const countOutgoing = () => page.evaluate(`(() => {
      // Outgoing bubbles live in rows whose "repliedTo" style aligns end / bg highlight
      const all = document.querySelectorAll('[aria-label*="Messages"] div[role="row"], [data-scope="messages_table"] div[role="row"], div[role="row"]');
      let n = 0;
      for (const r of all) {
        const t = r.textContent || "";
        if (t.length > 0 && (r.querySelector('[aria-label*="Sent"]') || r.querySelector('img[alt*="Seen"]') || r.textContent?.match(/Sent|تم الإرسال|Seen|تم الاطلاع/))) n++;
      }
      return { rows: all.length, sentRows: n };
    })()`);

    const before = await countOutgoing() as { rows: number; sentRows: number };
    console.log("before:", JSON.stringify(before));

    await page.focus(TB);
    await page.waitForTimeout(800);
    await page.keyboard.type("رسالة اختبار FlowTix v2 — تجاهل 🙏", { delay: 60 });
    await page.waitForTimeout(1500);
    // Some composer builds need Enter twice (first may only confirm IME composition)
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2500);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(5000);

    const after = await countOutgoing() as { rows: number; sentRows: number };
    const body = await page.evaluate(`(() => (document.body.innerText || "").replace(/\\s+/g, " ").slice(0, 400))()`);
    console.log("after:", JSON.stringify(after));
    console.log("body:", body);
    console.log("verdict:", after.sentRows > before.sentRows ? "MESSAGE_SENT ✅" : "NO_NEW_OUTGOING_BUBBLE ❌");
  } finally {
    await contextManager.releaseContext(contextId);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("PROBE-ERROR:", e); process.exit(1); });
