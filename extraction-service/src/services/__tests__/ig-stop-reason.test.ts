import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateCoverageGate,
  classifyDomExhaustion,
  minCoverageToComplete,
  RESUMABLE_STOP_REASONS,
} from "../ig-stop-reason.js";

test("coverage gate: below target is NOT allowed to complete", () => {
  // The exact production failure: 51 stored of 27,800 total.
  const r = evaluateCoverageGate({ stored: 51, total: 27800 });
  assert.equal(r.coverage, 0);
  assert.equal(r.allowComplete, false);
  assert.equal(r.reason, "below_target");
});

test("coverage gate: ≥70% allows completion", () => {
  const r = evaluateCoverageGate({ stored: 20000, total: 27800 });
  assert.equal(r.allowComplete, true);
  assert.equal(r.reason, "coverage_met");
});

test("coverage gate: unknown/zero total defaults to allow-complete", () => {
  const unknown = evaluateCoverageGate({ stored: 43, total: null });
  assert.equal(unknown.coverage, null);
  assert.equal(unknown.allowComplete, true);
  assert.equal(unknown.reason, "total_unknown");

  const zero = evaluateCoverageGate({ stored: 0, total: 0 });
  assert.equal(zero.allowComplete, true);
  assert.equal(zero.reason, "total_unknown");
});

test("coverage gate: nothing harvested still completes (caller fails the job)", () => {
  const r = evaluateCoverageGate({ stored: 0, total: 5000 });
  assert.equal(r.coverage, 0);
  assert.equal(r.allowComplete, true);
});

test("coverage gate clamps over-100 rounding", () => {
  const r = evaluateCoverageGate({ stored: 28000, total: 27800 });
  assert.equal(r.coverage, 100);
});

test("classifyDomExhaustion distinguishes exhausted dialog vs stagnant sessions", () => {
  assert.equal(classifyDomExhaustion(50), "dom_dialog_exhausted");
  assert.equal(classifyDomExhaustion(0), "all_sessions_stagnant");
});

test("default target is 70 and dom/stagnation stops are resumable", () => {
  assert.equal(minCoverageToComplete(), 70);
  assert.ok(RESUMABLE_STOP_REASONS.has("all_sessions_stagnant"));
  assert.ok(RESUMABLE_STOP_REASONS.has("dom_dialog_exhausted"));
  assert.ok(!RESUMABLE_STOP_REASONS.has("api_list_exhausted"));
});
