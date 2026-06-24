// Integration test: verifies the kie.ai pool rotates from a key that returns
// 402 (quota exhausted) to the next available key and succeeds.
import { describe, it, expect, beforeEach, vi } from "vitest";

process.env.BOT_ENCRYPTION_KEY ??= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

// Mock supabaseAdmin BEFORE importing the module under test
type Row = Record<string, unknown>;
const state: {
  accounts: Row[];
  usageInserts: Row[];
  updatesById: Record<string, Row[]>;
} = { accounts: [], usageInserts: [], updatesById: {} };

vi.mock("@/integrations/supabase/client.server", () => {
  // Lightweight chainable mock that supports the subset used by ai-pool.server.ts
  const builder = (table: string) => {
    const ctx: {
      table: string;
      filters: Array<[string, unknown]>;
      mode: "select" | "update" | "insert" | "delete" | null;
      selectCols: string | null;
      updatePayload: Row | null;
      orderBys: Array<{ col: string; asc: boolean }>;
    } = { table, filters: [], mode: null, selectCols: null, updatePayload: null, orderBys: [] };

    const apply = (rows: Row[]) => {
      let out = rows;
      for (const [col, val] of ctx.filters) out = out.filter((r) => r[col] === val);
      for (const ob of ctx.orderBys) {
        out = [...out].sort((a, b) => {
          const av = a[ob.col] as number | string | null;
          const bv = b[ob.col] as number | string | null;
          if (av === bv) return 0;
          if (av === null || av === undefined) return ob.asc ? -1 : 1;
          if (bv === null || bv === undefined) return ob.asc ? 1 : -1;
          return (av < bv ? -1 : 1) * (ob.asc ? 1 : -1);
        });
      }
      return out;
    };

    const thenable = {
      then(resolve: (v: { data: Row[] | Row | null; error: null }) => void) {
        if (ctx.mode === "select") {
          const rows = apply(state.accounts);
          resolve({ data: rows, error: null });
        } else {
          resolve({ data: null, error: null });
        }
      },
    };

    const chain = {
      select(cols: string) {
        ctx.mode = "select";
        ctx.selectCols = cols;
        return chain;
      },
      insert(payload: Row) {
        ctx.mode = "insert";
        if (ctx.table === "ai_usage_logs") state.usageInserts.push(payload);
        return Promise.resolve({ data: null, error: null });
      },
      update(payload: Row) {
        ctx.mode = "update";
        ctx.updatePayload = payload;
        return chain;
      },
      eq(col: string, val: unknown) {
        ctx.filters.push([col, val]);
        if (ctx.mode === "update") {
          // apply update immediately to in-memory accounts
          const id = ctx.filters.find((f) => f[0] === "id")?.[1] as string | undefined;
          if (id) {
            const idx = state.accounts.findIndex((a) => a.id === id);
            if (idx >= 0) state.accounts[idx] = { ...state.accounts[idx], ...(ctx.updatePayload ?? {}) };
            (state.updatesById[id] ??= []).push(ctx.updatePayload ?? {});
          }
          return Promise.resolve({ data: null, error: null });
        }
        return chain;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        ctx.orderBys.push({ col, asc: opts?.ascending ?? true });
        return chain;
      },
      maybeSingle() {
        const rows = apply(state.accounts);
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      then: thenable.then,
    };
    return chain;
  };

  return {
    supabaseAdmin: {
      from: (table: string) => builder(table),
      rpc: () => Promise.resolve({ data: null, error: null }),
    },
  };
});

// Now import after mocks
import { callKieChat, encryptKey } from "./ai-pool.server";

describe("ai-pool rotation", () => {
  beforeEach(() => {
    state.accounts = [];
    state.usageInserts = [];
    state.updatesById = {};
    vi.restoreAllMocks();
  });

  it("rotates from a 402-exhausted key to the next active key and returns its response", async () => {
    state.accounts = [
      {
        id: "acc-1",
        provider: "kie",
        api_key_encrypted: encryptKey("key-one-secret"),
        priority: 1,
        status: "active",
        cooldown_until: null,
        last_used_at: null,
        requests_count: 0,
        failed_count: 0,
      },
      {
        id: "acc-2",
        provider: "kie",
        api_key_encrypted: encryptKey("key-two-secret"),
        priority: 2,
        status: "active",
        cooldown_until: null,
        last_used_at: null,
        requests_count: 0,
        failed_count: 0,
      },
    ];

    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return new Response("insufficient credit", { status: 402 });
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "hello from key2" } }],
          usage: { prompt_tokens: 3, completion_tokens: 4 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await callKieChat({
      model: "gpt-5",
      messages: [{ role: "user", content: "hi" }],
      userId: "user-1",
      tier: "simple",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.text).toBe("hello from key2");
    expect(res.accountId).toBe("acc-2");
    expect(res.error).toBeNull();

    // acc-1 was marked exhausted after the 402
    const acc1 = state.accounts.find((a) => a.id === "acc-1")!;
    expect(acc1.status).toBe("exhausted");
    expect(acc1.failed_count).toBe(1);

    // acc-2 was marked success (last_used_at set)
    const acc2 = state.accounts.find((a) => a.id === "acc-2")!;
    expect(acc2.last_used_at).toBeTruthy();
  });
});
