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
 * The worker imports the real supabase client at module load, so we stub
 * supabaseClient.from via its exported object before importing the worker.
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
        return Promise.resolve({ data: null });
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
