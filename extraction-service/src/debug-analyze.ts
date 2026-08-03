import * as fs from "fs";

const raw = fs.readFileSync("C:\\Users\\COMPUC~1\\AppData\\Local\\Temp\\opencode\\gql_full.json", "utf-8");

// Find all "id" fields with numeric values (potential user/post IDs)
const idPattern = /"id"\s*:\s*"?(\d{8,})"?/g;
const ids = new Set<string>();
let m;
while ((m = idPattern.exec(raw)) !== null) {
  ids.add(m[1]);
}
console.log(`Unique IDs found: ${ids.size}`);
console.log(`Sample IDs: ${Array.from(ids).slice(0, 10).join(", ")}`);

// Find "name" fields
const namePattern = /"name"\s*:\s*"([^"]{2,50})"/g;
const names = new Set<string>();
while ((m = namePattern.exec(raw)) !== null) {
  names.add(m[1]);
}
console.log(`Unique names found: ${names.size}`);
console.log(`Sample names: ${Array.from(names).slice(0, 10).join(", ")}`);

// Find "creation_time" fields
const ctPattern = /"creation_time"\s*:\s*(\d+)/g;
const cts: string[] = [];
while ((m = ctPattern.exec(raw)) !== null) {
  cts.push(m[1]);
}
console.log(`creation_time entries: ${cts.length}`);
if (cts.length > 0) console.log(`Sample: ${cts.slice(0, 3).map(t => new Date(Number(t) * 1000).toISOString()).join(", ")}`);

// Find "message" fields
const msgPattern = /"message"\s*:\s*\{[^}]*"text"\s*:\s*"([^"]{2,80})"/g;
const msgs: string[] = [];
while ((m = msgPattern.exec(raw)) !== null) {
  msgs.push(m[1]);
}
console.log(`Message entries: ${msgs.length}`);
if (msgs.length > 0) console.log(`Sample: ${msgs.slice(0, 3).join(" | ")}`);

// Find reaction_count
const rcPattern = /"reaction_count"\s*:\s*\{[^}]*"count"\s*:\s*(\d+)/g;
const rcs: string[] = [];
while ((m = rcPattern.exec(raw)) !== null) {
  rcs.push(m[1]);
}
console.log(`reaction_count entries: ${rcs.length}`);
if (rcs.length > 0) console.log(`Sample counts: ${rcs.slice(0, 5).join(", ")}`);

// Find comment_count
const ccPattern = /"comment_count"\s*:\s*\{[^}]*"count"\s*:\s*(\d+)/g;
const ccs: string[] = [];
while ((m = ccPattern.exec(raw)) !== null) {
  ccs.push(m[1]);
}
console.log(`comment_count entries: ${ccs.length}`);
if (ccs.length > 0) console.log(`Sample counts: ${ccs.slice(0, 5).join(", ")}`);
