#!/usr/bin/env node
/**
 * Automated WCAG color-contrast audit for Flowtix.
 *
 * Runs axe-core (color-contrast + color-contrast-enhanced rules) against a
 * list of routes in BOTH light and dark modes and prints a grouped report.
 *
 * Usage:
 *   node scripts/contrast-audit.mjs                         # default routes, http://localhost:8080
 *   BASE_URL=https://flowtix-social-connect.lovable.app \
 *     node scripts/contrast-audit.mjs /dashboard /dashboard/whatsapp/inbox
 *
 * Exit code:
 *   0  no violations
 *   1  violations found (see stdout / /tmp/contrast-report.json)
 *
 * Notes:
 *   - Auth-gated routes are skipped automatically when the page redirects
 *     to /auth or /login (audit still runs on the landing/auth pages).
 *   - Dark mode is toggled by writing `theme=dark` to localStorage and
 *     adding `.dark` to <html>, matching the app's own theme provider.
 */

import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { writeFileSync } from "node:fs";

const BASE_URL = process.env.BASE_URL || "http://localhost:8080";
const DEFAULT_ROUTES = [
  "/",
  "/auth",
  "/login",
  "/pricing",
  "/dashboard",
  "/dashboard/whatsapp/inbox",
  "/dashboard/facebook/groups",
  "/dashboard/facebook/campaigns/new",
  "/dashboard/bulk",
  "/dashboard/jobs",
];
const routes = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_ROUTES;
const MODES = ["light", "dark"];

const RULES = ["color-contrast", "color-contrast-enhanced"];

function fmtNode(n) {
  return {
    selector: n.target?.join(" ") ?? "",
    html: (n.html || "").slice(0, 140),
    summary: n.failureSummary?.replace(/\s+/g, " ").trim() ?? "",
  };
}

async function auditPage(page, url, mode) {
  await page.addInitScript((m) => {
    try {
      localStorage.setItem("theme", m);
      localStorage.setItem("flowtix-theme", m);
    } catch {}
  }, mode);

  const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 }).catch((e) => ({ error: e }));
  if (resp?.error) return { url, mode, skipped: `navigation failed: ${resp.error.message}` };

  // Apply .dark class in case the theme provider hasn't hydrated yet.
  await page.evaluate((m) => {
    const root = document.documentElement;
    root.classList.toggle("dark", m === "dark");
    root.style.colorScheme = m;
  }, mode);

  // Small settle for fonts / hydration.
  await page.waitForTimeout(600);

  const finalUrl = page.url();
  const redirected = !finalUrl.includes(new URL(url).pathname) && /\/(auth|login)(\?|$)/.test(finalUrl);

  const results = await new AxeBuilder({ page })
    .withRules(RULES)
    .analyze()
    .catch((e) => ({ error: e.message }));

  if (results.error) return { url, mode, skipped: `axe failed: ${results.error}` };

  const violations = (results.violations || []).map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map(fmtNode),
  }));

  return {
    url,
    finalUrl,
    mode,
    authGated: redirected,
    violationCount: violations.reduce((a, v) => a + v.nodes.length, 0),
    violations,
  };
}

(async () => {
  console.log(`\n🎨  WCAG contrast audit — ${BASE_URL}`);
  console.log(`    routes: ${routes.length}  ·  modes: ${MODES.join(", ")}\n`);

  const browser = await chromium.launch({ headless: true });
  const report = [];
  let totalFailures = 0;

  for (const mode of MODES) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      colorScheme: mode,
    });
    const page = await context.newPage();
    for (const route of routes) {
      const url = new URL(route, BASE_URL).toString();
      process.stdout.write(`  [${mode.padEnd(5)}] ${route} … `);
      const r = await auditPage(page, url, mode);
      report.push(r);
      if (r.skipped) {
        console.log(`skipped (${r.skipped})`);
        continue;
      }
      totalFailures += r.violationCount;
      const gate = r.authGated ? " · auth-gated" : "";
      console.log(r.violationCount === 0 ? `✅ pass${gate}` : `❌ ${r.violationCount} node(s)${gate}`);
    }
    await context.close();
  }

  await browser.close();

  writeFileSync("/tmp/contrast-report.json", JSON.stringify(report, null, 2));

  // Grouped failure output.
  const failed = report.filter((r) => r.violationCount);
  if (failed.length) {
    console.log("\n────────  Contrast failures  ────────");
    for (const r of failed) {
      console.log(`\n• ${r.mode.toUpperCase()}  ${r.url}`);
      for (const v of r.violations) {
        console.log(`  ${v.id} (${v.impact})  — ${v.help}`);
        for (const n of v.nodes.slice(0, 5)) {
          console.log(`    ↳ ${n.selector}`);
          if (n.summary) console.log(`       ${n.summary}`);
        }
        if (v.nodes.length > 5) console.log(`    … +${v.nodes.length - 5} more`);
      }
    }
  }

  console.log(
    `\n${totalFailures === 0 ? "✅" : "❌"} Total contrast issues: ${totalFailures}` +
      `  ·  full JSON: /tmp/contrast-report.json\n`,
  );
  process.exit(totalFailures === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
