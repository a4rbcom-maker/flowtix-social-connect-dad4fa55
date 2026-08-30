import { createClient } from "@supabase/supabase-js";
import fs from "fs";
const env = fs.readFileSync(".env", "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim() : null; };
const sb = createClient(get("SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"));
const JOB = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
for (let i = 0; i < 40; i++) {
  const { data } = await sb.from("extraction_jobs").select("status,result_count,progress,config,started_at,completed_at").eq("id", JOB).single();
  if (!data) { console.log("no job"); break; }
  const p = data.progress || {};
  const now = Date.now();
  if (JSON.stringify(p) !== last || i % 2 === 0) {
    const dur = data.started_at ? Math.round((Date.now() - new Date(data.started_at).getTime()) / 1000) : 0;
    console.log(`t=${i * 30}s status=${data.status} rc=${data.result_count} disc=${p.discovered} phase=${p.phase} cov=${p.coverage_rate} stop=${p.stop_reason ?? "-"} total=${data.config?.total_followers_count ?? "?"} dur=${dur}s`);
    last = JSON.stringify(p);
  }
  if (data.status === "completed" || data.status === "failed" || data.status === "paused") break;
  await sleep(30000);
}
