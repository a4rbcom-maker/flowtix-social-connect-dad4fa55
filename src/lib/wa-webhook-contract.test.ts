// Contract tests for the Bot-Xtra v1.8.x WhatsApp bridge webhook payloads.
//
// These lock the wire format we accept from Bot-Xtra so refactors of
// wa-webhook.server.ts cannot silently drop fields or change normalization.
// If a test here fails, either the bridge contract genuinely changed (update
// the fixture AND coordinate with Bot-Xtra) or the parser regressed.

import { createHmac } from "crypto";
import { describe, expect, it } from "vitest";
import {
  collectMessageEntries,
  findSessionId,
  normalizeMessageStatus,
  normalizeRemoteJid,
  parseMessageEntry,
  SESSION_STATUS_MAP,
  verifySignature,
} from "./wa-webhook-parsers";

// ── Canonical Bot-Xtra v1.8.x fixtures ──────────────────────────────────────

const BOTXTRA_INBOUND_TEXT = {
  event: "message",
  sessionId: "flowtix-abcdef0123456789-l4k2j",
  data: {
    messages: [
      {
        messageId: "3EB0BX1.8.AAA001",
        from: "201001234567@s.whatsapp.net",
        senderPn: "201001234567",
        pushName: "Ahmed",
        type: "text",
        content: { text: "اهلا" },
        timestamp: 1_730_000_000,
        fromMe: false,
      },
    ],
  },
};

const BOTXTRA_INBOUND_IMAGE = {
  event: "message",
  sessionId: "flowtix-abcdef0123456789-l4k2j",
  data: {
    messages: [
      {
        messageId: "3EB0BX1.8.AAA002",
        from: "201001234567@s.whatsapp.net",
        senderPn: "201001234567",
        type: "image",
        caption: "look",
        mediaData: { url: "https://cdn.botxtra/x.jpg", mimeType: "image/jpeg" },
        timestamp: 1_730_000_010,
        fromMe: false,
      },
    ],
  },
};

const BOTXTRA_GROUP_MSG = {
  event: "message",
  sessionId: "flowtix-abcdef0123456789-l4k2j",
  data: {
    messages: [
      {
        messageId: "3EB0BX1.8.AAA003",
        groupJid: "120363000000000001@g.us",
        groupSubject: "Sales",
        senderPn: "201002223333",
        type: "text",
        content: "ping",
        timestamp: 1_730_000_020,
        fromMe: false,
        isGroup: true,
      },
    ],
  },
};

const BOTXTRA_STATUS_UPDATE = {
  event: "status",
  sessionId: "flowtix-abcdef0123456789-l4k2j",
  data: { status: "open", phoneNumber: "201001234567" },
};

const BOTXTRA_STATUS_BROADCAST = {
  event: "message",
  sessionId: "flowtix-abcdef0123456789-l4k2j",
  data: {
    messages: [
      { messageId: "x", from: "status@broadcast", type: "text", content: "x" },
    ],
  },
};

// ── Session id discovery ────────────────────────────────────────────────────

describe("Bot-Xtra v1.8.x: sessionId discovery", () => {
  it("reads top-level sessionId", () => {
    expect(findSessionId(BOTXTRA_INBOUND_TEXT, new Headers())).toBe(
      "flowtix-abcdef0123456789-l4k2j",
    );
  });

  it("falls back to x-session-id header", () => {
    const headers = new Headers({ "x-session-id": "hdr-session" });
    expect(findSessionId({}, headers)).toBe("hdr-session");
  });

  it("reads nested data.sessionId", () => {
    expect(
      findSessionId({ data: { sessionId: "nested-sess" } }, new Headers()),
    ).toBe("nested-sess");
  });

  it("returns null when nothing is present", () => {
    expect(findSessionId({}, new Headers())).toBeNull();
  });
});

// ── Message collection + parsing ────────────────────────────────────────────

describe("Bot-Xtra v1.8.x: message collection", () => {
  it("extracts messages from data.messages array", () => {
    const entries = collectMessageEntries(BOTXTRA_INBOUND_TEXT);
    expect(entries).toHaveLength(1);
    expect(entries[0].messageId).toBe("3EB0BX1.8.AAA001");
  });

  it("handles top-level messages array (legacy)", () => {
    const entries = collectMessageEntries({ messages: [{ id: "a", text: "x" }] });
    expect(entries).toHaveLength(1);
  });
});

