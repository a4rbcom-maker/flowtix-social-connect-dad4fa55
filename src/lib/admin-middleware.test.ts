// Integration tests for requireAdmin middleware.
// Verify it rejects unauthenticated callers, callers without the admin role,
// and accepts only when a valid bearer token resolves to a userId that has
// the admin role in user_roles.
import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------- Test doubles ----------

let mockRequest: Request | null = null;
let mockGetClaims: (token: string) => Promise<{ data: { claims: { sub?: string } | null }; error: unknown }>;
let mockRoleLookup: () => Promise<{ data: { role: string } | null; error: unknown }>;

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => mockRequest,
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { getClaims: (t: string) => mockGetClaims(t) },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => mockRoleLookup(),
          }),
        }),
      }),
    }),
  }),
}));

// Ensure env vars exist before middleware imports use them
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "pub-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "svc-key";

// ---------- Helpers ----------

import { requireAdmin } from "./admin-middleware";

type MwLike = { options: { middleware?: MwLike[]; server: (a: { context: Record<string, unknown>; next: (arg?: { context?: Record<string, unknown> }) => Promise<unknown> }) => Promise<unknown> } };

function flatten(mw: MwLike): MwLike[] {
  const deps = (mw.options.middleware ?? []).flatMap(flatten);
  return [...deps, mw];
}

async function runMiddleware(mw: MwLike) {
  const chain = flatten(mw);
  const ctx: Record<string, unknown> = {};
  let idx = 0;
  const step = async (): Promise<{ context: Record<string, unknown> }> => {
    if (idx >= chain.length) return { context: ctx };
    const cur = chain[idx++];
    return cur.options.server({
      context: ctx,
      next: async (arg) => {
        if (arg?.context) Object.assign(ctx, arg.context);
        return step();
      },
    }) as Promise<{ context: Record<string, unknown> }>;
  };
  return step();
}

function buildRequest(headers: Record<string, string> = {}) {
  return new Request("https://app.test/_serverFn/x", { method: "POST", headers });
}

// ---------- Tests ----------

describe("requireAdmin middleware", () => {
  beforeEach(() => {
    mockRequest = null;
    mockGetClaims = async () => ({ data: { claims: null }, error: new Error("nope") });
    mockRoleLookup = async () => ({ data: null, error: null });
  });

  it("rejects when no Authorization header is provided", async () => {
    mockRequest = buildRequest();
    await expect(runMiddleware(requireAdmin as unknown as MwLike)).rejects.toMatchObject({ status: 401 });
  });

  it("rejects when bearer token is invalid", async () => {
    mockRequest = buildRequest({ authorization: "Bearer bad-token" });
    mockGetClaims = async () => ({ data: { claims: null }, error: new Error("invalid") });
    await expect(runMiddleware(requireAdmin as unknown as MwLike)).rejects.toMatchObject({ status: 401 });
  });

  it("rejects authenticated user that does NOT have admin role", async () => {
    mockRequest = buildRequest({ authorization: "Bearer good-token" });
    mockGetClaims = async () => ({ data: { claims: { sub: "user-without-admin" } }, error: null });
    mockRoleLookup = async () => ({ data: null, error: null });
    await expect(runMiddleware(requireAdmin as unknown as MwLike)).rejects.toMatchObject({ status: 403 });
  });

  it("rejects with 403 when the role lookup query errors", async () => {
    mockRequest = buildRequest({ authorization: "Bearer good-token" });
    mockGetClaims = async () => ({ data: { claims: { sub: "user-x" } }, error: null });
    mockRoleLookup = async () => ({ data: null, error: { message: "db down" } });
    await expect(runMiddleware(requireAdmin as unknown as MwLike)).rejects.toMatchObject({ status: 403 });
  });

  it("accepts admin user and exposes adminUserId in context", async () => {
    mockRequest = buildRequest({ authorization: "Bearer good-token" });
    const adminId = "00000000-0000-0000-0000-000000000001";
    mockGetClaims = async () => ({ data: { claims: { sub: adminId } }, error: null });
    mockRoleLookup = async () => ({ data: { role: "admin" }, error: null });

    const res = await runMiddleware(requireAdmin as unknown as MwLike);
    expect(res.context.adminUserId).toBe(adminId);
    expect(res.context.userId).toBe(adminId);
    expect(res.context.supabaseAdmin).toBeTruthy();
  });
});
