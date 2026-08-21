import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanDatabases } from "../src/services/enrichment-service.js";
import { config } from "../src/config.js";

/** scanDatabases must accept a direct .db file OR a directory, and fail loud
 *  (returning []) on missing/empty paths — this is what silently killed
 *  enrichment on the production server. */
async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "flowtix-enr-"));
  const checks: Array<{ name: string; pass: boolean }> = [];

  // Scenario 1: direct .db file path (the shape production .env used)
  const dbFile = join(dir, "egypt_fixed.db");
  writeFileSync(dbFile, Buffer.alloc(4096));
  const original = config.enrichmentDbPath;
  (config as { enrichmentDbPath: string }).enrichmentDbPath = dbFile;
  const fromFile = scanDatabases();
  checks.push({ name: `direct .db file accepted (got ${fromFile.length})`, pass: fromFile.length === 1 && fromFile[0].name === "egypt_fixed" && fromFile[0].sizeBytes === 4096 });

  // Scenario 2: directory with .db files (the shape deploy.yml now sets)
  const dbDir = join(dir, "enrichment");
  mkdirSync(dbDir);
  writeFileSync(join(dbDir, "egypt_fixed.db"), Buffer.alloc(8192));
  writeFileSync(join(dbDir, "notes.txt"), Buffer.alloc(10));
  (config as { enrichmentDbPath: string }).enrichmentDbPath = dbDir;
  const fromDir = scanDatabases();
  checks.push({ name: `directory scanned, non-.db ignored (got ${fromDir.length})`, pass: fromDir.length === 1 && fromDir[0].sizeBytes === 8192 });

  // Scenario 3: directory with NO .db files
  const emptyDir = join(dir, "empty");
  mkdirSync(emptyDir);
  (config as { enrichmentDbPath: string }).enrichmentDbPath = emptyDir;
  const fromEmpty = scanDatabases();
  checks.push({ name: `empty directory → [] (got ${fromEmpty.length})`, pass: fromEmpty.length === 0 });

  // Scenario 4: missing path entirely
  (config as { enrichmentDbPath: string }).enrichmentDbPath = join(dir, "does-not-exist");
  const fromMissing = scanDatabases();
  checks.push({ name: `missing path → [] (got ${fromMissing.length})`, pass: fromMissing.length === 0 });

  (config as { enrichmentDbPath: string }).enrichmentDbPath = original;
  rmSync(dir, { recursive: true, force: true });

  console.log("\n=== scanDatabases path scenarios ===");
  for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"} — ${c.name}`);

  console.log("\n================ VERDICT ================");
  const all = checks.every((c) => c.pass);
  console.log(all ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED");
  process.exit(all ? 0 : 1);
}

main().catch((err) => {
  console.error("test error:", err);
  process.exit(1);
});
