// TEMP: poll GitHub Actions for the pushed commit. Token read in-process from git credential store, never printed.
import { execFileSync } from "node:child_process";
const SHA = "6b24fc7";
const repo = "a4rbcom-maker/flowtix-social-connect-dad4fa55";
let token = "";
try {
  const out = execFileSync("git", ["credential", "fill"], { input: "protocol=https\nhost=github.com\n\n", encoding: "utf8" });
  token = (out.match(/password=(.+)/) || [])[1]?.trim() || "";
} catch { /* unauth fallback */ }
const headers = token ? { authorization: `Bearer ${token}`, "user-agent": "flowtix-ci-watch" } : { "user-agent": "flowtix-ci-watch" };
const deadline = Date.now() + 8 * 60 * 1000;
let announced = "";
while (Date.now() < deadline) {
  const r = await fetch(`https://api.github.com/repos/${repo}/actions/runs?head_sha=${SHA}&per_page=5`, { headers });
  if (!r.ok) { console.log("API status", r.status, "— token", token ? "present" : "absent"); break; }
  const j = await r.json();
  const runs = j.workflow_runs || [];
  if (runs.length === 0) { console.log(new Date().toISOString().slice(11, 19), "no runs yet for", SHA.slice(0, 7)); }
  for (const run of runs) {
    const line = `${new Date().toISOString().slice(11, 19)} ${run.name} | ${run.status} | conclusion=${run.conclusion} | sha=${run.head_sha.slice(0, 7)}`;
    if (run.status === "completed") { announced = line; console.log(line); }
    else console.log(line);
  }
  if (runs.length > 0 && runs.every((x) => x.status === "completed")) break;
  await new Promise((res) => setTimeout(res, 20000));
}
console.log(announced ? `DONE: ${announced}` : "TIMEOUT_OR_UNCONFIRMED");
