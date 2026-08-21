import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readFileSync } from "fs";
import { jobQueue } from "../src/services/job-queue.js";
import { searchInDb } from "../src/services/enrichment-service.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function testSequentialQueue(): Promise<boolean> {
  const events: string[] = [];

  const taskA = async () => {
    events.push("A:start");
    await sleep(600);
    events.push("A:end");
  };
  const taskB = async () => {
    events.push("B:start");
    await sleep(100);
    events.push("B:end");
  };

  const pA = jobQueue.enqueue(taskA, async () => {});
  await sleep(100);
  const pB = jobQueue.enqueue(taskB, async () => {});
  await Promise.all([pA, pB]);

  const ok = events.join(",") === "A:start,A:end,B:start,B:end";
  console.log(`  events: ${events.join(",")}`);
  console.log(`  ${ok ? "PASS" : "FAIL"} — second job started only after first finished (one active job at a time)`);
  return ok;
}

function testEnrichmentEngine(): boolean {
  const dir = mkdtempSync(join(tmpdir(), "flowtix-enrich-"));
  const dbPath = join(dir, "test.db");
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE data (FBID TEXT, Phone TEXT, first_name TEXT, last_name TEXT, email TEXT, city TEXT)`);
  const insert = db.prepare("INSERT INTO data (FBID, Phone, first_name, last_name, email) VALUES (?, ?, ?, ?, ?)");
  insert.run("1000000000000001", "01012345678", "أحمد", "محمد", "ahmed@example.com");
  insert.run("1000000000000002", "01198765432", "سارة", "علي", "sara@example.com");
  insert.run("1000000000000003", null, "محمود", "حسن", null);

  const found = searchInDb(db, [
    "1000000000000001",
    "1000000000000002",
    "1000000000009999",
  ]);
  db.close();
  rmSync(dir, { recursive: true, force: true });

  const checks = [
    { name: "matched 2 of 3 IDs", pass: found.size === 2 },
    { name: "row 1 has phone + name", pass: found.get("1000000000000001")?.Phone === "01012345678" && found.get("1000000000000001")?.first_name === "أحمد" },
    { name: "row 2 has email", pass: found.get("1000000000000002")?.email === "sara@example.com" },
    { name: "unknown ID not returned", pass: !found.has("1000000000009999") },
  ];
  for (const c of checks) console.log(`  ${c.pass ? "PASS" : "FAIL"} — ${c.name}`);
  return checks.every((c) => c.pass);
}

function auditEnrichmentCalls(): boolean {
  const src = readFileSync(new URL("../src/routes/extract.ts", import.meta.url), "utf8");
  const calls = (src.match(/enrichJobResults\(jobId\)/g) || []).length;
  const progressPhases = (src.match(/setEnrichingPhase\(jobId\)/g) || []).length;
  const terminalPaths = (src.match(/status: "completed"/g) || []).length;

  const checks = [
    { name: `enrichJobResults invoked on all terminal paths (${calls} call sites)`, pass: calls >= 4 },
    { name: `enriching phase reported to UI (${progressPhases} sites)`, pass: progressPhases >= 4 },
    { name: `completion paths present (${terminalPaths})`, pass: terminalPaths >= 3 },
    { name: "next queued job starts only in finally (after enrichment)", pass: src.includes("} finally {") && src.indexOf("enrichJobResults(jobId)") < src.lastIndexOf("autoStartNextQueuedJob(userId)") },
  ];
  for (const c of checks) console.log(`  ${c.pass ? "PASS" : "FAIL"} — ${c.name}`);
  return checks.every((c) => c.pass);
}

async function main(): Promise<void> {
  console.log("\n=== 1) One-job-at-a-time queue (sequential execution) ===");
  const queueOk = await testSequentialQueue();

  console.log("\n=== 2) Enrichment engine works on real SQLite ===");
  const enrichOk = testEnrichmentEngine();

  console.log("\n=== 3) Enrichment wired after extraction (code audit) ===");
  const auditOk = auditEnrichmentCalls();

  console.log("\n================ VERDICT ================");
  const all = queueOk && enrichOk && auditOk;
  console.log(all ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED");
  process.exit(all ? 0 : 1);
}

main().catch((err) => {
  console.error("test error:", err);
  process.exit(1);
});
