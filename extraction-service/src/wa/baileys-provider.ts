import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } from "@whiskeysockets/baileys";
import type { Boom } from "@hapi/boom";
import qrcode from "qrcode";
import { logger } from "../logger.js";
import { supabaseClient } from "../services/supabase.js";
import type { IncomingWaMessage, SendPayload, WhatsAppProvider } from "./types.js";

const log = logger;
const sockets = new Map<string, ReturnType<typeof makeWASocket>>();
const qrCache = new Map<string, string>();

function toIncoming(m: any, sessionId: string, workspaceId: string): IncomingWaMessage | null {
  try {
    const msg = m.message || m;
    const key = m.key || {};
    const remoteJid = key.remoteJid || "";
    const messageId = key.id || "";
    const fromMe = key.fromMe || false;
    const pushName = m.pushName || "";
    const timestamp = m.messageTimestamp ? m.messageTimestamp * 1000 : Date.now();

    let type: IncomingWaMessage["type"] = "text";
    let text: string | undefined;
    let hasMedia = false;
    let mediaMimeType: string | undefined;
    let mediaUrl: string | undefined;

    if (msg.conversation || msg.extendedTextMessage?.text) {
      type = "text";
      text = msg.conversation || msg.extendedTextMessage?.text;
    } else if (msg.imageMessage) {
      type = "image"; hasMedia = true;
      text = msg.imageMessage.caption;
      mediaMimeType = msg.imageMessage.mimetype;
      mediaUrl = msg.imageMessage.url;
    } else if (msg.videoMessage) {
      type = "video"; hasMedia = true;
      text = msg.videoMessage.caption;
      mediaMimeType = msg.videoMessage.mimetype;
    } else if (msg.audioMessage) {
      type = "audio"; hasMedia = true;
      mediaMimeType = msg.audioMessage.mimetype;
    } else if (msg.documentMessage) {
      type = "document"; hasMedia = true;
      mediaMimeType = msg.documentMessage.mimetype;
    } else if (msg.contactMessage) {
      type = "contact";
    } else if (msg.locationMessage) {
      type = "location";
    } else if (msg.buttonsResponseMessage) {
      type = "buttons";
      text = msg.buttonsResponseMessage?.selectedDisplayText;
    }

    return { sessionId, workspaceId, remoteJid, fromMe, messageId, pushName: pushName || undefined, type, text: text || undefined, hasMedia, mediaMimeType: mediaMimeType || undefined, mediaUrl: mediaUrl || undefined, quotedMessageId: undefined, timestamp };
  } catch { return null; }
}

async function persistSessionInDB(sessionId: string, jid: string, pushName?: string) {
  try {
    const phoneNumber = jid.split("@")[0]?.split(":")[0] ?? null;
    await supabaseClient.from("wa_sessions").update({ phone_number_jid: jid, phone_number: phoneNumber, push_name: pushName ?? null, last_connected: new Date().toISOString() }).eq("id", sessionId);
    await supabaseClient.rpc("transition_wa_session_status", { p_session_id: sessionId, p_new_status: "connected", p_reason: "Authenticated via QR", p_metadata: {} } as never);
  } catch (e) { log.error("Baileys", `db persist failed: ${String(e)}`); }
}

export const baileysProvider: WhatsAppProvider & { getQR(sessionId: string): string | undefined } = {
  async start(sessionId, onQR, onReady, onMessage, onClose) {
    if (sockets.has(sessionId)) return;

    const authPath = `./.wa-auth/${sessionId}`;
    const { state, saveCreds } = await useMultiFileAuthState(authPath);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, log as any) },
      printQRInTerminal: false,
      browser: ["FlowTix", "Chrome", "1.0.0"],
      generateHighQualityLinkPreview: true,
    });
    sockets.set(sessionId, sock);

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", async (upd) => {
      const { connection, qr, lastDisconnect } = upd;
      if (qr) {
        const dataUrl = await qrcode.toDataURL(qr);
        qrCache.set(sessionId, dataUrl);
        onQR(dataUrl);
        try { await supabaseClient.rpc("transition_wa_session_status", { p_session_id: sessionId, p_new_status: "qr_ready", p_reason: "QR generated", p_metadata: {} } as never); } catch {}
      }
      if (connection === "open") {
        qrCache.delete(sessionId);
        const jid = sock.user?.id ?? "";
        const pushName = sock.user?.name ?? undefined;
        onReady({ jid, pushName });
        await persistSessionInDB(sessionId, jid, pushName);
      }
      if (connection === "close") {
        const code = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = code !== DisconnectReason.loggedOut;
        sockets.delete(sessionId);
        qrCache.delete(sessionId);
        onClose(`closed (${code ?? "unknown"})`);
        if (shouldReconnect) {
          try { await supabaseClient.rpc("transition_wa_session_status", { p_session_id: sessionId, p_new_status: "reconnecting", p_reason: `disconnect ${code}`, p_metadata: {} } as never); } catch {}
          setTimeout(() => baileysProvider.start(sessionId, onQR, onReady, onMessage, onClose), 5000);
        } else {
          try { await supabaseClient.rpc("transition_wa_session_status", { p_session_id: sessionId, p_new_status: "disconnected", p_reason: "logged out", p_metadata: {} } as never); } catch {}
          await supabaseClient.storage.from("wa-auth-state").remove([`${sessionId}/state.json`]).catch(() => {});
        }
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      for (const m of messages) {
        const incoming = toIncoming(m, sessionId, "");
        if (incoming) {
          onMessage(incoming);
          log.info("Baileys", `inbound: ${incoming.remoteJid} → "${incoming.text ?? "[media]"}"`);
        }
      }
    });
  },

  isAuthenticated(sessionId) { return sockets.has(sessionId) && !!sockets.get(sessionId)?.user; },

  async send(sessionId, to, payload) {
    const sock = sockets.get(sessionId);
    if (!sock) throw new Error(`Session ${sessionId} not active`);
    let result: any;
    if (payload.type === "text" && payload.text) {
      result = await sock.sendMessage(to, { text: payload.text });
    } else if (payload.type === "image" && payload.mediaUrl) {
      result = await sock.sendMessage(to, { image: { url: payload.mediaUrl }, caption: payload.caption });
    } else if (payload.type === "video" && payload.mediaUrl) {
      result = await sock.sendMessage(to, { video: { url: payload.mediaUrl }, caption: payload.caption });
    } else if (payload.type === "audio" && payload.mediaUrl) {
      result = await sock.sendMessage(to, { audio: { url: payload.mediaUrl }, ptt: false });
    } else if (payload.type === "document" && payload.mediaUrl) {
      result = await sock.sendMessage(to, { document: { url: payload.mediaUrl }, mimetype: payload.mimeType || "application/octet-stream", fileName: payload.fileName || "file" });
    } else {
      throw new Error("Unsupported payload type or missing content");
    }
    return { messageId: result?.key?.id ?? "" };
  },

  async markRead(sessionId, jid, messageId) {
    const sock = sockets.get(sessionId);
    if (sock) await sock.readMessages([{ remoteJid: jid, id: messageId, fromMe: false } as any]);
  },

  async stop(sessionId) {
    const sock = sockets.get(sessionId);
    if (sock) { await sock.logout().catch(() => {}); sockets.delete(sessionId); qrCache.delete(sessionId); }
  },

  getQR(sessionId) { return qrCache.get(sessionId); },
};
