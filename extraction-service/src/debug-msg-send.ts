/** Messenger send probe — dumps the live DOM shapes for message-sender.ts (Task 0).
 *  Run: npx tsx src/debug-msg-send.ts <sessionId> <threadId> [sendMessage]
 *  threadId = numeric id WITHOUT the "msg_" prefix. */
import { browserPool } from "./services/browser-pool.js";
import { contextManager } from "./services/context-manager.js";
import { supabaseService } from "./services/supabase.js";

async function main() {
  const sessionId = process.argv[2];
  const threadId = process.argv[3];
  const doSend = process.argv[4] === "send";
  if (!sessionId || !threadId) throw new Error("usage: debug-msg-send <sessionId> <threadId> [send]");

  await browserPool.init();
  const { cookies, proxy, userAgent, storageState } = await supabaseService.getSessionAndCookies(sessionId);
  const { page, contextId } = await contextManager.createContext(sessionId, cookies, proxy, userAgent, storageState);
  try {
    const url = `https://www.facebook.com/messages/t/${threadId}`;
    console.log("goto:", url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    // The composer is lazy-mounted by the SPA — poll up to 45s instead of a fixed wait.
    const TEXTBOX_SELS = [
      'div[contenteditable="true"][role="textbox"]',
      'div[role="textbox"]',
      'form [contenteditable="true"]',
      'textarea[placeholder]',
    ];
    let textboxSelector: string | null = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 45_000) {
      for (const sel of TEXTBOX_SELS) {
        if (await page.$(sel)) { textboxSelector = sel; break; }
      }
      if (textboxSelector) break;
      // nudge the page like a human would (focus can trigger lazy mount)
      await page.mouse.move(400 + Math.random() * 200, 500 + Math.random() * 100);
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(3000);
    }
    console.log("textboxSelector:", textboxSelector, "after", Math.round((Date.now() - t0) / 1000) + "s", "url:", page.url());

    const probe = await page.evaluate(`(() => {
      const out = {};
      out.finalUrl = location.href;
      out.title = document.title.slice(0, 80);
      // 1) textbox candidates
      out.textboxes = Array.from(document.querySelectorAll('div[contenteditable="true"], [role="textbox"], textarea')).slice(0, 6).map(el => ({
        tag: el.tagName,
        role: el.getAttribute("role"),
        ariaLabel: el.getAttribute("aria-label"),
        ariaLabelAr: el.getAttribute("aria-label"),
        contentEditable: el.getAttribute("contenteditable"),
        dataId: el.getAttribute("data-id") || el.dataset?.id || null,
        cls: (el.className || "").toString().slice(0, 60),
        visible: !!(el.offsetWidth || el.offsetHeight),
      }));
      // 2) send button candidates
      out.sendButtons = Array.from(document.querySelectorAll('[aria-label*="Send" i], [aria-label*="إرسال"], [aria-label*="اضغط"], div[role="button"][aria-label]')).slice(0, 10).map(el => ({
        tag: el.tagName,
        ariaLabel: el.getAttribute("aria-label"),
        text: (el.textContent || "").trim().slice(0, 40),
        visible: !!(el.offsetWidth || el.offsetHeight),
      })).filter(b => b.ariaLabel || b.text);
      // 3) file input
      out.fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).slice(0, 4).map(el => ({
        accept: el.getAttribute("accept"),
        multiple: el.hasAttribute("multiple"),
        ariaLabel: el.getAttribute("aria-label"),
      }));
      // 4) restriction banners
      const bodyText = document.body.innerText || "";
      const markers = ["message request limit", "You can't currently message", "رسائل", "تقييد", "Log in to Facebook", "Message not sent", "لم يتم إرسال"];
      out.bannerHits = markers.filter(m => bodyText.includes(m));
      out.bodySnippet = bodyText.replace(/\\s+/g, " ").slice(0, 500);
      // 5) outgoing message bubbles (for delivery confirmation later)
      out.bubbleCandidates = Array.from(document.querySelectorAll('[aria-label*="Messages" i] [data-scope="messages_table"], [role="grid"], [data-testid*="message"]')).length;
      return out;
    })()`);
    console.log(JSON.stringify(probe, null, 2));

    if (doSend) {
      const TEXT = "مرحبا، هذه رسالة اختبار من FlowTix — تجاهلها من فضلك 🙏";
      console.log("--- attempting send ---");
      if (!textboxSelector) throw new Error("NO_TEXTBOX");
      // Overlay banners (PIN/E2E notice) intercept pointer events — click by
      // coordinates at the element center with force, or just focus + type.
      await page.focus(textboxSelector).catch(() => {});
      await page.waitForTimeout(600);
      await page.keyboard.type(TEXT, { delay: 55 });
      await page.waitForTimeout(1200);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(4000);
      const confirm = await page.evaluate(`(() => {
        const txt = document.body.innerText || "";
        return {
          stillOnThread: location.href.includes("/messages/t/"),
          hasError: ["Message not sent", "لم يتم إرسال", "لم تُرسل"].some(m => txt.includes(m)),
          snippet: txt.replace(/\\s+/g, " ").slice(0, 300),
        };
      })()`);
      console.log("send-confirm:", JSON.stringify(confirm, null, 2));
    }
  } finally {
    await contextManager.releaseContext(contextId);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error("PROBE-ERROR:", e); process.exit(1); });
