// Regression test for the `fb_campaigns_validate_account_source` DB trigger.
//
// The heavy lifting lives inside the SECURITY DEFINER function
// `regression.assert_fb_campaigns_account_source_trigger_ok()` (created in
// migration 2026-07-17). It:
//   1. INSERTs a bot_worker campaign with NULL account_id → must be rejected.
//   2. INSERTs a graph_api campaign with NULL graph_connection_id → must be rejected.
//   3. INSERTs a valid bot_worker campaign, then does a status-only UPDATE,
//      then NULLs account_id (simulating the FK ON DELETE SET NULL cascade),
//      then UPDATES status/counters on the orphaned row → all must succeed.
//   4. Attempts to switch posting_mode on the orphan without the matching
//      source column → must be rejected.
//   5. Same round-trip for a graph_api campaign.
// Fixture rows are rolled back through a sentinel-exception sub-transaction,
// so nothing persists.
//
// We invoke the function through `psql` because the `regression` schema is
// intentionally NOT exposed via PostgREST/RPC. The test is auto-skipped when
// the sandbox lacks the credentials needed to reach the schema (typical CI /
// local dev runs). It executes fully in the deploy pipeline where the DB URL
// has service-role privileges.

import { execFileSync } from "node:child_process";
import { describe, it, expect } from "vitest";

function tryPsql(sql: string): { ok: true; stdout: string } | { ok: false; reason: string } {
  if (!process.env.PGHOST && !process.env.SUPABASE_DB_URL) {
    return { ok: false, reason: "no DB env" };
  }
  const args = process.env.SUPABASE_DB_URL
    ? [process.env.SUPABASE_DB_URL, "-tAc", sql]
    : ["-tAc", sql];
  try {
    const out = execFileSync("psql", args, {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
    return { ok: true, stdout: out.trim() };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: msg };
  }
}

// Probe: does this environment have access to the regression schema?
const probe = tryPsql("SELECT has_schema_privilege(current_user, 'regression', 'USAGE')");
const hasAccess = probe.ok && probe.stdout === "t";

describe.skipIf(!hasAccess)("fb_campaigns_validate_account_source trigger", () => {
  it("passes the regression.assert_...() suite (insert reject, orphan update allow, mode-switch reject)", () => {
    const res = tryPsql(
      "SELECT regression.assert_fb_campaigns_account_source_trigger_ok()",
    );
    if (!res.ok) throw new Error(`psql invocation failed: ${res.reason}`);
    // Function returns 'ok' on success or 'skip: no profile fixture' when the
    // DB has no seed data yet. Any other value (or a raised exception) is a
    // regression.
    expect(res.stdout === "ok" || res.stdout.startsWith("skip:")).toBe(true);
  });
});
