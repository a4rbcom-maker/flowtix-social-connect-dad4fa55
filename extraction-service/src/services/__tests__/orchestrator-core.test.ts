import { test } from "node:test";
import assert from "node:assert/strict";
import { RateMeter, SourceStats, decideNextSource, type SourceKey } from "../orchestrator-core.js";

test("RateMeter computes users/min over rolling window", () => {
  const m = new RateMeter(90_000, 10_000);
  m.add(30, 0);
  // 30 users in 30s → 60/min
  assert.equal(m.ratePerMin(30_000), 60);
});

test("RateMeter returns 0 before eval window elapses", () => {
  const m = new RateMeter(90_000, 10_000);
  m.add(30, 0);
  assert.equal(m.ratePerMin(4_000), 0);
});

test("RateMeter prunes buckets outside the window", () => {
  const m = new RateMeter(30_000, 10_000);
  m.add(100, 0);
  m.add(10, 100_000); // way outside window
  // only the 10 at t=100s remain → window elapsed 0s at t=100s → 0
  assert.equal(m.ratePerMin(100_000), 0);
  // but right after, at t=105s, rate = 10 users / 5s → 120/min
  assert.equal(m.ratePerMin(105_000), 120);
});

test("SourceStats tracks per-source users, errors, requests", () => {
  const stats = new SourceStats<SourceKey>();
  stats.start("members_list", 0);
  stats.addUsers("members_list", 50, 10_000);
  stats.addError("members_list");
  stats.addRequest("members_list");
  stats.addRequest("members_list");
  const snap = stats.snapshot();
  assert.equal(snap.members_list.users, 50);
  assert.equal(snap.members_list.errors, 1);
  assert.equal(snap.members_list.requests, 2);
  assert.equal(snap.members_list.stop_reason, null);
});

test("SourceStats finish records stop reason and duration", () => {
  const stats = new SourceStats<SourceKey>();
  stats.start("members_list", 0);
  stats.finish("members_list", "stagnated", 60_000);
  assert.equal(stats.snapshot().members_list.stop_reason, "stagnated");
  assert.equal(stats.snapshot().members_list.duration_ms, 60_000);
});

test("low productivity triggers switch after min phase time", () => {
  const stats = new SourceStats<SourceKey>();
  stats.start("members_list", 0);
  stats.addUsers("members_list", 3, 5_000); // ~3 users in 150s → ~1.2/min (low)
  const next = decideNextSource(stats, { nowMs: 150_000, minRatePerMin: 5, evalWindowMs: 90_000, minPhaseMs: 120_000 });
  assert.equal(next, "members_search");
});

test("low productivity does NOT switch before min phase time", () => {
  const stats = new SourceStats<SourceKey>();
  stats.start("members_list", 0);
  stats.addUsers("members_list", 1, 5_000);
  const next = decideNextSource(stats, { nowMs: 60_000, minRatePerMin: 5, evalWindowMs: 90_000, minPhaseMs: 120_000 });
  assert.equal(next, null);
});

test("exhausted source switches immediately regardless of rate", () => {
  const stats = new SourceStats<SourceKey>();
  stats.start("members_list", 0);
  stats.addUsers("members_list", 500, 10_000);
  stats.finish("members_list", "stagnated", 60_000);
  assert.equal(decideNextSource(stats, { nowMs: 61_000 }), "members_search");
});

test("cascade preferred when members sources exhausted", () => {
  const stats = new SourceStats<SourceKey>();
  stats.start("members_list", 0);
  stats.finish("members_list", "stagnated", 60_000);
  stats.start("members_search", 61_000);
  stats.finish("members_search", "source_exhausted", 120_000);
  assert.equal(decideNextSource(stats, { nowMs: 121_000 }), "feed_cascade");
});

test("returns null when current source is productive", () => {
  const stats = new SourceStats<SourceKey>();
  stats.start("feed_cascade", 0);
  // 300 users in 150s → 120/min (productive)
  stats.addUsers("feed_cascade", 150, 50_000);
  stats.addUsers("feed_cascade", 150, 100_000);
  assert.equal(decideNextSource(stats, { nowMs: 150_000, minRatePerMin: 5, evalWindowMs: 90_000, minPhaseMs: 120_000 }), null);
});

test("returns null when all sources are exhausted (end of pipeline)", () => {
  const stats = new SourceStats<SourceKey>();
  stats.start("members_list", 0);
  stats.finish("members_list", "stagnated", 60_000);
  stats.start("members_search", 61_000);
  stats.finish("members_search", "source_exhausted", 120_000);
  stats.start("feed_cascade", 121_000);
  stats.finish("feed_cascade", "posts_exhausted", 300_000);
  assert.equal(decideNextSource(stats, { nowMs: 301_000 }), null);
});

test("low_yield counts as exhausted (switch immediately)", () => {
  const stats = new SourceStats<SourceKey>();
  stats.start("members_list", 0);
  stats.finish("members_list", "low_yield", 120_000);
  assert.equal(decideNextSource(stats, { nowMs: 121_000 }), "members_search");
});
