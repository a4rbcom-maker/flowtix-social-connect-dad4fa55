import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanMemberName, parseGroupUsersFromGraphQL } from "../group-members-core.js";

test("cleanMemberName keeps real names", () => {
  assert.equal(cleanMemberName("Ahmed Mohamed"), "Ahmed Mohamed");
  assert.equal(cleanMemberName("محمود عبد الرحمن"), "محمود عبد الرحمن");
  assert.equal(cleanMemberName("  \n  Sarah Ali \n "), "Sarah Ali");
});

test("cleanMemberName takes the FIRST line of multi-line anchor text", () => {
  // The member card anchor wraps name + subtitle: this is the real-world shape
  assert.equal(cleanMemberName("Ahmed Mohamed\nJoined on Friday"), "Ahmed Mohamed");
  assert.equal(cleanMemberName("فاطمة السيد\nانضم في مايو"), "فاطمة السيد");
});

test("cleanMemberName rejects junk subtitles outright", () => {
  assert.equal(cleanMemberName("Joined on Friday"), null);
  assert.equal(cleanMemberName("Joined May 2023"), null);
  assert.equal(cleanMemberName("انضم في مايو"), null);
  assert.equal(cleanMemberName("Admin"), null);
  assert.equal(cleanMemberName("مشرف الجروب"), null);
  assert.equal(cleanMemberName("New member"), null);
  assert.equal(cleanMemberName("Facebook User"), null);
});

test("cleanMemberName rejects garbage values", () => {
  assert.equal(cleanMemberName(""), null);
  assert.equal(cleanMemberName("5"), null);
  assert.equal(cleanMemberName("12345"), null);
  assert.equal(cleanMemberName("  \n  "), null);
});

test("parseGroupUsersFromGraphQL no longer stores join-date subtitles as names", () => {
  // Shape seen in job d799b4ed: search-shard GraphQL rows where title.text
  // held the join subtitle instead of the member's name.
  const payload = JSON.stringify({
    data: {
      node: {
        search_results: [
          {
            id: "61591918544704",
            title: { text: "Joined on Friday" },
            url: "https://www.facebook.com/profile.php?id=61591918544704",
          },
        ],
      },
    },
  });
  const users = parseGroupUsersFromGraphQL(payload);
  // The junk name must be dropped (user skipped) instead of stored
  for (const u of users) {
    assert.ok(!/^joined/i.test(u.name), `junk name leaked: ${u.name}`);
  }
});

test("parseGroupUsersFromGraphQL still parses real names from GraphQL", () => {
  const payload = JSON.stringify({
    data: {
      node: {
        search_results: [
          { id: "100079568511111", name: "Ahmed Mohamed" },
        ],
      },
    },
  });
  const users = parseGroupUsersFromGraphQL(payload);
  assert.equal(users.length, 1);
  assert.equal(users[0].name, "Ahmed Mohamed");
  assert.equal(users[0].fb_id, "100079568511111");
});
