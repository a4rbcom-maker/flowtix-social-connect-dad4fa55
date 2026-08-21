import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function main() {
  const { data: jobs, error } = await sb
    .from("extraction_jobs")
    .select("id, name, type, status, result_count, error, progress, started_at, completed_at, updated_at, created_at, config")
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    console.error("jobs query failed:", error.message);
    process.exit(1);
  }

  for (const j of jobs) {
    console.log("=".repeat(70));
    console.log(`job ${j.id}`);
    console.log(`  name: ${j.name} | type: ${j.type} | status: ${j.status}`);
    console.log(`  result_count: ${j.result_count}`);
    console.log(`  created: ${j.created_at} | started: ${j.started_at} | completed: ${j.completed_at} | updated: ${j.updated_at}`);
    if (j.error) console.log(`  ERROR: ${j.error.substring(0, 300)}`);
    const cfg = j.config || {};
    console.log(`  config: sessions=${(cfg.session_ids || []).length}, max_results=${cfg.max_results}, skip_dup=${cfg.skip_duplicates}, total_members=${cfg.total_followers_count ?? "?"}`);
    console.log(`  progress: ${JSON.stringify(j.progress).substring(0, 600)}`);
  }

  const { data: sessions } = await sb
    .from("fb_sessions")
    .select("id, name, status, updated_at")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(10);
  console.log("=".repeat(70));
  console.log("FB sessions:");
  for (const s of sessions || []) {
    console.log(`  ${s.name} (${s.id.slice(0, 8)}): ${s.status} @ ${s.updated_at}`);
  }

  process.exit(0);
}

main();
