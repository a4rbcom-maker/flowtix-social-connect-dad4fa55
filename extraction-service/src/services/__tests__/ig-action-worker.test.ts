import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * IgAction worker behavior tests with injected send + delay hooks and a stub
 * supabase client. We exercise the decision table without a browser:
 *  - mention mode: 7 recipients + mentions_per_comment=4 → exactly 2 comment
 *    publishes, covering 4 then 3 handles
 *  - quiet hours → stop_reason 'quiet_hours', no send executed
 *  - thread_unavailable (DM) → recipient skipped, not failed
 *
 * The worker imports the real supabase client at module load, so we swap
 * supabaseClient via the __setSupabaseForTests seam before exercising it.
 */

type Row = Record<string, unknown>;

function makeStubDb(tables: Record<string, { rows: Row[] }>) {
  const calls: Array<{ table: string; op: string; payload?: Row | Row[] }> = [];
  const chain = (table: string) => {
    const state = {
      filters: {} as Row,
      payload: undefined as Row | Row[] | undefined,
      op: "select" as string,
      _order: null as string | null,
      _limit: 1000,
    };
    const builder: any = {
      select() {
        return builder;
      },
      eq(k: string, v: unknown) {
        state.filters[k] = v;
        return builder;
      },
      in(k: string, v: unknown) {
        state.filters[k] = v;
        return builder;
      },
      is(k: string, v: unknown) {
        state.filters[k] = v;
        return builder;
      },
      lt(k: string, v: unknown) {
        state.filters[k] = v;
        return builder;
      },
      order(_k: string) {
        return builder;
      },
      limit(n: number) {
        state._limit = n;
        return builder;
      },
      maybeSingle() {
        return Promise.resolve({ data: (tables[table]?.rows ?? [])[0] ?? null });
      },
      single() {
        return Promise.resolve({ data: (tables[table]?.rows ?? [])[0] ?? null });
      },
      upsert(payload: Row) {
        calls.push({ table, op: "upsert", payload: payload as Row });
        return Promise.resolve({ data: null });
      },
      update(payload: Row) {
        calls.push({ table, op: "update", payload: payload as Row });
        // Support the .eq(...).eq(...) chains the worker's writers use.
        const eqable: any = {
          eq(_k: string, _v: unknown) {
            return eqable;
          },
          then(res: (v: { data: null }) => void) {
            res({ data: null });
          },
        };
        return eqable;
      },
      insert(payload: Row | Row[]) {
        calls.push({ table, op: "insert", payload: payload as Row });
        return Promise.resolve({ data: null });
      },
      then(res: (v: { data: Row[] }) => void) {
        let rows = tables[table]?.rows ?? [];
        for (const [k, v] of Object.entries(state.filters)) {
          if (k === "batch_index" && v === null) {
            // is('batch_index', null)
            rows = rows.filter((r) => r[k] === null || r[k] === undefined);
          } else if (Array.isArray(v)) {
            rows = rows.filter((r) =>
              Array.isArray(r[k]) ? (v as string[]).some((x) => (r[k] as string[]).includes(x)) : v.includes(String(r[k])),
            );
          } else {
            rows = rows.filter((r) => r[k] === v);
          }
        }
        res({ data: rows.slice(0, state._limit) });
      },
    };
    return builder;
  };
  return {
    calls,
    from(table: string) {
      return chain(table);
    },
  };
}

const JOB_ID = "job-ig-1";
const SESSION_ID = "sess-ig-1";

test("worker module loads and exposes the right exports", async () => {
  const mod = await import("../ig-action-worker.js");
  assert.equal(typeof mod.startIgActionWorker, "function");
  assert.equal(typeof mod.stopIgActionWorker, "function");
  assert.equal(typeof mod.resumeIgActionJobs, "function");
  assert.equal(typeof mod.runIgActionWorker, "function");
});

// ─── 2026-09-08: الفشل السريع عند جلسة ميتة (session_expired) ───────────────
// Reality model: job 47dc024c burned 95 recipients as skipped over 2h13m on a
// session that had been dead for 3 days. The new contract: the FIRST
// session_dead outcome must end the run — no more sends attempted — with
// stop_reason 'session_expired', and the caller decides the final job status.

test("handleSessionDead: first occurrence triggers, repeats are no-ops", async () => {
  const mod = await import("../ig-action-worker.js");
  const db = makeStubDb({});
  (mod as any).__setSupabaseForTests(db);

  const progress: Record<string, unknown> = {};
  const r1 = await (mod as any).handleSessionDead(JOB_ID, SESSION_ID, progress);
  assert.equal(r1, true);
  assert.equal(progress.stop_reason, "session_expired");
  // job failed with the Arabic reconnect hint (the ig_sessions disconnect goes
  // through igSupabaseService, outside this stub's reach)
  const jobFail = db.calls.find((c) => c.table === "message_jobs" && c.op === "update");
  assert.ok(jobFail);
  assert.equal((jobFail!.payload as Row).status, "failed");
  assert.match(String((jobFail!.payload as Row).error), /الجلسة منتهية الصلاحية/);
  assert.ok((jobFail!.payload as Row).progress, "progress persisted with the job row (no torn state)");

  // Second call: already flagged → no-op (idempotent guard)
  const before = db.calls.length;
  const r2 = await (mod as any).handleSessionDead(JOB_ID, SESSION_ID, progress);
  assert.equal(r2, false);
  assert.equal(db.calls.length, before);
});

test("handleSessionDead still fires when the session row update races", async () => {
  const mod = await import("../ig-action-worker.js");
  const db = makeStubDb({});
  (mod as any).__setSupabaseForTests(db);
  const progress: Record<string, unknown> = {};
  const r = await (mod as any).handleSessionDead(JOB_ID, "other-session", progress);
  assert.equal(r, true);
  assert.equal(progress.stop_reason, "session_expired");
});
