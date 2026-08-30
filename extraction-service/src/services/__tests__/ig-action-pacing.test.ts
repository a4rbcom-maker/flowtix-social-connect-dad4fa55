import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chunkMentions,
  clampMentionsPerComment,
  buildMentionComment,
  normalizeIgHandle,
  detectIgActionBlock,
  IG_MENTION_CEILING,
  IG_MENTION_DEFAULTS,
  IG_DM_DEFAULTS,
} from "../ig-action-pacing.js";

test("clampMentionsPerComment clamps to [1, ceiling]", () => {
  assert.equal(clampMentionsPerComment(0), 1);
  assert.equal(clampMentionsPerComment(-3), 1);
  assert.equal(clampMentionsPerComment(99), IG_MENTION_CEILING);
  assert.equal(clampMentionsPerComment(4), 4);
  assert.equal(clampMentionsPerComment(NaN), 4);
});

test("chunkMentions splits by mentions_per_comment", () => {
  const users = ["a", "b", "c", "d", "e", "f", "g"];
  const chunks = chunkMentions(users, 4);
  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks[0], ["a", "b", "c", "d"]);
  assert.deepEqual(chunks[1], ["e", "f", "g"]);
});

test("chunkMentions clamps a per-comment request above the ceiling", () => {
  const chunks = chunkMentions(["a", "b", "c", "d", "e", "f"], 99);
  assert.equal(chunks[0].length, IG_MENTION_CEILING);
  assert.equal(chunks.length, 2);
});

test("chunkMentions handles an empty list", () => {
  assert.deepEqual(chunkMentions([], 4), []);
});

test("buildMentionComment prefixes @ and keeps template text", () => {
  const text = buildMentionComment("شوف ده", ["ali", "sara"]);
  assert.match(text, /@ali/);
  assert.match(text, /@sara/);
  assert.match(text, /شوف ده/);
});

test("buildMentionComment never double-prefixes @", () => {
  const text = buildMentionComment("x", ["@ali"]);
  assert.equal((text.match(/@/g) ?? []).length, 1);
});

test("buildMentionComment trims trailing slashes from handles", () => {
  const text = buildMentionComment("hi", ["ali/"]);
  assert.match(text, /@ali\b/);
  assert.doesNotMatch(text, /@ali\//);
});

test("buildMentionComment with no usernames still returns the template", () => {
  assert.equal(buildMentionComment("فقط نص", []), "فقط نص");
});

test("normalizeIgHandle accepts clean handles and strips @ and slash", () => {
  assert.equal(normalizeIgHandle("@ali/"), "ali");
  assert.equal(normalizeIgHandle("sara.kh"), "sara.kh");
  assert.equal(normalizeIgHandle(null), null);
  assert.equal(normalizeIgHandle("bad handle with spaces"), null);
  assert.equal(normalizeIgHandle(""), null);
});

test("detectIgActionBlock recognizes restriction kinds", () => {
  assert.equal(detectIgActionBlock("Action Blocked. Try again later"), "rate_limited");
  assert.equal(detectIgActionBlock("feedback_required"), "rate_limited");
  assert.equal(detectIgActionBlock("تسجيل الدخول إلى إنستجرام"), "session_dead");
  assert.equal(detectIgActionBlock("/accounts/login/"), "session_dead");
  assert.equal(detectIgActionBlock("comment not sent"), "send_rejected");
  assert.equal(detectIgActionBlock("everything looks fine"), null);
  assert.equal(detectIgActionBlock(""), null);
});

test("defaults stay conservative under the documented ceilings", () => {
  assert.ok(IG_MENTION_DEFAULTS.mentions_per_comment <= IG_MENTION_CEILING);
  assert.ok(IG_MENTION_DEFAULTS.mentions_per_comment >= 1);
  assert.ok(IG_MENTION_DEFAULTS.comments_per_hour <= 12);
  assert.ok(IG_MENTION_DEFAULTS.delay_min >= 350);
  assert.ok(IG_MENTION_DEFAULTS.daily_cap <= 80);
  assert.ok(IG_DM_DEFAULTS.daily_cap <= 30);
  assert.ok(IG_DM_DEFAULTS.rate_per_hour <= 20);
});
