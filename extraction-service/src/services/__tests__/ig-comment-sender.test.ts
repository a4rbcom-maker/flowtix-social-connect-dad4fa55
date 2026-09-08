import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyNoMountOutcome,
  isCommentVisibleInPage,
  isPostUnavailable,
} from "../ig-comment-sender.js";
import { batchDispositionForOutcome } from "../ig-action-pacing.js";

// ─── Task 1: تأكيد التسليم يستثني صندوق الكتابة ────────────────────────────
// Reality model: document.body.innerText ALWAYS contains the composer box's
// text (the box is part of the page). After a successful post, the same text
// gains one MORE occurrence in the comments list → count(body) > count(box).

test("posted comment (body count > box count) counts as delivered", () => {
  const body =
    "Instagram\n someone else replied\n مرحبا @ali @sara @kimo @omar\n another comment\n مرحبا @ali @sara @kimo @omar";
  const boxes = ["مرحبا @ali @sara @kimo @omar"]; // composer still holds a copy
  assert.equal(isCommentVisibleInPage(body, boxes, "مرحبا @ali @sara"), true);
});

test("text that exists ONLY inside the composer box is NOT delivered", () => {
  const body = "Instagram\n مرحبا @ali @sara @kimo @omar\n Load more comments";
  const boxes = ["مرحبا @ali @sara @kimo @omar"];
  assert.equal(isCommentVisibleInPage(body, boxes, "مرحبا @ali @sara"), false);
});

test("posted comment remains detected after its copy is removed from the box", () => {
  // User cleared the composer after posting; the comment stays in the list.
  const body = "Instagram\n مرحبا @ali @sara\n older comment";
  const boxes = [""];
  assert.equal(isCommentVisibleInPage(body, boxes, "مرحبا @ali @sara"), true);
});

test("empty prefix is never treated as delivered", () => {
  assert.equal(isCommentVisibleInPage("anything", [], ""), false);
  assert.equal(isCommentVisibleInPage("anything", [], "   "), false);
});

test("handles-only comment (no template body) delivers via first handle", () => {
  const boxes = ["@ali @sara @kimo @omar"];
  // before post: box copy only → not delivered
  const preBody = "Instagram\n @ali @sara @kimo @omar\n old comment";
  assert.equal(isCommentVisibleInPage(preBody, boxes, "@ali"), false);
  // after post: list copy + box copy → delivered
  const postedBody = "Instagram\n @ali @sara @kimo @omar\n @ali @sara @kimo @omar";
  assert.equal(isCommentVisibleInPage(postedBody, boxes, "@ali"), true);
});

test("empty boxes list falls back to plain substring match", () => {
  assert.equal(isCommentVisibleInPage("hello مرحبا world", [], "مرحبا"), true);
  assert.equal(isCommentVisibleInPage("hello world", [], "مرحبا"), false);
});

// ─── 2026-09-08: كشف الجلسة الميتة في مسار no-mount ─────────────────────────
// Reality model: with a dead session, the post URL redirects to the login
// page — no comment box ever mounts, and the page text carries login-wall
// markers, NOT a 404. classifyNoMountOutcome turns that into session_dead
// (→ cooldown + fast-fail path) instead of retryable thread_unavailable
// (the 2h13m zero-yield churn of job 47dc024c).

test("classifyNoMountOutcome: login wall → session_dead", () => {
  const loginWall = "Instagram\nLog in to Instagram\nSign up to see photos, videos and more from your friends.";
  assert.deepEqual(classifyNoMountOutcome(loginWall), {
    ok: false, kind: "session_dead", detail: "login wall — session expired (no comment box)",
  });
  assert.deepEqual(classifyNoMountOutcome("تسجيل الدخول إلى إنستجرام • Instagram"), {
    ok: false, kind: "session_dead", detail: "login wall — session expired (no comment box)",
  });
});

test("classifyNoMountOutcome: restriction banner → rate_limited", () => {
  assert.deepEqual(classifyNoMountOutcome("Action Blocked — Try again later"), {
    ok: false, kind: "rate_limited", detail: "restriction banner (no comment box)",
  });
});

test("classifyNoMountOutcome: dead post → post_unavailable (permanent skip)", () => {
  assert.deepEqual(classifyNoMountOutcome("Sorry, this page isn't available."), {
    ok: false, kind: "post_unavailable", detail: "post unavailable (404/comments off)",
  });
});

test("classifyNoMountOutcome: slow/blank page stays retryable", () => {
  assert.deepEqual(classifyNoMountOutcome("Instagram\nLoading comments…"), {
    ok: false, kind: "thread_unavailable", detail: "comment box never mounted (45s)",
  });
  assert.deepEqual(classifyNoMountOutcome(""), {
    ok: false, kind: "thread_unavailable", detail: "comment box never mounted (45s)",
  });
});

// ─── Task 2: تمييز البوست غير المتاح عن فشل قابل لإعادة المحاولة ───────────

test("isPostUnavailable detects 404 / disabled-comments pages", () => {
  assert.equal(isPostUnavailable("Sorry, this page isn't available."), true);
  assert.equal(isPostUnavailable("عذرًا، هذه الصفحة غير متوفرة"), true);
  assert.equal(isPostUnavailable("Page Not Found"), true);
  assert.equal(isPostUnavailable("Comments are turned off for this post"), true);
  assert.equal(isPostUnavailable("Instagram — feed loading"), false);
  assert.equal(isPostUnavailable(""), false);
});

test("batchDispositionForOutcome: post_unavailable skips permanently, everything else retries", () => {
  assert.equal(batchDispositionForOutcome("post_unavailable"), "skip_permanent");
  assert.equal(batchDispositionForOutcome("send_failed"), "retry");
  assert.equal(batchDispositionForOutcome("thread_unavailable"), "retry");
  assert.equal(batchDispositionForOutcome("rate_limited"), "retry");
  assert.equal(batchDispositionForOutcome("session_dead"), "retry");
});
