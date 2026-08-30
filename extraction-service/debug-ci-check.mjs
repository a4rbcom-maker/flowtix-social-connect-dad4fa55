// TEMP: single-shot CI status check for the pushed commit. Token in-process only.
import { execFileSync } from "node:child_process";
const SHA = "6e95d03";
const repo = "a4rbcom-maker/flowtix-social-connect-dad4fa55";
let token = "";
try {
  const out = execFileSync("git", ["credential", "fill"], { input: "protocol=https\nhost=github.com\n\n", encoding: "utf8" });
  token = (out.match(/password=(.+)/) || [])[1]?.trim() || "";
} catch { /* unauth fallback */ }
const headers = token ? { authorization: `Bearer ${token}`, "user-agent": "flowtix-ci-check" } : { "user-agent": "flowtix-ci-check" };
const r = await fetch(`https://api.github.com/repos/${repo}/actions/runs?head_sha=${SHA}&per_page=5`, { headers });
if (!r.ok) { console.log("API status", r.status, "— token", token ? "present" : "absent"); process.exit(0); }
const j = await r.json();
const runs = j.workflow_runs || [];
if (runs.length === 0) { console.log("NO_RUNS_YET for", SHA.slice(0, 7)); process.exit(0); }
for (const run of runs) {
  console.log(`${run.name} | ${run.status} | conclusion=${run.conclusion} | sha=${run.head_sha.slice(0, 7)}`);
}
