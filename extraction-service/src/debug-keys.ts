import * as fs from "fs";
const raw = fs.readFileSync("C:\\Users\\COMPUC~1\\AppData\\Local\\Temp\\opencode\\gql_full.json", "utf-8");
const patterns = ["creation", "message", "reaction", "feedback", "comment", "text", "count", "node", "edge", "actor", "author"];
for (const p of patterns) {
  const re = new RegExp(`"(${p}[a-z_]*)"`, "gi");
  const matches = new Set<string>();
  let m;
  while ((m = re.exec(raw)) !== null) matches.add(m[1]);
  if (matches.size > 0) console.log(`${p}: ${Array.from(matches).join(", ")}`);
}
