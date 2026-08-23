import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionHealthMonitor, classifyFailure } from "../session-health.js";
import { ExtractionError, ErrorCodes } from "../../errors.js";

test("classifies error kinds", () => {
  assert.equal(classifyFailure(new ExtractionError(ErrorCodes.NETWORK_ERROR, "x")).kind, "network");
  assert.equal(classifyFailure(new ExtractionError(ErrorCodes.TIMEOUT, "x")).kind, "network");
  assert.equal(classifyFailure(new ExtractionError(ErrorCodes.BROWSER_CRASH, "x")).kind, "network");
  assert.equal(classifyFailure(new ExtractionError(ErrorCodes.SESSION_EXPIRED, "x")).kind, "auth");
  assert.equal(classifyFailure(new ExtractionError(ErrorCodes.AUTH_FAILED, "x")).kind, "auth");
  assert.equal(classifyFailure(new ExtractionError(ErrorCodes.SESSION_NOT_CONNECTED, "x")).kind, "auth");
  assert.equal(classifyFailure(new ExtractionError(ErrorCodes.NO_COOKIES, "x")).kind, "auth");
  assert.equal(classifyFailure(new ExtractionError(ErrorCodes.INVALID_INPUT, "x")).kind, "bug");
  assert.equal(classifyFailure(new Error("boom")).kind, "bug");
});

test("classifies restriction messages", () => {
  assert.equal(classifyFailure(new Error("page redirected to /checkpoint/")).kind, "restriction");
  assert.equal(classifyFailure(new Error("Account is temporarily locked")).kind, "restriction");
});

test("classifies network error messages", () => {
  assert.equal(classifyFailure(new Error("net::ERR_CONNECTION_RESET")).kind, "network");
  assert.equal(classifyFailure(new Error("navigation failed: ETIMEDOUT")).kind, "network");
});

test("transitions healthy → degraded → unavailable", () => {
  const m = new SessionHealthMonitor();
  m.register("s1");
  assert.equal(m.state("s1"), "healthy");
  m.recordFailure("s1", { kind: "network", detail: "nav timeout" });
  assert.equal(m.state("s1"), "degraded");
  for (let i = 0; i < 4; i++) m.recordFailure("s1", { kind: "network", detail: "x" });
  assert.equal(m.state("s1"), "unavailable");
  assert.equal(m.available("s1"), false);
});

test("auth failure makes session unavailable immediately", () => {
  const m = new SessionHealthMonitor();
  m.register("s1");
  m.recordFailure("s1", { kind: "auth", detail: "login redirect" });
  assert.equal(m.state("s1"), "unavailable");
});

test("success recovers degraded to healthy", () => {
  const m = new SessionHealthMonitor();
  m.register("s1");
  m.recordFailure("s1", { kind: "network", detail: "x" });
  m.recordSuccess("s1");
  assert.equal(m.state("s1"), "healthy");
});

test("unavailable session cannot be recovered by single success", () => {
  const m = new SessionHealthMonitor();
  m.register("s1");
  for (let i = 0; i < 5; i++) m.recordFailure("s1", { kind: "auth", detail: "login redirect" });
  assert.equal(m.state("s1"), "unavailable");
  m.recordSuccess("s1");
  assert.equal(m.state("s1"), "recovery");
  m.recordSuccess("s1");
  assert.equal(m.state("s1"), "healthy");
});

test("last failure recorded with reason", () => {
  const m = new SessionHealthMonitor();
  m.register("s1");
  m.recordFailure("s1", { kind: "auth", detail: "login redirect" });
  assert.equal(m.lastFailure("s1")?.kind, "auth");
  assert.equal(m.lastFailure("s1")?.detail, "login redirect");
});

test("unknown session is healthy and available", () => {
  const m = new SessionHealthMonitor();
  assert.equal(m.state("ghost"), "healthy");
  assert.equal(m.available("ghost"), true);
});

test("retry backoff is exponential and capped", () => {
  const m = new SessionHealthMonitor({ baseMs: 1000, maxMs: 30_000 });
  assert.equal(m.backoffMs("s1", 1), 1000);
  assert.equal(m.backoffMs("s1", 2), 2000);
  assert.equal(m.backoffMs("s1", 3), 4000);
  assert.equal(m.backoffMs("s1", 9), 30000);
});

test("snapshot exposes per-session state", () => {
  const m = new SessionHealthMonitor();
  m.register("s1");
  m.register("s2");
  m.recordFailure("s1", { kind: "network", detail: "x" });
  const snap = m.snapshot();
  assert.equal(snap.length, 2);
  const s1 = snap.find((s) => s.session_id === "s1");
  assert.equal(s1?.state, "degraded");
  assert.equal(s1?.failures, 1);
});
