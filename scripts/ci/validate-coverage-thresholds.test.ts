import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SCRIPT = path.resolve(__dirname, "validate-coverage-thresholds.mjs");

const VALID_CONFIG = `import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    coverage: {
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
`;

let workdir: string;

function run(cwd: string) {
  return spawnSync("node", [SCRIPT], { cwd, encoding: "utf8" });
}

beforeEach(() => {
  workdir = mkdtempSync(path.join(tmpdir(), "cov-thresh-"));
  // Provide a scripts/ci dir so the script's rg-ignore glob still matches something benign.
  mkdirSync(path.join(workdir, "scripts", "ci"), { recursive: true });
  writeFileSync(
    path.join(workdir, "scripts", "ci", "validate-coverage-thresholds.mjs"),
    "// placeholder\n",
  );
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("validate-coverage-thresholds", () => {
  it("passes when all four thresholds equal 80", () => {
    writeFileSync(path.join(workdir, "vitest.config.ts"), VALID_CONFIG);
    const res = run(workdir);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/Coverage thresholds OK/);
  });

  it("fails when a threshold is set to 99 instead of 80", () => {
    writeFileSync(
      path.join(workdir, "vitest.config.ts"),
      VALID_CONFIG.replace("branches: 80", "branches: 99"),
    );
    const res = run(workdir);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/'branches' = 99, expected 80/);
  });

  it("fails when a threshold key is missing", () => {
    const missing = VALID_CONFIG.replace(/\s*functions: 80,\n/, "\n");
    writeFileSync(path.join(workdir, "vitest.config.ts"), missing);
    const res = run(workdir);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/missing threshold 'functions'/);
  });

  it("fails when a stray coverage.thresholds override exists elsewhere", () => {
    writeFileSync(path.join(workdir, "vitest.config.ts"), VALID_CONFIG);
    writeFileSync(
      path.join(workdir, "extra.config.ts"),
      "export default { coverage: { thresholds: { lines: 99 } } };\n",
    );
    const res = run(workdir);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/coverage\.thresholds override/);
  });
});
