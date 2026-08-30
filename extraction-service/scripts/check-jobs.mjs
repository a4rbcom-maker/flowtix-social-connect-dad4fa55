import { createClient } from "@supabase/supabase-js";
import fs from "fs";
const env = fs.readFileSync(".env", "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim() : null; };
const sb = createClient(get("SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"));
const probe = "57e360ed-4965-463a-82a5-dd31ba972418";
const { data: p } = await sb.from("extraction_jobs").select("id,type,status,result_count,progress,config,started_at,completed_at").eq("id", probe).single();
console.log("PROBE JOB:", JSON.stringify({id:p?.id, type:p?.type, status:p?.status, rc:p?.result_count, progress:p?.progress, total:p?.config?.total_followers_count}, null, 1));
const { data: recent } = await sb.from("extraction_jobs").select("id,type,status,result_count,config,started_at,completed_at,created_at")
  .in("type", ["post_reactions","post_comments"]).order("created_at", {ascending:false}).limit(12);
console.log("\nRECENT FB POST JOBS:");
for (const j of recent) {
  const dur = j.started_at && j.completed_at ? Math.round((new Date(j.completed_at)-new Date(j.started_at))/1000) : null;
  console.log(`${j.id.slice(0,8)} | ${j.type.padEnd(15)} | ${j.status.padEnd(11)} | rc=${String(j.result_count).padEnd(4)} | total=${String(j.config?.total_followers_count ?? "?").padEnd(6)} | dur=${dur}s | ${j.created_at}`);
}