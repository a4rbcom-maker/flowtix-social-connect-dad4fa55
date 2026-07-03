#!/usr/bin/env node
// Validates vitest coverage thresholds are the single source of truth (80%)
// and that no accidental overrides (e.g. 99%) leaked into configs or scripts.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const EXPECTED = 80;
const CONFIG_PATH = "vitest.config.ts";

let failed = false;
const fail = (msg) => {
  console.error(`❌ ${msg}`);
  failed = true;
};

// 1) vitest.config.ts must contain all four thresholds at EXPECTED value.
const cfg = readFileSync(CONFIG_PATH, "utf8");
const metrics = ["statements", "branches", "functions", "lines"];
for (const m of metrics) {
  const re = new RegExp(`${m}\\s*:\\s*(\\d+)`);
  const match = cfg.match(re);
  if (!match) {
    fail(`${CONFIG_PATH}: missing threshold '${m}'`);
    continue;
  }
  const value = Number(match[1]);
  if (value !== EXPECTED) {
    fail(`${CONFIG_PATH}: '${m}' = ${value}, expected ${EXPECTED}`);
  }
}

// 2) No coverage.thresholds override elsewhere (scripts, workflows, other configs).
try {
  const out = execSync(
    "rg -n --no-heading --glob '!node_modules' --glob '!coverage' --glob '!scripts/ci/validate-coverage-thresholds.mjs' --glob '!vitest.config.ts' 'coverage\\.thresholds' .",
    { encoding: "utf8" },
  ).trim();
  if (out) {
    fail(`Found coverage.thresholds override(s) outside ${CONFIG_PATH}:\n${out}`);
  }
} catch (e) {
  // rg exits 1 when no matches — that's the good case.
  if (e.status !== 1) throw e;
}

if (failed) {
  console.error(`\nCoverage threshold validation failed. Keep thresholds only in ${CONFIG_PATH} at ${EXPECTED}%.`);
  process.exit(1);
}

console.log(`✅ Coverage thresholds OK (single source: ${CONFIG_PATH} @ ${EXPECTED}%).`);
