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

const BOTXTRA_MESSAGE_STATUS_UPDATE = {
  event: "status",
  sessionId: "flowtix-abcdef0123456789-l4k2j",
  data: { status: "delivered", messageId: "3EB0BX1.8.ACK001" },
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

const BOTXTRA_V18_FLAT_DATA_MESSAGE = {
  event: "message",
  sessionId: "flowtix-abcdef0123456789-l4k2j",
  data: {
    tenantId: "4f4b101d-b785-4719-82a3-6f378584739e",
    from: { id: "201273747262@s.whatsapp.net", name: "Customer" },
    fromMe: false,
    pushName: "Customer",
    senderName: "Customer",
    notifyName: "Customer",
    body: "مرحبا",
    type: "text",
    id: "3EB0BX1.8.FLAT001",
    isGroup: false,
    sender: { jid: "201273747262@s.whatsapp.net", phone: "201273747262" },
    timestamp: 1_730_000_030,
  },
};

const BOTXTRA_V18_LID_INBOUND_MESSAGE = {
  event: "message",
  sessionId: "flowtix-abcdef0123456789-l4k2j",
  data: {
    id: "3EB0BX1.8.LID001",
    from: "182239858000081",
    senderPn: "201273747262@s.whatsapp.net",
    body: "مرحبا",
    type: "text",
    fromMe: false,
    isGroup: false,
    timestamp: 1_730_000_040,
  },
};

const BOTXTRA_V18_BARE_FROM_MESSAGE = {
  event: "message",
  sessionId: "flowtix-abcdef0123456789-l4k2j",
  data: {
    tenantId: "4f4b101d-b785-4719-82a3-6f378584739e",
    from: "201508776669",
    fromMe: "false",
    pushName: "Customer",
    senderName: "Customer",
    notifyName: "Customer",
    body: "رسالة قديمة",
    type: "text",
    id: "3EB0BX1.8.BARE001",
    isGroup: false,
    sender: "201508776669",
    timestamp: 1_730_000_050,
  },
};

const BOTXTRA_V18_NUMERIC_FROM_MESSAGE = {
  event: "message",
  sessionId: "flowtix-abcdef0123456789-l4k2j",
  data: {
    tenantId: "4f4b101d-b785-4719-82a3-6f378584739e",
    from: 201508776669,
    fromMe: "false",
    pushName: "Customer",
    body: "رسالة وصلت الآن",
    type: "text",
    id: "3EB0BX1.8.NUMERIC001",
    isGroup: false,
    sender: 201508776669,
    timestamp: 1_730_000_055,
  },
};

const BOTXTRA_V18_OWN_BARE_FROM_MESSAGE = {
  event: "message",
  sessionId: "flowtix-abcdef0123456789-l4k2j",
  data: {
    tenantId: "4f4b101d-b785-4719-82a3-6f378584739e",
    from: "201508776669",
    fromMe: true,
    body: "تم الرد",
    type: "text",
    id: "3EB0BX1.8.BARE002",
    isGroup: false,
    timestamp: 1_730_000_060,
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

  it("extracts Bot-Xtra v1.8.x flat message object from data", () => {
    const entries = collectMessageEntries(BOTXTRA_V18_FLAT_DATA_MESSAGE);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("3EB0BX1.8.FLAT001");
  });

  it("extracts overloaded status events that carry message delivery ACKs", () => {
    const entries = collectMessageEntries(BOTXTRA_MESSAGE_STATUS_UPDATE);
    expect(entries).toHaveLength(1);
    expect(entries[0].messageId).toBe("3EB0BX1.8.ACK001");
    expect(normalizeMessageStatus(entries[0].status, true)).toBe("delivered");
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

  it("parses Bot-Xtra v1.8.x flat data message shape", () => {
    const [entry] = collectMessageEntries(BOTXTRA_V18_FLAT_DATA_MESSAGE);
    const m = parseMessageEntry(entry)!;
    expect(m).not.toBeNull();
    expect(m.text).toBe("مرحبا");
    expect(m.msgType).toBe("text");
    expect(m.fromMe).toBe(false);
    expect(m.fromPhone).toBe("201273747262");
    expect(m.remoteJid).toBe("201273747262@s.whatsapp.net");
    expect(m.providerMessageId).toBe("3EB0BX1.8.FLAT001");
    expect(m.contactName).toBe("Customer");
  });

  it("preserves inbound WhatsApp LID as the chat address while keeping senderPn as phone", () => {
    const [entry] = collectMessageEntries(BOTXTRA_V18_LID_INBOUND_MESSAGE);
    const m = parseMessageEntry(entry)!;
    expect(m).not.toBeNull();
    expect(m.text).toBe("مرحبا");
    expect(m.fromPhone).toBe("201273747262");
    expect(m.remoteJid).toBe("182239858000081@lid");
    expect(m.providerMessageId).toBe("3EB0BX1.8.LID001");
  });

  it("parses Bot-Xtra flat messages where from is a bare phone and fromMe is a string", () => {
    const [entry] = collectMessageEntries(BOTXTRA_V18_BARE_FROM_MESSAGE);
    const m = parseMessageEntry(entry)!;
    expect(m).not.toBeNull();
    expect(m.text).toBe("رسالة قديمة");
    expect(m.fromMe).toBe(false);
    expect(m.fromPhone).toBe("201508776669");
    expect(m.remoteJid).toBe("201508776669@s.whatsapp.net");
    expect(m.providerMessageId).toBe("3EB0BX1.8.BARE001");
  });

  it("parses Bot-Xtra flat messages where from/sender arrive as numbers", () => {
    const [entry] = collectMessageEntries(BOTXTRA_V18_NUMERIC_FROM_MESSAGE);
    const m = parseMessageEntry(entry)!;
    expect(m).not.toBeNull();
    expect(m.text).toBe("رسالة وصلت الآن");
    expect(m.fromMe).toBe(false);
    expect(m.fromPhone).toBe("201508776669");
    expect(m.remoteJid).toBe("201508776669@s.whatsapp.net");
    expect(m.providerMessageId).toBe("3EB0BX1.8.NUMERIC001");
  });

  it("keeps own historical flat messages even when Bot-Xtra omits a separate recipient field", () => {
    const [entry] = collectMessageEntries(BOTXTRA_V18_OWN_BARE_FROM_MESSAGE);
    const m = parseMessageEntry(entry)!;
    expect(m).not.toBeNull();
    expect(m.text).toBe("تم الرد");
    expect(m.fromMe).toBe(true);
    expect(m.remoteJid).toBe("201508776669@s.whatsapp.net");
    expect(m.providerMessageId).toBe("3EB0BX1.8.BARE002");
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
