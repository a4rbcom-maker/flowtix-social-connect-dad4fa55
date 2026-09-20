import { test } from "node:test";
import assert from "node:assert/strict";
import { postedGroupIds, computeFinalStatus, summarizeResults } from "../publish-logic.js";

test("postedGroupIds collects only posted rows", () => {
  const results = [
    { group_id: "g1", status: "posted", at: "t" },
    { group_id: "g2", status: "fail", at: "t" },
    { group_id: "g3", status: "skip", at: "t" },
    { group_id: "g4", status: "posted", at: "t" },
  ];
  const ids = postedGroupIds(results);
  assert.equal(ids.size, 2);
  assert.ok(ids.has("g1") && ids.has("g4"));
  assert.ok(!ids.has("g2") && !ids.has("g3"));
});

test("postedGroupIds tolerates null/undefined/garbage results", () => {
  assert.equal(postedGroupIds(null).size, 0);
  assert.equal(postedGroupIds(undefined).size, 0);
  assert.equal(postedGroupIds("not an array").size, 0);
  assert.equal(postedGroupIds([null, 42, {}, { status: "posted" }]).size, 0);
});

test("idempotency: posted groups from a previous run are skipped on resume", () => {
  // Simulates: run 1 posted g1, failed g2; resume must retry g2 only.
  const groups = ["g1", "g2", "g3"];
  const results = [{ group_id: "g1", status: "posted", at: "t" }, { group_id: "g2", status: "fail", at: "t" }];
  const alreadyPosted = postedGroupIds(results);
  const toProcess = groups.filter(g => !alreadyPosted.has(g));
  assert.deepEqual(toProcess, ["g2", "g3"]);
});

test("old-v1 'ok' status rows do NOT count as posted (no false idempotency)", () => {
  // v1 wrote status:"ok" without any verification — those must be re-processed,
  // otherwise migrating a job would skip groups that were never really posted.
  const ids = postedGroupIds([{ group_id: "g1", status: "ok", at: "t" }]);
  assert.equal(ids.size, 0);
});

test("computeFinalStatus: loop end = completed, interruption = paused", () => {
  assert.equal(computeFinalStatus(false), "completed");
  assert.equal(computeFinalStatus(true), "paused");
});

test("postedGroupIds: review rows count as submitted (never reposted)", () => {
  // A pending-approval post was submitted; a resume that reposts it would
  // duplicate the post once the admin approves the first one.
  const ids = postedGroupIds([
    { group_id: "g1", status: "review", at: "t" },
    { group_id: "g2", status: "posted", at: "t" },
    { group_id: "g3", status: "fail", at: "t" },
  ]);
  assert.ok(ids.has("g1") && ids.has("g2") && !ids.has("g3"));
});

test("summarizeResults counts every final outcome", () => {
  const s = summarizeResults([
    { group_id: "g1", status: "posted", at: "t" },
    { group_id: "g2", status: "review", at: "t" },
    { group_id: "g3", status: "fail", at: "t" },
    { group_id: "g4", status: "skip", at: "t" },
    { group_id: "g5", status: "posted", at: "t" },
    { garbage: true },
  ]);
  assert.deepEqual(s, { posted: 2, review: 1, failed: 1, skipped: 1 });
});

test("summarizeResults tolerates null/garbage results", () => {
  assert.deepEqual(summarizeResults(null), { posted: 0, review: 0, failed: 0, skipped: 0 });
  assert.deepEqual(summarizeResults("nope"), { posted: 0, review: 0, failed: 0, skipped: 0 });
});
