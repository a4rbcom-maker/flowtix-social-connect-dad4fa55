import { readFileSync } from "node:fs";
const jobId = process.argv[2];
const env = Object.fromEntries(
  readFileSync(new URL("./.env", import.meta.url), "utf8")
    .split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const sb = env.SUPABASE_URL.replace(/\/$/, "");
const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
const deadline = Date.now() + 6 * 60 * 1000;
while (Date.now() < deadline) {
  const r = await fetch(`${sb}/rest/v1/extraction_jobs?select=id,status,result_count,progress,error&id=eq.${jobId}`, { headers });
  const j = (r.ok ? await r.json() : [])[0];
  if (!j) { console.log("JOB NOT FOUND"); break; }
  const p = j.progress || {};
  console.log(new Date().toISOString().slice(11, 19), j.status, "result_count=" + j.result_count, "extracted=" + p.extracted, "total=" + p.total, "coverage=" + p.coverage_rate);
  if (j.status !== "running" && j.status !== "queued") { console.log("FINAL:", JSON.stringify({ status: j.status, result_count: j.result_count, total: p.total, coverage: p.coverage_rate, error: j.error })); break; }
  await new Promise((res) => setTimeout(res, 30000));
}
