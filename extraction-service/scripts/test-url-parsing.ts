import { parseGroupId, parsePageId, parsePostId } from "../src/extractors/base.js";

interface Case {
  url: string;
  expect: string | null;
}

const groupCases: Case[] = [
  { url: "https://www.facebook.com/groups/1250771769518384/", expect: "1250771769518384" },
  { url: "https://www.facebook.com/groups/1250771769518384/members", expect: "1250771769518384" },
  { url: "https://m.facebook.com/groups/1250771769518384/members/?ref=x", expect: "1250771769518384" },
  { url: "https://web.facebook.com/groups/my.arabic.group/about", expect: "my.arabic.group" },
  { url: "https://www.facebook.com/groups/%D9%85%D8%B5%D8%B1/posts/123", expect: "مصر" },
  { url: "1250771769518384", expect: "1250771769518384" },
  { url: "https://www.facebook.com/groups/feed/", expect: null },
  { url: "https://www.facebook.com/groups/discover/", expect: null },
  { url: "https://www.facebook.com/profile.php?id=100064626911537", expect: null },
  { url: "https://www.facebook.com/some.page", expect: null },
  { url: "", expect: null },
];

const pageCases: Case[] = [
  { url: "https://www.facebook.com/manfaz.alnasr", expect: "manfaz.alnasr" },
  { url: "https://www.facebook.com/profile.php?id=100064626911537", expect: "100064626911537" },
  { url: "https://m.facebook.com/profile.php?id=100064626911537?fref=x", expect: "100064626911537" },
  { url: "https://www.facebook.com/pages/SomePage/123456789012345", expect: "123456789012345" },
  { url: "https://www.facebook.com/groups/1250771769518384/", expect: null },
  { url: "https://www.facebook.com/groups/1250771769518384/members", expect: null },
  { url: "https://www.facebook.com/watch", expect: null },
  { url: "https://www.facebook.com/marketplace", expect: null },
  { url: "123456789012345", expect: "123456789012345" },
  { url: "", expect: null },
];

const postCases: Case[] = [
  { url: "https://www.facebook.com/pageName/posts/pfbid0AbCdEf123", expect: "pfbid0AbCdEf123" },
  { url: "https://www.facebook.com/pageName/posts/123456789", expect: "123456789" },
  { url: "https://www.facebook.com/groups/1250771769518384/posts/987654321/", expect: "987654321" },
  { url: "https://www.facebook.com/permalink.php?story_fbid=123456&id=789", expect: "123456" },
  { url: "https://www.facebook.com/share/p/AbCdEf123/", expect: "AbCdEf123" },
  { url: "https://www.facebook.com/reel/123456789012345", expect: "123456789012345" },
  { url: "https://fb.watch/xYz123AbC/", expect: "xYz123AbC" },
];

function run(name: string, fn: (url: string) => string | null, cases: Case[]): boolean {
  let pass = 0;
  for (const c of cases) {
    const actual = fn(c.url);
    const ok = actual === c.expect;
    if (ok) pass++;
    else console.log(`  FAIL — [${c.url}] expected [${c.expect}] got [${actual}]`);
  }
  console.log(`${pass === cases.length ? "PASS" : "FAIL"} — ${name}: ${pass}/${cases.length}`);
  return pass === cases.length;
}

console.log("\n=== parseGroupId (realistic corpus) ===");
const g = run("group URLs", parseGroupId, groupCases);
console.log("\n=== parsePageId (realistic corpus) ===");
const p = run("page URLs", parsePageId, pageCases);
console.log("\n=== parsePostId (realistic corpus) ===");
const po = run("post URLs", parsePostId, postCases);

console.log("\n================ VERDICT ================");
const all = g && p && po;
console.log(all ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED");
process.exit(all ? 0 : 1);
