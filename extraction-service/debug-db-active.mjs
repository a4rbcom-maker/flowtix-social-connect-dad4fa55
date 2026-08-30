import { readFileSync } from "node:fs";
const env = Object.fromEntries(
  readFileSync(new URL("./.env", import.meta.url), "utf8")
    .split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
);
const sb = env.SUPABASE_URL.replace(/\/$/, "");
const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
const r = await fetch(`${sb}/rest/v1/extraction_jobs?select=id,type,status,created_at&status=in.(queued,running)&order=created_at.desc&limit=10`, { headers });
console.log(JSON.stringify(r.ok ? await r.json() : { error: r.status }, null, 1));
