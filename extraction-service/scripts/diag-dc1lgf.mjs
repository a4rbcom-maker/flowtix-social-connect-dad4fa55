import { createClient } from "@supabase/supabase-js";
import fs from "fs";
const env = fs.readFileSync(".env", "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim() : null; };
const sb = createClient(get("SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"));

const { data: jobs } = await sb.from("extraction_jobs")
  .select("id,type,status,result_count,progress,error,config,created_at,started_at,completed_at")
  .in("type", ["ig_post_commenters", "ig_post_engagers"])
  .order("created_at", { ascending: false }).limit(15);

console.log("RECENT IG POST JOBS:");
for (const j of jobs || []) {
  const dur = j.started_at && j.completed_at ? Math.round((new Date(j.completed_at) - new Date(j.started_at)) / 1000) : null;
  console.log(`\n--- ${j.id} | ${j.type} | ${j.status} | rc=${j.result_count} | dur=${dur}s | ${j.created_at}`);
  console.log(`  sourceUrl: ${j.config?.sourceUrl ?? "?"}`);
  console.log(`  progress: ${JSON.stringify(j.progress)?.slice(0, 600)}`);
  if (j.error) console.log(`  error: ${String(j.error).slice(0, 200)}`);
}
