import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const API = process.env.PROD_API_URL || "https://api.flowtixtools.com";
const KEY = process.env.API_KEY || "flowtix-extraction-2026";

async function main() {
  const { data: sessions, error } = await sb
    .from("fb_sessions")
    .select("id, name, status")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error || !sessions) {
    console.error("sessions query failed:", error?.message);
    process.exit(1);
  }

  console.log(`checking ${sessions.length} sessions against ${API} ...\n`);
  let dead = 0;

  for (const s of sessions) {
    try {
      const res = await fetch(`${API}/session-check`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": KEY },
        body: JSON.stringify({ session_id: s.id }),
        signal: AbortSignal.timeout(90000),
      });
      const body = (await res.json()) as { status?: string; message?: string; auth_state?: string; error?: { message?: string } };
      const ok = body.status === "connected";
      if (!ok) dead++;
      console.log(`${ok ? "ALIVE " : "DEAD  "} ${s.name} (${s.id.slice(0, 8)}) → status=${body.status ?? "?"} auth=${body.auth_state ?? "?"}`);
      if (!ok) console.log(`       reason: ${body.message || body.error?.message || "?"}`);
    } catch (err) {
      dead++;
      console.log(`ERROR  ${s.name} (${s.id.slice(0, 8)}): ${String(err).substring(0, 120)}`);
    }
  }

  console.log(`\nsummary: ${sessions.length - dead}/${sessions.length} alive, ${dead} dead`);
  process.exit(0);
}

main();
