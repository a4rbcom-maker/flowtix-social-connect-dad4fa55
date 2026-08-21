import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const JOB_ID = process.argv[2] || "69760b3d-f406-4a79-bee6-5be42f6565ff";

async function main() {
  const { data: job } = await sb
    .from("extraction_jobs")
    .select("id, status, result_count, progress, completed_at")
    .eq("id", JOB_ID)
    .single();

  console.log("job:", job?.id, "| status:", job?.status, "| results:", job?.result_count);
  console.log("progress:", JSON.stringify(job?.progress, null, 2));

  const { count: total } = await sb
    .from("extraction_results")
    .select("id", { count: "exact", head: true })
    .eq("job_id", JOB_ID);

  const { count: enriched } = await sb
    .from("extraction_results")
    .select("id", { count: "exact", head: true })
    .eq("job_id", JOB_ID)
    .not("metadata->enrichment", "eq", "null");

  console.log(`\nresults: ${total ?? 0} | with metadata.enrichment: ${enriched ?? 0}`);

  const { data: sample } = await sb
    .from("extraction_results")
    .select("fb_id, metadata")
    .eq("job_id", JOB_ID)
    .limit(2);
  for (const r of sample || []) {
    console.log("sample metadata:", JSON.stringify(r.metadata));
  }

  process.exit(0);
}

main();
