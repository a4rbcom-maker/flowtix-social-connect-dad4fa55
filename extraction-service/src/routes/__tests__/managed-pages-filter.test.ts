import { test } from "node:test";
import assert from "node:assert/strict";
import { isManagedPageEntity, extractManagedPages, isManagedPageCandidate } from "../managed-pages-filter.js";

test("accepts a real Page entity (probe shape 2026-08-31)", () => {
  const entity = {
    __typename: "Page",
    id: "123456789012345",
    name: "xtramenu",
    profile_picture: { uri: "https://scontent.xx.fbcdn.net/v/t39.30808-1/x.jpg" },
    is_failing_page_publishing_authorization: false,
  };
  assert.equal(isManagedPageEntity(entity), true);
});

test("rejects User typename (personal profile is not a managed page)", () => {
  assert.equal(isManagedPageEntity({ __typename: "User", id: "61591749260391", name: "Lily Moemen" }), false);
});

test("rejects page with failing publishing authorization (inbox access broken)", () => {
  assert.equal(
    isManagedPageEntity({ __typename: "Page", id: "123456789012345", name: "My Page", is_failing_page_publishing_authorization: true }),
    false,
  );
});

test("rejects unread-notification counter copy as name", () => {
  for (const name of [
    "عدد الإشعارات غير المقروءة",
    "4 إشعارات غير مقروءة",
    "3 رسالة جديدة",
    "2 unread notifications",
    "5 new messages",
    "Notifications",
  ]) {
    assert.equal(
      isManagedPageEntity({ __typename: "Page", id: "123456789012345", name }),
      false,
      `must reject name: ${name}`,
    );
  }
});

test("rejects non-numeric or short ids (usernames/legacy slug ids)", () => {
  assert.equal(isManagedPageEntity({ __typename: "Page", id: "xtramenucom", name: "xtramenu" }), false);
  assert.equal(isManagedPageEntity({ __typename: "Page", id: "1234", name: "xtramenu" }), false);
  assert.equal(isManagedPageEntity({ __typename: "Page", id: "", name: "xtramenu" }), false);
  assert.equal(isManagedPageEntity({ __typename: "Page", name: "xtramenu" }), false);
});

test("rejects missing or degenerate names", () => {
  assert.equal(isManagedPageEntity({ __typename: "Page", id: "123456789012345" }), false);
  assert.equal(isManagedPageEntity({ __typename: "Page", id: "123456789012345", name: "" }), false);
  assert.equal(isManagedPageEntity({ __typename: "Page", id: "123456789012345", name: "4" }), false);
});

test("extractManagedPages walks a switcher payload and keeps only valid pages", () => {
  const payload = {
    data: {
      viewer: {
        profile_switcher_eligible_profiles: [
          { __typename: "User", id: "61591749260391", name: "Lily Moemen", profile_picture: { uri: "u.jpg" } },
          { __typename: "Page", id: "551321368296102", name: "xtramenu", profile_picture: { uri: "p.jpg" } },
          { __typename: "Page", id: "990000000000001", name: "عدد الإشعارات غير المقروءة" },
          { __typename: "Page", id: "990000000000002", name: "Broken Page", is_failing_page_publishing_authorization: true },
        ],
      },
    },
  };
  const pages = extractManagedPages(payload);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].id, "551321368296102");
  assert.equal(pages[0].name, "xtramenu");
  assert.equal(pages[0].pictureUrl, "p.jpg");
});

test("extractManagedPages dedupes by id and tolerates garbage", () => {
  const payload = [
    { __typename: "Page", id: "551321368296102", name: "xtramenu" },
    { __typename: "Page", id: "551321368296102", name: "xtramenu dup" },
    null,
    { nested: { deeper: [{ __typename: "Page", id: "888888888888888", name: "Second Page" }] } },
    "not-an-object",
  ];
  const pages = extractManagedPages(payload);
  assert.equal(pages.length, 2);
  assert.deepEqual(pages.map(p => p.id).sort(), ["551321368296102", "888888888888888"]);
});

test("isManagedPageCandidate applies the same numeric-id/counter rules to DOM fallback candidates", () => {
  assert.equal(isManagedPageCandidate("551321368296102", "xtramenu"), true);
  assert.equal(isManagedPageCandidate("xtramenucom", "xtramenu"), false);
  assert.equal(isManagedPageCandidate("551321368296102", "عدد الإشعارات غير المقروءة"), false);
  assert.equal(isManagedPageCandidate("551321368296102", "3 إشعارات"), false);
});
