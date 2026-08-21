import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function main() {
  const { data: jobs } = await sb
    .from("extraction_jobs")
    .select("id, type, status, source, error, result_count, created_at")
    .order("created_at", { ascending: false })
    .limit(4);

  for (const j of jobs || []) {
    console.log(`${j.created_at} | ${j.type} | ${j.status} | results=${j.result_count}`);
    console.log(`  source: [${j.source}]`);
    console.log(`  error:  ${j.error ? j.error.substring(0, 200) : "-"}`);
  }
  process.exit(0);
}

main();
