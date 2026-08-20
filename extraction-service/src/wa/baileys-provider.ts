import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } from "@whiskeysockets/baileys";
import type { Boom } from "@hapi/boom";
import fs from "node:fs/promises";
import path from "node:path";
import qrcode from "qrcode";
import { logger } from "../logger.js";
import { supabaseClient } from "../services/supabase.js";
import { config } from "../config.js";
import type { IncomingWaMessage, SendPayload, WhatsAppProvider } from "./types.js";

const log = logger;
const sockets = new Map<string, ReturnType<typeof makeWASocket>>();
const qrCache = new Map<string, string>();

function authPathFor(sessionId: string): string {
  return path.resolve(config.waAuthDir, sessionId);
}

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

async function transitionStatus(sessionId: string, newStatus: string, reason: string): Promise<boolean> {
  const { data, error } = await supabaseClient.rpc("transition_wa_session_status", { p_session_id: sessionId, p_new_status: newStatus, p_reason: reason, p_metadata: {} } as never);
  if (error) { log.error("Baileys", `status transition to ${newStatus} failed: ${error.message}`); return false; }
  const result = data as { success?: boolean; message?: string } | null;
  if (result && result.success === false) { log.warn("Baileys", `status transition to ${newStatus} rejected: ${result.message ?? "unknown reason"}`); return false; }
  return true;
}

async function persistSessionInDB(sessionId: string, jid: string, pushName?: string) {
  try {
    const phoneNumber = jid.split("@")[0]?.split(":")[0] ?? null;
    const { error: updErr } = await supabaseClient.from("wa_sessions").update({ phone_number_jid: jid, phone_number: phoneNumber, push_name: pushName ?? null, last_connected: new Date().toISOString() }).eq("id", sessionId);
    if (updErr) log.error("Baileys", `session info update failed: ${updErr.message}`);

    if (await transitionStatus(sessionId, "connected", "Authenticated via QR")) return;
    await transitionStatus(sessionId, "connecting", "Linking after QR scan");
    if (await transitionStatus(sessionId, "connected", "Authenticated via QR")) return;

    const { error: fbErr } = await supabaseClient.from("wa_sessions").update({ status: "connected" }).eq("id", sessionId);
    if (fbErr) log.error("Baileys", `connected fallback update failed: ${fbErr.message}`);
    else log.warn("Baileys", `session ${sessionId}: status set to connected via direct update`);
  } catch (e) { log.error("Baileys", `db persist failed: ${String(e)}`); }
}

export const baileysProvider: WhatsAppProvider & { getQR(sessionId: string): string | undefined } = {
  async start(sessionId, onQR, onReady, onMessage, onClose) {
    if (sockets.has(sessionId)) return;

    const authPath = authPathFor(sessionId);
    await fs.mkdir(authPath, { recursive: true, mode: 0o700 });
    const { state, saveCreds } = await useMultiFileAuthState(authPath);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, log as any) },
      printQRInTerminal: false,
      browser: ["FlowTix", "Chrome", "1.0.0"],
      generateHighQualityLinkPreview: true,
      syncFullHistory: true,
    });
    sockets.set(sessionId, sock);

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", async (upd) => {
      const { connection, qr, lastDisconnect } = upd;
      if (qr) {
        const dataUrl = await qrcode.toDataURL(qr);
        qrCache.set(sessionId, dataUrl);
        onQR(dataUrl);
        await transitionStatus(sessionId, "qr_ready", "QR generated");
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
          await transitionStatus(sessionId, "reconnecting", `disconnect ${code}`);
          setTimeout(() => baileysProvider.start(sessionId, onQR, onReady, onMessage, onClose), 5000);
        } else {
          await transitionStatus(sessionId, "disconnected", "logged out");
          await fs.rm(authPathFor(sessionId), { recursive: true, force: true }).catch(() => {});
        }
      }
    });

    const isIgnorableJid = (jid: string) => jid === "status@broadcast" || jid.endsWith("@broadcast") || jid.endsWith("@newsletter");

    // WhatsApp "hide phone number" users message via anonymous LID jids — resolve to real phone when mapping is known
    const resolveLidJid = async (jid: string): Promise<string> => {
      if (!jid.endsWith("@lid")) return jid;
      try {
        const pn = await (sock as any).signalRepository?.lidMapping?.getPNForLID?.(jid);
        if (pn) return pn;
      } catch {}
      return jid;
    };

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;
      for (const m of messages) {
        if (m.key?.fromMe) continue;
        if (isIgnorableJid(m.key?.remoteJid ?? "")) continue;
        const incoming = toIncoming(m, sessionId, "");
        if (incoming) {
          incoming.remoteJid = await resolveLidJid(incoming.remoteJid);
          onMessage(incoming);
          log.info("Baileys", `inbound: ${incoming.remoteJid} → "${incoming.text ?? "[media]"}"`);
        }
      }
    });

    sock.ev.on("messaging-history.set", async ({ messages, isLatest }) => {
      if (!isLatest) return;
      const capped = messages.slice(-1000);
      let imported = 0;
      for (const m of capped) {
        if (m.key?.fromMe) continue;
        if (isIgnorableJid(m.key?.remoteJid ?? "")) continue;
        const incoming = toIncoming(m, sessionId, "");
        if (incoming) { incoming.remoteJid = await resolveLidJid(incoming.remoteJid); onMessage({ ...incoming, isHistory: true }); imported++; }
      }
      log.info("Baileys", `history sync: ${imported}/${capped.length} messages imported`);
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
    if (sock) {
      try { sock.end(new Error("service shutdown")); } catch {}
      sockets.delete(sessionId); qrCache.delete(sessionId);
    }
  },

  getQR(sessionId) { return qrCache.get(sessionId); },
};
