// Regression tests for the "session must not falsely disconnect" invariant.
//
// These lock in the guarantees implemented in wa-session-events.server.ts:
//   1. A late webhook (older than last activity) MUST NOT flip a
//      connected session to disconnected.
//   2. A transient "disconnected" event that arrives while a bulk
//      campaign is running/scheduled MUST be debounced (session stays).
//   3. Only a trusted logout signal (source=disconnect, or a webhook
//      that explicitly says logged_out / 401 unauthorized+closed, or a
//      real "removed device" event) is allowed to flip to disconnected.
//   4. Sends and receives (updating last_seen_at) never mark a session
//      as disconnected on their own.
import { describe, it, expect, beforeEach } from "vitest";
import {
  isTrustedUserDisconnect,
  updateWaSessionStatus,
} from "./wa-session-events.server";

type Row = Record<string, any>;

function makeDb(seed: {
  session: Row;
  bulkJobs?: Row[];
}) {
  const state = {
    session: { ...seed.session } as Row,
    bulkJobs: seed.bulkJobs ?? [],
    events: [] as Row[],
    settingsUpdates: [] as Row[],
  };

  const from = (table: string) => {
    if (table === "wa_sessions") {
      const filters: Record<string, any> = {};
      const api: any = {
        select: () => api,
        update: (payload: Row) => {
          Object.assign(state.session, payload);
          return api;
        },
        eq: (col: string, val: any) => {
          filters[col] = val;
          return api;
        },
        maybeSingle: async () => ({
          data: {
            status: state.session.status,
            last_seen_at: state.session.last_seen_at,
          },
        }),
      };
      return api;
    }
    if (table === "wa_session_events") {
      return {
        insert: async (row: Row) => {
          state.events.push(row);
          return { data: null, error: null };
        },
      };
    }
    if (table === "bulk_jobs") {
      const api: any = {
        select: () => api,
        eq: () => api,
        in: (_col: string, statuses: string[]) => {
          const data = state.bulkJobs.filter((j) => statuses.includes(j.status));
          return {
            limit: async () => ({ data }),
          };
        },
      };
      return api;
    }
    if (table === "whatsapp_settings") {
      return {
        update: (payload: Row) => ({
          eq: async () => {
            state.settingsUpdates.push(payload);
            return { data: null, error: null };
          },
        }),
      };
    }
    throw new Error(`unmocked table: ${table}`);
  };

  return { db: { from } as any, state };
}

describe("isTrustedUserDisconnect", () => {
  it("trusts explicit user disconnect source", () => {
    expect(isTrustedUserDisconnect({ source: "disconnect" })).toBe(true);
  });
  it("trusts logged_out / removed device webhooks", () => {
    expect(
      isTrustedUserDisconnect({ source: "webhook_status", reason: "logged_out" }),
    ).toBe(true);
    expect(
      isTrustedUserDisconnect({ source: "webhook_status", rawStatus: "device_removed" }),
    ).toBe(true);
  });
  it("trusts 401 unauthorized + closed", () => {
    expect(
      isTrustedUserDisconnect({
        source: "webhook_status",
        reason: "401 unauthorized, socket closed",
      }),
    ).toBe(true);
  });
  it("does NOT trust generic transient disconnects (network, timeout, restart)", () => {
    for (const reason of [
      "connection timeout",
      "socket reset",
      "restart_required",
      "stream errored",
      "reconnecting",
      undefined,
      null,
      "",
    ]) {
      expect(
        isTrustedUserDisconnect({ source: "webhook_status", reason: reason as any }),
      ).toBe(false);
    }
  });
});

describe("updateWaSessionStatus — stability guarantees", () => {
  const userId = "u1";
  const sessionId = "s1";
  const now = Date.now();

  beforeEach(() => {
    // deterministic
  });

  it("late webhook (older than last_seen_at) does NOT flip connected → disconnected", async () => {
    const lastSeen = new Date(now).toISOString();
    const { db, state } = makeDb({
      session: { status: "connected", last_seen_at: lastSeen },
    });

    await updateWaSessionStatus(db, {
      userId,
      sessionId,
      nextStatus: "disconnected",
      source: "webhook_status",
      reason: "logged_out", // even a "trusted" reason must be ignored if late
      eventAt: now - 60_000, // 60s older than last activity
    });

    expect(state.session.status).toBe("connected");
    expect(state.events.at(-1)?.reason).toMatch(/ignored_transient_disconnect\(late_event\)/);
  });

  it("bulk campaign running debounces untrusted disconnect", async () => {
    const { db, state } = makeDb({
      session: { status: "connected", last_seen_at: new Date(now).toISOString() },
      bulkJobs: [{ status: "running" }],
    });

    await updateWaSessionStatus(db, {
      userId,
      sessionId,
      nextStatus: "disconnected",
      source: "webhook_status",
      reason: "connection lost",
    });

    expect(state.session.status).toBe("connected");
    // whatsapp_settings must not be marked disconnected during debounce
    expect(state.settingsUpdates.some((u) => u.is_connected === false)).toBe(false);
  });

  it("trusted user logout DOES disconnect the session even during a bulk campaign", async () => {
    const { db, state } = makeDb({
      session: { status: "connected", last_seen_at: new Date(now).toISOString() },
      bulkJobs: [{ status: "running" }],
    });

    await updateWaSessionStatus(db, {
      userId,
      sessionId,
      nextStatus: "disconnected",
      source: "disconnect", // user tapped "logout" on the phone
      reason: "user_logout",
    });

    expect(state.session.status).toBe("disconnected");
    expect(state.settingsUpdates.some((u) => u.is_connected === false)).toBe(true);
  });

  it("connected heartbeat (send/receive path) never marks session disconnected", async () => {
    const { db, state } = makeDb({
      session: { status: "connected", last_seen_at: new Date(now - 5_000).toISOString() },
    });

    // Simulate an incoming/outgoing message heartbeat -> "connected" ping.
    await updateWaSessionStatus(db, {
      userId,
      sessionId,
      nextStatus: "connected",
      source: "webhook_status",
    });

    expect(state.session.status).toBe("connected");
    // last_seen_at must advance
    expect(Date.parse(state.session.last_seen_at)).toBeGreaterThanOrEqual(now - 5_000);
  });

  it("untrusted transient disconnect without bulk still preserves connected session", async () => {
    const { db, state } = makeDb({
      session: { status: "connected", last_seen_at: new Date(now).toISOString() },
    });

    await updateWaSessionStatus(db, {
      userId,
      sessionId,
      nextStatus: "disconnected",
      source: "webhook_status",
      reason: "socket closed", // generic, not a real logout
    });

    expect(state.session.status).toBe("connected");
    expect(state.events.at(-1)?.reason).toMatch(/ignored_transient_disconnect\(untrusted_disconnect\)/);
  });
});
