import { execFileSync } from "node:child_process";
let token = "";
try {
  const out = execFileSync("git", ["credential", "fill"], { input: "protocol=https\nhost=github.com\n\n", encoding: "utf8" });
  token = (out.match(/password=(.+)/) || [])[1]?.trim() || "";
} catch {}
const headers = token ? { authorization: `Bearer ${token}`, "user-agent": "flowtix-ci-check" } : { "user-agent": "flowtix-ci-check" };
const r = await fetch("https://api.github.com/repos/a4rbcom-maker/flowtix-social-connect-dad4fa55/actions/runs?per_page=5", { headers });
const j = await r.json();
if (!r.ok) { console.log("API", r.status, j.message || ""); process.exit(0); }
console.log("total_count:", j.total_count, "| token:", token ? "present" : "absent");
for (const run of j.workflow_runs || []) {
  console.log(`${run.head_sha.slice(0,7)} | ${run.name} | ${run.status} | ${run.conclusion} | ${run.created_at}`);
}
