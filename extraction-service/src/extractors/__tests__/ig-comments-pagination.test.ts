import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommentMediaPk, shouldRetryCommentsPage, pickCommentsConn } from "../ig-post-users.js";

// Regression tests for ig_post_commenters pagination (post Dc1LGfkITiZ yielded
// 8 of 182 comments). Red phase: these functions do not exist yet in
// ig-post-users.ts — implementing them is Task 2 of the plan.

// ---- parseCommentMediaPk: media pk from comment_id -----------------------
// IG comment ids are "<comment_pk>_<media_pk>"; the trailing segment is the
// true media id (proven live: post Dc1LGfkITiZ og:ios:url media id
// 3978134670572337305 == base64 decode of the shortcode).

test("parseCommentMediaPk extracts media id from '<comment>_<media>'", () => {
  assert.equal(parseCommentMediaPk("18163341355485047_3978134670572337305"), "3978134670572337305");
});

test("parseCommentMediaPk passes a bare numeric pk through", () => {
  assert.equal(parseCommentMediaPk("3978134670572337305"), "3978134670572337305");
});

test("parseCommentMediaPk returns null for junk", () => {
  assert.equal(parseCommentMediaPk(""), null);
  assert.equal(parseCommentMediaPk("abc_def"), null);
  assert.equal(parseCommentMediaPk("12_34_extra"), null);
});

// ---- shouldRetryCommentsPage: transient vs genuine end --------------------

test("retries network death and 429/5xx up to 3 attempts", () => {
  assert.equal(shouldRetryCommentsPage(0, 0, 1), true);
  assert.equal(shouldRetryCommentsPage(429, 0, 1), true);
  assert.equal(shouldRetryCommentsPage(500, 0, 1), true);
  assert.equal(shouldRetryCommentsPage(503, 0, 3), true);
});

test("does not retry success, 4xx, or exhausted attempts", () => {
  assert.equal(shouldRetryCommentsPage(200, 5, 1), false);
  assert.equal(shouldRetryCommentsPage(400, 0, 1), false);
  assert.equal(shouldRetryCommentsPage(403, 0, 1), false);
  assert.equal(shouldRetryCommentsPage(0, 0, 4), false);
});

// ---- pickCommentsConn: edge-key resolution ---------------------------------

test("pickCommentsConn tries the three edge keys in order", () => {
  const modern = { edge_media_to_comment_thread_or_show_more_edge_or_toplined_comments: { edges: [1], count: 7 } };
  const older = { edge_media_to_parent_comment: { edges: [2] } };
  const oldest = { edge_media_to_comment: { edges: [3] } };
  assert.equal(pickCommentsConn(modern).edges.length, 1);
  assert.equal(pickCommentsConn(older).edges.length, 1);
  assert.equal(pickCommentsConn(oldest).edges.length, 1);
});

test("pickCommentsConn returns empty edges + null count when xdt is missing/empty", () => {
  assert.equal(pickCommentsConn(undefined).edges.length, 0);
  assert.equal(pickCommentsConn({}).edges.length, 0);
  assert.equal(pickCommentsConn({}).count, null);
});
