import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dayKeyUtc,
  nextDelayMs,
  renderTemplate,
  hasVariation,
  isQuietHour,
  pickSession,
  detectBlockSignal,
  normalizeThreadId,
} from "../message-pacing.js";

test("dayKeyUtc is calendar-day UTC, not rolling 24h", () => {
  assert.equal(dayKeyUtc(new Date("2026-08-29T23:59:00Z")), "2026-08-29");
  assert.equal(dayKeyUtc(new Date("2026-08-30T00:01:00Z")), "2026-08-30");
});

test("nextDelayMs stays in range with jitter", () => {
  const vals = Array.from({ length: 50 }, () => nextDelayMs(45, 150));
  for (const v of vals) {
    assert.ok(v >= 36_000 && v <= 180_000, `out of range: ${v}`);
  }
  assert.ok(new Set(vals).size > 40, "delays look deterministic");
});

test("renderTemplate resolves {{name}} and spintax", () => {
  const out = renderTemplate("{مرحبا|أهلا} {{name}}", { name: "خالد" });
  assert.ok(out === "مرحبا خالد" || out === "أهلا خالد", out);
  const noVars = renderTemplate("نص ثابت", { name: "خالد" });
  assert.equal(noVars, "نص ثابت");
});

test("hasVariation flags a non-varying template", () => {
  assert.equal(hasVariation("نص ثابت"), false);
  assert.equal(hasVariation("{a|b} نص"), true);
  assert.equal(hasVariation("مرحبا {{name}}"), true);
});

test("isQuietHour blocks 01:00-07:00 Cairo (UTC+3 in summer, +2 in winter)", () => {
  // 00:30Z on 2026-08-29 = 03:30 Cairo (EEST, +3) → quiet
  assert.equal(isQuietHour(new Date("2026-08-29T00:30:00Z")), true);
  // 09:00Z = 12:00 Cairo → not quiet
  assert.equal(isQuietHour(new Date("2026-08-29T09:00:00Z")), false);
  // 22:00Z on 2026-01-15 = 00:00 Cairo (EET, +2) → not quiet (before 01:00)
  assert.equal(isQuietHour(new Date("2026-01-15T22:00:00Z")), false);
  // 23:30Z on 2026-01-15 = 01:30 Cairo → quiet
  assert.equal(isQuietHour(new Date("2026-01-15T23:30:00Z")), true);
});

test("pickSession skips capped, cooling-down and closed sessions", () => {
  const chosen = pickSession([
    { sessionId: "a", sentToday: 40, dailyCap: 40, sentLastHour: 0, ratePerHour: 12, cooldownUntil: null, closed: false },
    { sessionId: "b", sentToday: 5, dailyCap: 40, sentLastHour: 0, ratePerHour: 12, cooldownUntil: null, closed: false },
  ]);
  assert.equal(chosen?.sessionId, "b");
  assert.equal(
    pickSession([{ sessionId: "a", sentToday: 40, dailyCap: 40, sentLastHour: 0, ratePerHour: 12, cooldownUntil: null, closed: false }]),
    null,
  );
});

test("pickSession prefers the least-used live session", () => {
  const chosen = pickSession([
    { sessionId: "a", sentToday: 10, dailyCap: 40, sentLastHour: 0, ratePerHour: 12, cooldownUntil: null, closed: false },
    { sessionId: "b", sentToday: 2, dailyCap: 40, sentLastHour: 0, ratePerHour: 12, cooldownUntil: null, closed: false },
  ]);
  assert.equal(chosen?.sessionId, "b");
});

test("pickSession respects hourly rate window", () => {
  const chosen = pickSession([
    { sessionId: "a", sentToday: 0, dailyCap: 40, sentLastHour: 12, ratePerHour: 12, cooldownUntil: null, closed: false },
    { sessionId: "b", sentToday: 0, dailyCap: 40, sentLastHour: 1, ratePerHour: 12, cooldownUntil: null, closed: false },
  ]);
  assert.equal(chosen?.sessionId, "b");
});

test("pickSession returns null when all sessions are closed or cooling", () => {
  assert.equal(
    pickSession([
      { sessionId: "a", sentToday: 0, dailyCap: 40, sentLastHour: 0, ratePerHour: 12, cooldownUntil: new Date(Date.now() + 3_600_000), closed: false },
    ]),
    null,
  );
  assert.equal(
    pickSession([
      { sessionId: "a", sentToday: 0, dailyCap: 40, sentLastHour: 0, ratePerHour: 12, cooldownUntil: null, closed: true },
    ]),
    null,
  );
});

test("detectBlockSignal recognizes FB restriction copy (ar + en)", () => {
  assert.equal(detectBlockSignal("You've reached the message request limit"), "rate_limited");
  assert.equal(detectBlockSignal("You can't currently message this person"), "rate_limited");
  assert.equal(detectBlockSignal("لا يمكنك إرسال رسائل الآن"), "rate_limited");
  assert.equal(detectBlockSignal("تم تقييد رسائلك مؤقتاً"), "rate_limited");
  assert.equal(detectBlockSignal("Message not sent"), "send_rejected");
  assert.equal(detectBlockSignal("لم يتم إرسال الرسالة"), "send_rejected");
  assert.equal(detectBlockSignal("Log in to Facebook"), "session_dead");
  assert.equal(detectBlockSignal("hello there, how are you?"), null);
});

test("normalizeThreadId strips msg_ prefix and rejects non-numeric ids", () => {
  assert.equal(normalizeThreadId("msg_74100576336"), "74100576336");
  assert.equal(normalizeThreadId("74100576336"), "74100576336");
  assert.equal(normalizeThreadId("msg_100082829943387"), "100082829943387");
  assert.equal(normalizeThreadId("hesham.maged"), null);
  assert.equal(normalizeThreadId("msg_ab12"), null);
  assert.equal(normalizeThreadId(""), null);
});
