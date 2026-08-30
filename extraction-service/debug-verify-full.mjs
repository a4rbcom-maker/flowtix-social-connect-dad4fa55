import { readFileSync } from "node:fs";
const jobId = process.argv[2];
const env = Object.fromEntries(
  readFileSync(new URL("./.env", import.meta.url), "utf8")
    .split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const sb = env.SUPABASE_URL.replace(/\/$/, "");
const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
let offset = 0; const ids = [];
while (true) {
  const r = await fetch(`${sb}/rest/v1/extraction_results?select=fb_id&job_id=eq.${jobId}&offset=${offset}&limit=1000`, { headers });
  const rows = await r.json();
  if (!Array.isArray(rows) || rows.length === 0) break;
  for (const row of rows) ids.push(row.fb_id);
  if (rows.length < 1000) break;
  offset += 1000;
}
console.log(JSON.stringify({ total_rows: ids.length, unique_fb_ids: new Set(ids).size, duplicate_rows: ids.length - new Set(ids).size, sample: ids.slice(0, 3) }));
