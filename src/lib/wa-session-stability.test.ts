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
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  extractSessionReason,
  isHardSessionGoneError,
  isTrustedUserDisconnect,
  updateWaSessionStatus,
} from "./wa-session-events.server";
import { BridgeError } from "./wa-bridge.server";

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
    expect(state.settingsUpdates.some((u) => u.is_connected === false)).toBe(false);
  });

  it("network drop then reconnect: transient disconnect is debounced, then reconnect heartbeat restores connected without any disconnected flap", async () => {
    const { db, state } = makeDb({
      session: { status: "connected", last_seen_at: new Date(now).toISOString() },
    });

    // 1) Network drops — bridge emits a generic transient disconnect.
    await updateWaSessionStatus(db, {
      userId,
      sessionId,
      nextStatus: "disconnected",
      source: "webhook_status",
      reason: "connection lost",
    });
    expect(state.session.status).toBe("connected");
    expect(state.settingsUpdates.some((u) => u.is_connected === false)).toBe(false);

    // 2) Follow-up transient reason while still offline — still no flap.
    await updateWaSessionStatus(db, {
      userId,
      sessionId,
      nextStatus: "disconnected",
      source: "webhook_status",
      reason: "reconnecting",
    });
    expect(state.session.status).toBe("connected");

    // 3) Network comes back — bridge sends a "connected" heartbeat.
    await updateWaSessionStatus(db, {
      userId,
      sessionId,
      nextStatus: "connected",
      source: "webhook_status",
    });

    expect(state.session.status).toBe("connected");
    expect(state.settingsUpdates.some((u) => u.is_connected === false)).toBe(false);
    // last_seen_at must advance to (roughly) the reconnect moment.
    expect(Date.parse(state.session.last_seen_at)).toBeGreaterThanOrEqual(now);
  });

  it("network drop already flipped session to disconnected: reconnect heartbeat brings it back to connected + clears whatsapp_settings", async () => {
    const { db, state } = makeDb({
      session: { status: "disconnected", last_seen_at: new Date(now - 30_000).toISOString() },
    });

    await updateWaSessionStatus(db, {
      userId,
      sessionId,
      nextStatus: "connected",
      source: "webhook_status",
    });

    expect(state.session.status).toBe("connected");
    expect(Date.parse(state.session.last_seen_at)).toBeGreaterThanOrEqual(now);
    expect(state.settingsUpdates.at(-1)?.is_connected).toBe(true);
  });

  it("rapid flap: disconnect → connect → disconnect(transient) → connect stays connected end-to-end", async () => {
    const { db, state } = makeDb({
      session: { status: "connected", last_seen_at: new Date(now).toISOString() },
    });

    await updateWaSessionStatus(db, {
      userId, sessionId, nextStatus: "disconnected",
      source: "webhook_status", reason: "socket closed",
    });
    await updateWaSessionStatus(db, {
      userId, sessionId, nextStatus: "connected", source: "webhook_status",
    });
    await updateWaSessionStatus(db, {
      userId, sessionId, nextStatus: "disconnected",
      source: "webhook_status", reason: "connection reset",
    });
    await updateWaSessionStatus(db, {
      userId, sessionId, nextStatus: "connected", source: "webhook_status",
    });

    expect(state.session.status).toBe("connected");
    expect(state.settingsUpdates.some((u) => u.is_connected === false)).toBe(false);
  });

  it("poll-driven reconnect: a poll reporting connected restores a previously-disconnected session", async () => {
    const { db, state } = makeDb({
      session: { status: "disconnected", last_seen_at: new Date(now - 120_000).toISOString() },
    });

    await updateWaSessionStatus(db, {
      userId, sessionId, nextStatus: "connected", source: "poll",
    });

    expect(state.session.status).toBe("connected");
    expect(state.events.at(-1)?.to_status).toBe("connected");
  });
});

describe("extractSessionReason", () => {
  it("prefers explicit reason fields", () => {
    expect(extractSessionReason({}, { reason: "user_logout" })).toBe("user_logout");
    expect(extractSessionReason({ disconnectReason: "device_removed" })).toBe("device_removed");
  });
  it("falls back to lastDisconnect.error.message", () => {
    expect(
      extractSessionReason({}, {
        lastDisconnect: { error: { message: "socket closed by remote" } },
      }),
    ).toBe("socket closed by remote");
  });
  it("returns null when nothing meaningful is present", () => {
    expect(extractSessionReason({}, {})).toBeNull();
    expect(extractSessionReason({ reason: "   " }, {})).toBeNull();
  });
  it("serializes objects as fallback", () => {
    const out = extractSessionReason({}, { error: { code: 401, kind: "unauthorized" } });
    expect(out).toContain("401");
  });
});

