import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePermalink } from "../group-cascade-core.js";

const G = "https://www.facebook.com/groups/4245175212378645";

test("group permalinks stay intact", () => {
  assert.equal(normalizePermalink("/groups/4245175212378645/posts/pfbid0AbCdEf123", G), "https://www.facebook.com/groups/4245175212378645/posts/pfbid0AbCdEf123");
  assert.equal(normalizePermalink("https://www.facebook.com/groups/4245175212378645/posts/1234567890", G), "https://www.facebook.com/groups/4245175212378645/posts/1234567890");
});

test("page timeline permalinks KEEP the page slug", () => {
  // Regression: the old matcher dropped the slug → facebook.com/<id> (dead link)
  assert.equal(
    normalizePermalink("/BBCNews/posts/12345678901234", G),
    "https://www.facebook.com/BBCNews/posts/12345678901234",
  );
  assert.equal(
    normalizePermalink("https://www.facebook.com/some.page.7/videos/9876543210", G),
    "https://www.facebook.com/some.page.7/videos/9876543210",
  );
});

test("share and reel paths are kept whole", () => {
  assert.equal(normalizePermalink("/share/p/AbCd1234/", G), "https://www.facebook.com/share/p/AbCd1234");
  assert.equal(normalizePermalink("/reel/1234567890123456", G), "https://www.facebook.com/reel/1234567890123456");
});

test("query params and hash are stripped before matching", () => {
  assert.equal(
    normalizePermalink("/BBCNews/posts/12345678901234/?__cft__[0]=xyz&fbclid=abc", G),
    "https://www.facebook.com/BBCNews/posts/12345678901234",
  );
});

test("non-post links are rejected", () => {
  assert.equal(normalizePermalink("/BBCNews/about", G), null);
  assert.equal(normalizePermalink("/settings", G), null);
  assert.equal(normalizePermalink("", G), null);
});