describe("Bot-Xtra v1.8.x: parseMessageEntry", () => {
  it("parses inbound text (content.text shape)", () => {
    const [entry] = collectMessageEntries(BOTXTRA_INBOUND_TEXT);
    const m = parseMessageEntry(entry)!;
    expect(m).not.toBeNull();
    expect(m.text).toBe("اهلا");
    expect(m.msgType).toBe("text");
    expect(m.fromMe).toBe(false);
    expect(m.fromPhone).toBe("201001234567");
    expect(m.remoteJid).toBe("201001234567@s.whatsapp.net");
    expect(m.providerMessageId).toBe("3EB0BX1.8.AAA001");
    expect(m.waTimestamp).toBe(new Date(1_730_000_000_000).toISOString());
    expect(m.contactName).toBe("Ahmed");
  });

  it("parses inbound image with caption + mediaData", () => {
    const [entry] = collectMessageEntries(BOTXTRA_INBOUND_IMAGE);
    const m = parseMessageEntry(entry)!;
    expect(m.msgType).toBe("image");
    expect(m.text).toBe("look");
    expect(m.mediaUrl).toBe("https://cdn.botxtra/x.jpg");
  });

  it("parses group message with groupJid + senderPn", () => {
    const [entry] = collectMessageEntries(BOTXTRA_GROUP_MSG);
    const m = parseMessageEntry(entry)!;
    expect(m.isGroup).toBe(true);
    expect(m.remoteJid).toBe("120363000000000001@g.us");
    expect(m.fromPhone).toBe("201002223333");
    expect(m.contactName).toBe("Sales");
    expect(m.text).toBe("ping");
  });

  it("rejects status@broadcast entries", () => {
    const [entry] = collectMessageEntries(BOTXTRA_STATUS_BROADCAST);
    expect(parseMessageEntry(entry)).toBeNull();
  });
});

// ── Normalizers ─────────────────────────────────────────────────────────────

describe("Bot-Xtra v1.8.x: normalizers", () => {
  it("normalizes ack labels to delivered/read/sent/failed", () => {
    expect(normalizeMessageStatus("server_ack", true)).toBe("delivered");
    expect(normalizeMessageStatus("read", true)).toBe("read");
    expect(normalizeMessageStatus("queued", true)).toBe("queued");
    expect(normalizeMessageStatus("undelivered", true)).toBe("failed");
    expect(normalizeMessageStatus(undefined, false)).toBe("received");
  });

  it("normalizes bare phone numbers to s.whatsapp.net JIDs", () => {
    expect(normalizeRemoteJid(null, "201001234567")).toBe(
      "201001234567@s.whatsapp.net",
    );
    expect(normalizeRemoteJid(null, "201001234567", true)).toBe(
      "201001234567@g.us",
    );
  });

  it("preserves existing JIDs", () => {
    expect(normalizeRemoteJid("120363@g.us", null, true)).toBe("120363@g.us");
  });

  it("covers every Bot-Xtra session state label", () => {
    for (const label of [
      "open",
      "ready",
      "connected",
      "qr",
      "scan",
      "connecting",
      "starting",
      "disconnected",
      "closed",
      "logged_out",
    ]) {
      expect(SESSION_STATUS_MAP[label]).toBeDefined();
    }
    expect(SESSION_STATUS_MAP.open).toBe("connected");
    expect(SESSION_STATUS_MAP.logged_out).toBe("disconnected");
  });
});

// ── HMAC signature ──────────────────────────────────────────────────────────

describe("Bot-Xtra v1.8.x: HMAC signature verification", () => {
  const secret = "test-secret";
  const body = JSON.stringify(BOTXTRA_INBOUND_TEXT);
  const goodSig = createHmac("sha256", secret).update(body, "utf8").digest("hex");

  it("accepts a valid sha256 hex signature (raw + sha256= prefix)", () => {
    expect(verifySignature(body, goodSig, secret)).toBe(true);
    expect(verifySignature(body, `sha256=${goodSig}`, secret)).toBe(true);
  });

  it("rejects tampered bodies", () => {
    expect(verifySignature(body + "x", goodSig, secret)).toBe(false);
  });

  it("rejects missing signature header", () => {
    expect(verifySignature(body, null, secret)).toBe(false);
  });

  it("rejects malformed hex", () => {
    expect(verifySignature(body, "not-hex!!", secret)).toBe(false);
  });
});
