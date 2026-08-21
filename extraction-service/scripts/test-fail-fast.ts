import { jobQueue } from "../src/services/job-queue.js";
import { ExtractionError, ErrorCodes } from "../src/errors.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Reproduces the stuck-job bug: task throws a non-retryable error during
 *  context creation — the failure handler (failJob) MUST still run,
 *  otherwise the job row stays "running" forever with zero results. */
async function main(): Promise<void> {
  console.log("\n=== 1) non-retryable failure invokes failure handler (failJob) ===");
  let failJobCalled = 0;
  let surfacedError: unknown = null;

  try {
    await jobQueue.enqueue(
      async () => {
        throw new ExtractionError(ErrorCodes.SESSION_EXPIRED, "session guest during context creation");
      },
      async () => {
        failJobCalled++;
      },
    );
  } catch (err) {
    surfacedError = err;
  }

  const c1 = [
    { name: "failure handler (failJob) was invoked", pass: failJobCalled === 1 },
    { name: "error still surfaced to caller log", pass: surfacedError instanceof ExtractionError },
  ];
  for (const c of c1) console.log(`  ${c.pass ? "PASS" : "FAIL"} — ${c.name}`);

  console.log("\n=== 2) retryable failure retries then invokes failure handler once ===");
  let attempts = 0;
  let failJobCalled2 = 0;
  try {
    await jobQueue.enqueue(
      async () => {
        attempts++;
        throw new ExtractionError(ErrorCodes.BROWSER_CRASH, "browser crashed");
      },
      async () => {
        failJobCalled2++;
      },
    );
  } catch {
    /* expected */
  }

  const c2 = [
    { name: `task retried to the end (attempts=${attempts}, expected 4 = 1 + 3 retries)`, pass: attempts === 4 },
    { name: "failure handler invoked exactly once", pass: failJobCalled2 === 1 },
  ];
  for (const c of c2) console.log(`  ${c.pass ? "PASS" : "FAIL"} — ${c.name}`);

  console.log("\n=== 3) success path never invokes failure handler ===");
  let failJobCalled3 = 0;
  await jobQueue.enqueue(
    async () => {
      await sleep(50);
    },
    async () => {
      failJobCalled3++;
    },
  );
  const c3 = { name: "failure handler not invoked on success", pass: failJobCalled3 === 0 };
  console.log(`  ${c3.pass ? "PASS" : "FAIL"} — ${c3.name}`);

  console.log("\n=== 4) failure-handler error does not mask the original error ===");
  let surfaced: unknown = null;
  try {
    await jobQueue.enqueue(
      async () => {
        throw new ExtractionError(ErrorCodes.SESSION_IN_USE, "original error");
      },
      async () => {
        throw new Error("failJob itself broke");
      },
    );
  } catch (err) {
    surfaced = err;
  }
  const c4 = { name: "original error surfaces even if failJob throws", pass: surfaced instanceof ExtractionError && (surfaced as ExtractionError).code === ErrorCodes.SESSION_IN_USE };
  console.log(`  ${c4.pass ? "PASS" : "FAIL"} — ${c4.name}`);

  const allPass = c1.every((c) => c.pass) && c2.every((c) => c.pass) && c3.pass && c4.pass;
  console.log("\n================ VERDICT ================");
  console.log(allPass ? "ALL CHECKS PASSED — jobs can never get stuck on context-creation failures" : "SOME CHECKS FAILED");
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error("test error:", err);
  process.exit(1);
});
