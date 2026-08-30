import { test } from "node:test";
import assert from "node:assert/strict";
import { paginateGraphQL, type PageData, type ExtractedMember, type PaginateCallbacks } from "../graphql-pagination.js";

function member(id: string, name = `User ${id}`): ExtractedMember {
  return { fb_id: id, name, profile_url: `https://www.facebook.com/${id}`, type: "reacter" };
}

/** Build a fetchPage that yields `pages` synthetic pages of `perPage` users each. */
function makeFetch(totalPages: number, perPage: number, opts: { stallAt?: number } = {}) {
  let n = 0;
  return async (cursor: string | null): Promise<PageData> => {
    const pageNo = cursor === null ? 0 : Number(cursor);
    const isLast = pageNo + 1 >= totalPages;
    const users: ExtractedMember[] = [];
    for (let i = 0; i < perPage; i++) {
      const id = `${pageNo * perPage + i}`;
      users.push(member(id));
    }
    n++;
    return { users, cursor: isLast ? null : String(pageNo + 1), hasNext: !isLast };
  };
}

function storeCollecting(seenStore = new Set<string>()): PaginateCallbacks["store"] {
  return async (users) => {
    let added = 0;
    for (const u of users) {
      if (!seenStore.has(u.fb_id)) { seenStore.add(u.fb_id); added++; }
    }
    return added;
  };
}

test("paginates to exhaustion when has_next_page=false", async () => {
  const fetchPage = makeFetch(4, 10);
  const r = await paginateGraphQL(
    { maxResults: 100000, paceMs: 0 },
    { fetchPage, store: storeCollecting() },
  );
  assert.equal(r.extracted, 40);
  assert.equal(r.pages, 4);
  assert.equal(r.hasNext, false);
  assert.equal(r.exhausted, true);
  assert.equal(r.stopReason, "has_next_page_false");
  assert.equal(r.lastCursor, null);
});

test("stops at maxResults and reports not-exhausted", async () => {
  const fetchPage = makeFetch(50, 100);
  const r = await paginateGraphQL(
    { maxResults: 250, paceMs: 0 },
    { fetchPage, store: storeCollecting() },
  );
  assert.equal(r.extracted, 250, "should not overshoot the page cap");
  assert.equal(r.stopReason, "max_results_reached");
  assert.equal(r.hasNext, true);
  assert.equal(r.exhausted, false);
  assert.ok(r.lastCursor !== null, "must carry a resume cursor");
});

test("aborts via shouldAbort and returns canceled with last cursor", async () => {
  let count = 0;
  const fetchPage = makeFetch(50, 100);
  const r = await paginateGraphQL(
    { maxResults: 100000, paceMs: 0 },
    {
      fetchPage,
      store: storeCollecting(),
      // Checked at the top of each iteration, so it fires before the 3rd fetch.
      shouldAbort: () => {
        count++;
        return count >= 3;
      },
    },
  );
  assert.equal(r.stopReason, "canceled");
  assert.equal(r.extracted, 200, "two pages completed before abort");
  assert.equal(r.pages, 2);
  assert.ok(r.lastCursor !== null);
});

test("gives up after consecutive empty pages (never loops forever)", async () => {
  // Page 0 returns 1 user; every later page returns 0 users but the cursor
  // ADVANCES (so cursor-stall detection doesn't mask the empty-pages path).
  const fetchPage = async (cursor: string | null): Promise<PageData> => {
    const pageNo = cursor === null ? 0 : Number(cursor);
    if (pageNo === 0) return { users: [member("1")], cursor: "1", hasNext: true };
    return { users: [], cursor: String(pageNo + 1), hasNext: true };
  };
  const r = await paginateGraphQL(
    { maxResults: 100000, paceMs: 0, maxEmptyPages: 4 },
    { fetchPage, store: storeCollecting() },
  );
  assert.equal(r.extracted, 1);
  assert.equal(r.stopReason, "empty_pages_exhausted");
  assert.equal(r.emptyPages, 4);
});

test("resumes from a seed cursor without refetching page 0", async () => {
  const seen = new Set<string>();
  const fetchPage = async (cursor: string | null): Promise<PageData> => {
    const pageNo = cursor === null ? 0 : Number(cursor);
    const isLast = pageNo + 1 >= 3;
    const users = [member(`p${pageNo}-0`), member(`p${pageNo}-1`)];
    return { users, cursor: isLast ? null : String(pageNo + 1), hasNext: !isLast };
  };
  const r = await paginateGraphQL(
    { maxResults: 100000, paceMs: 0, seedCursor: "1" },
    { fetchPage, store: storeCollecting(seen) },
  );
  // seed cursor=1 => pages 1 and 2 only (page 0 skipped client-side)
  assert.equal(r.extracted, 4);
  assert.equal(r.pages, 2);
  assert.equal(r.stopReason, "has_next_page_false");
});

test("dedups duplicate users across pages via in-memory seen", async () => {
  const fetchPage = async (cursor: string | null): Promise<PageData> => {
    const pageNo = cursor === null ? 0 : Number(cursor);
    const isLast = pageNo >= 1;
    // both pages return the same single user id
    return { users: [member("dup")], cursor: isLast ? null : "1", hasNext: !isLast };
  };
  let stored = 0;
  const store = async (users: ExtractedMember[]) => { stored += users.length; return users.length; };
  const r = await paginateGraphQL({ maxResults: 100000, paceMs: 0 }, { fetchPage, store });
  assert.equal(r.extracted, 1, "dedup keeps only the first occurrence");
  assert.equal(stored, 1);
});
