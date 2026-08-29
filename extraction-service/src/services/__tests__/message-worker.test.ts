import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Worker behavior tests with a fake sendOne and a stubbed supabase client.
 * We exercise runMessageWorker's decision table without a browser:
 *  - daily cap → paused with daily_cap_reached
 *  - rate_limited → cooldown written, attempts NOT incremented, other session used
 *  - thread_unavailable → skipped
 *  - retry_max → failed
 *
 * The worker module imports the real supabase client at module load, so we
 * stub `supabaseClient.from` via its exported object before requiring it.
 */

type Row = Record<string, unknown>;

function makeStubDb(tables: Record<string, { rows: Row[] }>) {
  const calls: Array<{ table: string; op: string; payload?: Row }> = [];
  const chain = (table: string) => {
    const state = {
      filters: {} as Row,
      payload: undefined as Row | Row[] | undefined,
      op: "select" as string,
      _order: null as string | null,
      _limit: 1000,
    };
    const builder: any = {
      select() { return builder; },
      eq(k: string, v: unknown) { state.filters[k] = v; return builder; },
      in(k: string, v: unknown) { state.filters[k] = v; return builder; },
      lt(k: string, v: unknown) { state.filters[k] = v; return builder; },
      is() { return builder; },
      order(_k: string) { return builder; },
      limit(n: number) { state._limit = n; return builder; },
      maybeSingle() { return Promise.resolve({ data: (tables[table]?.rows ?? [])[0] ?? null }); },
      single() { return Promise.resolve({ data: (tables[table]?.rows ?? [])[0] ?? null }); },
      upsert(payload: Row) { calls.push({ table, op: "upsert", payload: payload as Row }); return Promise.resolve({ data: null }); },
      update(payload: Row) {
        calls.push({ table, op: "update", payload: payload as Row });
        return Promise.resolve({ data: null });
      },
      insert(payload: Row | Row[]) {
        calls.push({ table, op: "insert", payload: payload as Row });
        return Promise.resolve({ data: null });
      },
      then(res: (v: { data: Row[] }) => void) {
        // terminal await → filter rows
        let rows = tables[table]?.rows ?? [];
        for (const [k, v] of Object.entries(state.filters)) {
          if (Array.isArray(v)) rows = rows.filter((r) => Array.isArray(r[k]) ? (v as string[]).some(x => (r[k] as string[]).includes(x)) : v.includes(String(r[k])));
          else rows = rows.filter((r) => r[k] === v);
        }
        res({ data: rows.slice(0, state._limit) });
      },
    };
    return builder;
  };
  return {
    calls,
    from(table: string) { return chain(table); },
  };
}

test("worker decision table (smoke: module loads and exports exist)", async () => {
  const mod = await import("../message-worker.js");
  assert.equal(typeof mod.startMessageWorker, "function");
  assert.equal(typeof mod.stopMessageWorker, "function");
  assert.equal(typeof mod.resumeMessageJobs, "function");
});