describe("extractSessionReason — full branch coverage of helpers (lines 22-68)", () => {
  it("valueToReason: numbers and booleans stringify", () => {
    // number candidate via lastDisconnect.statusCode
    expect(
      extractSessionReason({}, { lastDisconnect: { statusCode: 401 } }),
    ).toBe("401");
    // boolean candidate via payload.reason
    expect(extractSessionReason({ reason: false as any }, {})).toBe("false");
  });

  it("valueToReason: Error instance uses message, then name", () => {
    const err = new Error("boom");
    expect(extractSessionReason({}, { error: err })).toBe("boom");

    const named = new Error("");
    named.name = "LoggedOutError";
    expect(extractSessionReason({}, { error: named })).toBe("LoggedOutError");
  });

  it("valueToReason: circular object falls through to null (JSON.stringify throws)", () => {
    const circular: any = {};
    circular.self = circular;
    // only candidate present is unserializable -> should skip and return null
    expect(extractSessionReason({}, { reason: circular })).toBeNull();
  });

  it("valueToReason: empty-object candidate is skipped, next candidate wins", () => {
    // data.error = {} → JSON.stringify -> "{}" -> null, then payload.error picked
    expect(
      extractSessionReason({ error: "fallback_reason" }, { error: {} }),
    ).toBe("fallback_reason");
  });

  it("extractSessionReason: reads payload-side lastDisconnect when data has none", () => {
    expect(
      extractSessionReason(
        { lastDisconnect: { error: { message: "conn closed" } } },
        {},
      ),
    ).toBe("conn closed");
  });

  it("extractSessionReason: asObj coerces non-object lastDisconnect/error safely", () => {
    // lastDisconnect is a string (invalid) → asObj returns {}; nothing else matches
    expect(
      extractSessionReason({}, { lastDisconnect: "nope" as any }),
    ).toBeNull();
    // data.error is a number → picked directly via candidates before asObj lookup
    expect(extractSessionReason({}, { error: 500 as any })).toBe("500");
  });

  it("extractSessionReason: called with default args returns null", () => {
    expect(extractSessionReason()).toBeNull();
  });

  it("isHardSessionGoneError: BridgeError with non-404 status and unrelated message is not hard", () => {
    expect(isHardSessionGoneError(new BridgeError("bad gateway", 502, null))).toBe(false);
  });

  it("isHardSessionGoneError: matches 'session not found' phrasing", () => {
    expect(
      isHardSessionGoneError(new BridgeError("session not found for user", 500, null)),
    ).toBe(true);
  });

  it("isHardSessionGoneError: handles undefined input", () => {
    expect(isHardSessionGoneError(undefined)).toBe(false);
    expect(isHardSessionGoneError("string error" as any)).toBe(false);
    expect(isHardSessionGoneError({ status: 404, message: "x" } as any)).toBe(false);
  });
});

describe("updateWaSessionStatus — DB failure paths (lines 121 & 135)", () => {
  const userId = "u1";
  const sessionId = "s1";

  it("logWaSessionEvent swallows insert failures and warns (line 121)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // DB where wa_session_events.insert throws, everything else is a noop.
    const db: any = {
      from: (table: string) => {
        if (table === "wa_session_events") {
          return {
            insert: async () => {
              throw new Error("audit table unavailable");
            },
          };
        }
        if (table === "wa_sessions") {
          const api: any = {
            select: () => api,
            eq: () => api,
            update: () => api,
            maybeSingle: async () => ({ data: { status: "connected", last_seen_at: null } }),
          };
          return api;
        }
        if (table === "whatsapp_settings") {
          return { update: () => ({ eq: async () => ({ data: null, error: null }) }) };
        }
        throw new Error(`unmocked: ${table}`);
      },
    };

    // A real status transition forces a log write → hits the catch on line 121.
    await expect(
      updateWaSessionStatus(db, {
        userId,
        sessionId,
        nextStatus: "disconnected",
        source: "disconnect",
        reason: "user_logout",
      }),
    ).resolves.not.toThrow();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[wa-session-events] insert failed:"),
      expect.anything(),
    );
    warn.mockRestore();
  });

  it("hasActiveBulkCampaign returns false when the DB query throws (line 135)", async () => {
    // bulk_jobs query throws → catch returns false → untrusted disconnect
    // still gets debounced by the preserve-connected rule, session stays.
    const db: any = {
      from: (table: string) => {
        if (table === "bulk_jobs") {
          const api: any = {
            select: () => api,
            eq: () => api,
            in: () => ({
              limit: async () => {
                throw new Error("bulk_jobs unavailable");
              },
            }),
          };
          return api;
        }
        if (table === "wa_sessions") {
          const state = { status: "connected", last_seen_at: new Date().toISOString() };
          const api: any = {
            select: () => api,
            eq: () => api,
            update: (payload: any) => {
              Object.assign(state, payload);
              return api;
            },
            maybeSingle: async () => ({ data: { ...state } }),
          };
          return api;
        }
        if (table === "wa_session_events") {
          return { insert: async () => ({ data: null, error: null }) };
        }
        if (table === "whatsapp_settings") {
          return { update: () => ({ eq: async () => ({ data: null, error: null }) }) };
        }
        throw new Error(`unmocked: ${table}`);
      },
    };

    const prev = await updateWaSessionStatus(db, {
      userId,
      sessionId,
      nextStatus: "disconnected",
      source: "webhook_status",
      reason: "socket closed", // untrusted → triggers hasActiveBulkCampaign
    });

    // Function returned normally and reports the previous status it read.
    expect(prev).toBe("connected");
  });
});

describe("isHardSessionGoneError", () => {
  it("treats 404 BridgeError as session gone", () => {
    expect(isHardSessionGoneError(new BridgeError("session missing", 404, null))).toBe(true);
  });
  it("treats logged_out/closed messages as session gone", () => {
    expect(isHardSessionGoneError(new BridgeError("session logged out", 500, null))).toBe(true);
    expect(isHardSessionGoneError(new BridgeError("socket closed", 500, null))).toBe(true);
  });
  it("does not treat generic errors or non-BridgeError as session gone", () => {
    expect(isHardSessionGoneError(new BridgeError("temporary glitch", 500, null))).toBe(false);
    expect(isHardSessionGoneError(new Error("boom"))).toBe(false);
    expect(isHardSessionGoneError(null)).toBe(false);
  });
});
