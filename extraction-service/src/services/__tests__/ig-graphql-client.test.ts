import { test } from "node:test";
import assert from "node:assert/strict";
import { parseIgGraphqlFollowersPage, extractXdtGqlCursor, igGraphqlUsersFromEdge } from "../ig-graphql-client.js";

/** Shape mirrors Instagram xdt/graphql __a=1 followers response (data.user.edge_followed_by). */
const followersPayload = {
  data: {
    user: {
      edge_followed_by: {
        count: 4957,
        page_info: { has_next_page: true, end_cursor: "QVFD" },
        edges: [
          { node: { id: "123", username: "user_a", full_name: "User A", profile_pic_url: "https://pic/a.jpg" } },
          { node: { id: "456", username: "user_b", full_name: "", profile_pic_url: "https://pic/b.jpg" } },
        ],
      },
    },
    status: "ok",
  },
};

const followingPayload = {
  data: {
    user: {
      edge_follow: {
        count: 300,
        page_info: { has_next_page: false, end_cursor: null },
        edges: [{ node: { id: "789", username: "user_c", full_name: "C" } }],
      },
    },
  },
};

test("parses followers page: rows + cursor + total", () => {
  const page = parseIgGraphqlFollowersPage(JSON.stringify(followersPayload), "followers");
  assert.ok(page, "page should parse");
  assert.equal(page!.total, 4957);
  assert.equal(page!.rows.length, 2);
  assert.deepEqual(page!.rows[0], { username: "user_a", fullName: "User A", avatar: "https://pic/a.jpg", pk: "123" });
  assert.equal(page!.hasNext, true);
  assert.equal(page!.endCursor, "QVFD");
});

test("parses following page via edge_follow", () => {
  const page = parseIgGraphqlFollowersPage(JSON.stringify(followingPayload), "following");
  assert.ok(page, "page should parse");
  assert.equal(page!.total, 300);
  assert.equal(page!.rows[0].username, "user_c");
  assert.equal(page!.hasNext, false);
  assert.equal(page!.endCursor, null);
});

test("tolerates malformed JSON and unexpected shapes", () => {
  const p1 = parseIgGraphqlFollowersPage("not json", "followers");
  assert.equal(p1, null);
  const p2 = parseIgGraphqlFollowersPage(JSON.stringify({ data: null }), "followers");
  assert.equal(p2, null);
});

test("extractXdtGqlCursor reads end_cursor from xdt sections", () => {
  const body = { data: { xdt_shortcode_media: { edge_liked_by: { page_info: { has_next_page: true, end_cursor: "CUR1" } } } } };
  assert.equal(extractXdtGqlCursor(body, "edge_liked_by"), "CUR1");
  assert.equal(extractXdtGqlCursor(body, "edge_missing"), null);
});

test("igGraphqlUsersFromEdge maps comment edges to users", () => {
  const body = {
    data: {
      xdt_shortcode_media: {
        edge_media_to_parent_comment: {
          edges: [
            { node: { id: "c1", created_at: 1, text: "hi", owner: { id: "u1", username: "alice", full_name: "A" } } },
          ],
        },
      },
    },
  };
  const users = igGraphqlUsersFromEdge(body, "edge_media_to_parent_comment");
  assert.equal(users.length, 1);
  assert.equal(users[0].username, "alice");
});
