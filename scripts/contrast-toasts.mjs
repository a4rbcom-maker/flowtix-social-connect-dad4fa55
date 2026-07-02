#!/usr/bin/env node
/**
 * WCAG contrast audit — focused on the sonner toast surface itself.
 *
 * The main contrast audit (scripts/contrast-audit.mjs) walks route pages but
 * never sees the toasts, because nothing triggers them. This script mounts a
 * synthetic [data-sonner-toaster] region with the same data attributes and
 * classNames Flowtix uses in production (flowtix-toast-root, -title, -desc,
 * -action, -cancel, -close, plus data-type success/error/warning/info/default
 * and close button). axe-core then evaluates color-contrast against the real
 * CSS from src/styles.css, so we catch title/desc/action/close regressions
 * in BOTH light and dark themes on a MOBILE viewport (390×844).
 *
 * Usage:
 *   node scripts/contrast-toasts.mjs
 *   BASE_URL=https://flowtix-social-connect.lovable.app node scripts/contrast-toasts.mjs
 */

import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { writeFileSync } from "node:fs";

const BASE_URL = process.env.BASE_URL || "http://localhost:8080";
const MODES = ["light", "dark"];
const VIEWPORT = { width: 390, height: 844 }; // iPhone 14-ish
const MOUNT_URL = new URL("/", BASE_URL).toString();

const TOAST_FIXTURE_HTML = `
<section data-sonner-toaster dir="ltr" data-theme="THEME_PLACEHOLDER"
  data-y-position="top" data-x-position="center"
  style="position:fixed;top:16px;left:12px;right:12px;width:calc(100vw - 24px);z-index:99999;display:flex;flex-direction:column;gap:8px;">
  ${["default", "success", "error", "warning", "info"]
    .map(
      (type, i) => `
    <div data-sonner-toast data-styled="true" data-type="${type}" data-mounted="true"
      data-visible="true" data-y-position="top" data-x-position="center"
      class="flowtix-toast-root"
      style="position:relative;">
      <div data-icon aria-hidden="true"
        style="display:inline-flex;align-items:center;justify-content:center;">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="12" r="10"></circle>
        </svg>
      </div>
      <div data-content style="display:flex;flex-direction:column;">
        <div data-title class="flowtix-toast-title">Toast ${i + 1} — ${type}</div>
        <div data-description class="flowtix-toast-desc">
          Short description text used to validate readable contrast in ${type} state on mobile.
        </div>
      </div>
      <button data-button class="flowtix-toast-action" type="button">Action</button>
      <button data-button data-cancel class="flowtix-toast-cancel" type="button">Cancel</button>
      <button data-close-button type="button" aria-label="Close toast"
        style="opacity:1;">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"
          stroke-width="2" aria-hidden="true">
          <path d="M18 6L6 18M6 6l12 12"></path>
        </svg>
      </button>
    </div>`,
    )
    .join("\n")}
</section>
`;

async function auditToasts(page, mode) {
  await page.addInitScript((m) => {
    try {
      localStorage.setItem("theme", m);
      localStorage.setItem("flowtix-theme", m);
    } catch {}
  }, mode);

  await page.goto(MOUNT_URL, { waitUntil: "domcontentloaded", timeout: 20_000 });

  // Force theme class + color-scheme (matches ThemeProvider output).
  await page.evaluate((m) => {
    const root = document.documentElement;
    root.classList.toggle("dark", m === "dark");
    root.style.colorScheme = m;
  }, mode);

  await page.waitForTimeout(400);

  // Mount synthetic toast region; ensure it stays visible above the page.
  await page.evaluate(
    ({ html, m }) => {
      // Remove any real sonner region so axe only sees our fixture.
      document.querySelectorAll("[data-sonner-toaster]").forEach((el) => el.remove());
      const host = document.createElement("div");
      host.id = "contrast-toast-fixture";
      host.innerHTML = html.replace("THEME_PLACEHOLDER", m);
      document.body.appendChild(host);
    },
    { html: TOAST_FIXTURE_HTML, m: mode },
  );

  await page.waitForTimeout(200);

  const results = await new AxeBuilder({ page })
    .include("#contrast-toast-fixture")
    .withRules(["color-contrast", "color-contrast-enhanced"])
    .analyze()
    .catch((e) => ({ error: e.message }));

  if (results.error) return { mode, skipped: `axe failed: ${results.error}` };

  const violations = (results.violations || []).map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => ({
      selector: n.target?.join(" ") ?? "",
      html: (n.html || "").slice(0, 160),
      summary: n.failureSummary?.replace(/\s+/g, " ").trim() ?? "",
    })),
  }));

  return {
    mode,
    viewport: VIEWPORT,
    violationCount: violations.reduce((a, v) => a + v.nodes.length, 0),
    violations,
  };
}

(async () => {
  console.log(`\n🎨  WCAG contrast audit (toasts, mobile) — ${BASE_URL}`);
  console.log(`    viewport: ${VIEWPORT.width}×${VIEWPORT.height}  ·  modes: ${MODES.join(", ")}\n`);

  const launchOpts = { headless: true };
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) {
    launchOpts.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  }
  const browser = await chromium.launch(launchOpts);
  const report = [];
  let totalFailures = 0;

  for (const mode of MODES) {
    const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: mode });
    const page = await context.newPage();
    process.stdout.write(`  [${mode.padEnd(5)}] toast surface … `);
    const r = await auditToasts(page, mode);
    report.push(r);
    if (r.skipped) {
      console.log(`skipped (${r.skipped})`);
    } else {
      totalFailures += r.violationCount;
      console.log(r.violationCount === 0 ? "✅ pass" : `❌ ${r.violationCount} node(s)`);
    }
    await context.close();
  }

  await browser.close();

  writeFileSync("/tmp/contrast-toasts-report.json", JSON.stringify(report, null, 2));

  const failed = report.filter((r) => r.violationCount);
  if (failed.length) {
    console.log("\n────────  Toast contrast failures  ────────");
    for (const r of failed) {
      console.log(`\n• ${r.mode.toUpperCase()}  (mobile ${r.viewport.width}×${r.viewport.height})`);
      for (const v of r.violations) {
        console.log(`  ${v.id} (${v.impact})  — ${v.help}`);
        for (const n of v.nodes.slice(0, 8)) {
          console.log(`    ↳ ${n.selector}`);
          if (n.summary) console.log(`       ${n.summary}`);
        }
        if (v.nodes.length > 8) console.log(`    … +${v.nodes.length - 8} more`);
      }
    }
  }

  console.log(
    `\n${totalFailures === 0 ? "✅" : "❌"} Toast contrast issues: ${totalFailures}` +
      `  ·  full JSON: /tmp/contrast-toasts-report.json\n`,
  );
  process.exit(totalFailures === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
