import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, downloadMediaMessage } from "@whiskeysockets/baileys";
import type { Boom } from "@hapi/boom";
import fs from "node:fs/promises";
import path from "node:path";
import qrcode from "qrcode";
import { logger } from "../logger.js";
import { supabaseClient } from "../services/supabase.js";
import { config } from "../config.js";
import type { IncomingWaMessage, SendPayload, WhatsAppProvider } from "./types.js";
import { mediaService } from "./media.js";

const log = logger;
const sockets = new Map<string, ReturnType<typeof makeWASocket>>();
const qrCache = new Map<string, string>();
// Bounded QR auto-retry: an abandoned qr_ready session would otherwise loop
// (QR expires → close → restart) forever. After MAX_QR_RETRIES cycles without
// a scan we stop and let the user request a fresh QR manually.
const qrRetryCounts = new Map<string, number>();
const MAX_QR_RETRIES = 20;

function authPathFor(sessionId: string): string {
  return path.resolve(config.waAuthDir, sessionId);
}

// WhatsApp device-linked JIDs carry a device suffix (e.g. "2010xxxx:0@s.whatsapp.net").
// Sending to a suffixed JID silently fails delivery — normalize to the bare user JID.
function stripDeviceSuffix(jid: string): string {
  return jid ? jid.replace(/:\d+(?=@)/, "") : jid;
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
  async start(sessionId, workspaceId, onQR, onReady, onMessage, onClose) {
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
        if (!sock.user) await transitionStatus(sessionId, "qr_ready", "QR generated");
      }
      if (connection === "open") {
        qrCache.delete(sessionId);
        qrRetryCounts.delete(sessionId);
        const jid = sock.user?.id ?? "";
        const pushName = sock.user?.name ?? undefined;
        onReady({ jid, pushName });
        await persistSessionInDB(sessionId, jid, pushName);
      }
      if (connection === "close") {
        const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const loggedOut = reason === DisconnectReason.loggedOut;
        sockets.delete(sessionId);
        qrCache.delete(sessionId);
        onClose(`closed (${reason ?? "unknown"})`);
        if (loggedOut) {
          await transitionStatus(sessionId, "disconnected", "logged out");
          qrRetryCounts.delete(sessionId);
          await fs.rm(authPathFor(sessionId), { recursive: true, force: true }).catch(() => {});
          return;
        }
        // Only auto-reconnect if the session is still meant to be connected.
        // qr_ready included: when QR attempts expire Baileys closes the socket —
        // without this the connect page polls a dead socket forever.
        const { data: cur } = await supabaseClient
          .from("wa_sessions").select("status").eq("id", sessionId).maybeSingle();
        const shouldAutoReconnect = cur && (cur.status === "connected" || cur.status === "reconnecting" || cur.status === "qr_ready");
        if (shouldAutoReconnect) {
          const retries = (qrRetryCounts.get(sessionId) ?? 0);
          if (retries >= MAX_QR_RETRIES) {
            log.warn("Baileys", `session ${sessionId}: QR retry limit reached (${MAX_QR_RETRIES}) — stopping auto-reconnect, manual re-link required`);
            qrRetryCounts.delete(sessionId);
            await transitionStatus(sessionId, "error", `QR retry limit reached (${MAX_QR_RETRIES})`);
            return;
          }
          qrRetryCounts.set(sessionId, retries + 1);
          await transitionStatus(sessionId, "reconnecting", `disconnect ${reason}`);
          setTimeout(() => baileysProvider.start(sessionId, workspaceId, onQR, onReady, onMessage, onClose), 5000);
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
        const incoming = toIncoming(m, sessionId, workspaceId);
        if (incoming) {
          incoming.workspaceId = workspaceId;
          incoming.remoteJid = stripDeviceSuffix(await resolveLidJid(incoming.remoteJid));
          if (incoming.hasMedia) {
            try {
              const mime = incoming.mediaMimeType || "application/octet-stream";
              const key = await mediaService.downloadAndStore(workspaceId, sessionId, incoming.messageId, async () => {
                const buf = await downloadMediaMessage(m, "buffer", {});
                return Buffer.from(buf);
              }, mime);
              if (key) incoming.mediaKey = key;
            } catch (e) { log.warn("Baileys", `media download failed: ${String(e)}`); }
          }
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
        const incoming = toIncoming(m, sessionId, workspaceId);
        if (incoming) { incoming.workspaceId = workspaceId; incoming.remoteJid = stripDeviceSuffix(await resolveLidJid(incoming.remoteJid)); onMessage({ ...incoming, isHistory: true }); imported++; }
      }
      log.info("Baileys", `history sync: ${imported}/${capped.length} messages imported`);
    });
  },

  isAuthenticated(sessionId) { return sockets.has(sessionId) && !!sockets.get(sessionId)?.user; },

  async send(sessionId, to, payload) {
    // Normalize device-suffixed JIDs before sending — suffixed JIDs fail silently
    const normalizedTo = stripDeviceSuffix(to);
    const sock = sockets.get(sessionId);
    if (!sock) throw new Error(`Session ${sessionId} not active`);
    let result: any;
    if (payload.type === "text" && payload.text) {
      result = await sock.sendMessage(normalizedTo, { text: payload.text });
    } else if (payload.type === "image" && payload.mediaUrl) {
      result = await sock.sendMessage(normalizedTo, { image: { url: payload.mediaUrl }, caption: payload.caption });
    } else if (payload.type === "video" && payload.mediaUrl) {
      result = await sock.sendMessage(normalizedTo, { video: { url: payload.mediaUrl }, caption: payload.caption });
    } else if (payload.type === "audio" && payload.mediaUrl) {
      result = await sock.sendMessage(normalizedTo, { audio: { url: payload.mediaUrl }, ptt: false });
    } else if (payload.type === "document" && payload.mediaUrl) {
      result = await sock.sendMessage(normalizedTo, { document: { url: payload.mediaUrl }, mimetype: payload.mimeType || "application/octet-stream", fileName: payload.fileName || "file" });
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
      try {
        sock.ev.removeAllListeners("connection.update");
        sock.ev.removeAllListeners("creds.update");
        sock.ev.removeAllListeners("messages.upsert");
        sock.ev.removeAllListeners("messaging-history.set");
        sock.end(new Error("service shutdown"));
      } catch {}
      sockets.delete(sessionId); qrCache.delete(sessionId);
      qrRetryCounts.delete(sessionId);
    }
  },

  getQR(sessionId) { return qrCache.get(sessionId); },
};
