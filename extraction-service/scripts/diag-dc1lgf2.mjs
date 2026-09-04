import { createClient } from "@supabase/supabase-js";
import fs from "fs";
const env = fs.readFileSync(".env", "utf8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); return m ? m[1].trim() : null; };
const sb = createClient(get("SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"));

const JOB = "4912ca35-608d-4c6c-aa87-aa01eb03eb08";
const { data: job } = await sb.from("extraction_jobs").select("id,user_id,session_id,status,result_count").eq("id", JOB).maybeSingle();
console.log("JOB:", job?.id, "user:", job?.user_id, "session:", job?.session_id);

const { data: res, count } = await sb.from("extraction_results")
  .select("username,full_name,data,created_at").eq("job_id", JOB).order("created_at");
console.log("rows for job:", count ?? res?.length);
for (const r of res || []) console.log(`  ${r.username} | fn=${r.full_name} | ct=${r.data?.comment_text?.slice(0, 40) ?? "-"}`);

// how many comments does this post's user have in IG history overall (dedup check)
const { count: totalIg } = await sb.from("extraction_results")
  .select("username", { count: "exact", head: true }).eq("user_id", job.user_id).eq("platform", "instagram");
console.log("\nuser's total IG extraction_results rows (all history):", totalIg);
