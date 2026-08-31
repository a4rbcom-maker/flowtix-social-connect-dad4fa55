import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeUserHref } from "../post-comments.js";

test("vanity slug with comment_id query resolves to fb_id", () => {
  const r = normalizeUserHref("/khaled.mahmoud.349117?comment_id=Y29tbWVudDoxNTczNjMz");
  assert.equal(r?.fbId, "khaled.mahmoud.349117");
  assert.equal(r?.profileUrl, "https://www.facebook.com/khaled.mahmoud.349117");
});

test("absolute vanity URL with comment_id resolves too", () => {
  const r = normalizeUserHref("https://www.facebook.com/shahen.shahy?comment_id=Y29tbWVudDoxNTczNjMzM");
  assert.equal(r?.fbId, "shahen.shahy");
});

test("numeric profile.php id resolves with canonical profile url", () => {
  const r = normalizeUserHref("/profile.php?id=100012345678901");
  assert.equal(r?.fbId, "100012345678901");
  assert.equal(r?.profileUrl, "https://www.facebook.com/profile.php?id=100012345678901");
});

test("numeric /user/ id resolves", () => {
  assert.equal(normalizeUserHref("/user/123456789")?.fbId, "123456789");
});

test("junk slugs are rejected", () => {
  assert.equal(normalizeUserHref("/photo.php?fbid=123"), null);
  assert.equal(normalizeUserHref("/reel/abc"), null);
  assert.equal(normalizeUserHref("https://www.facebook.com/watch/live"), null);
});

test("non-user hrefs are rejected", () => {
  assert.equal(normalizeUserHref("/help/contact"), null);
  assert.equal(normalizeUserHref(""), null);
});
