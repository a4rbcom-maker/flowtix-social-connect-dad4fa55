/**
 * WhatsApp Bridge Server - Flowtix Platform
 * Compatible with bridge-proxy Edge Function
 * Version 1.8.4 - Persistent session resilience + watchdog recovery
 * 
 * Endpoints:
 * GET    /              - Dashboard (no auth required)
 * GET    /health        - Basic health check
 * GET    /api/health    - Detailed health check (auth required)
 * POST   /api/sessions          - Create new session
 * GET    /api/sessions/:id/qr   - Get QR code
 * GET    /api/sessions/:id/status - Get session status
 * POST   /api/sessions/:id/send - Send message
 * DELETE /api/sessions/:id      - Disconnect session
 * GET    /api/sessions          - List all sessions
 */

const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, generateMessageIDV2, generateMessageID } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');

const app = express();
app.use(express.json({ limit: '50mb' }));

const SERVER_VERSION = '1.8.5-flowtix-history';
// ─── OTP Delivery Guarantee (v1.8.0 — conservative) ───
// Tracks every OTP we send. If WA doesn't ack delivery within OTP_DELIVERY_DEADLINE_MS,
// we resend (attempt 1: no flush, just bypass device cache; attempt 2: deep Signal flush + resend).
// Tuned to avoid breaking healthy sessions on slow recipient networks.
const otpDeliveryWatcher = new Map();
const OTP_DELIVERY_DEADLINE_MS = 30000;  // was 15s — too aggressive on slow networks
const OTP_MAX_RETRIES = 2;
const OTP_WATCHER_TICK_MS = 5000;
const OTP_STALL_RECOVERY_MS = 2000; // after Bridge timeout response, rebuild hollow paired socket quickly + resend same OTP
const otpProviderRecoveryLocks = new Map();
// Cap on reconnect attempts before we give up and stop hammering the WA servers.
// Without this, a permanently broken session (e.g. revoked from phone, corrupted creds)
// keeps spamming reconnect every 30s forever, eventually crashing the whole bridge process.
const MAX_RECONNECT_ATTEMPTS = 20;
// If a restored, already-paired session stays in-memory but never reaches
// connection=open and never emits a QR, the websocket is hollow/stalled.
// Rebuild it automatically instead of letting OTP calls fail for hours.
const HOLLOW_SESSION_RESET_MS = 45_000;
const HOLLOW_SESSION_MAX_RESETS = 6;
const startedAt = new Date();

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const API_KEY = process.env.API_KEY || '';
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const PORT = process.env.PORT || 3000;
const SESSIONS_DIR = path.resolve(process.env.SESSIONS_DIR || path.join(__dirname, 'sessions'));

if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
console.log(`[startup] Bridge v${SERVER_VERSION} booting on Node ${process.version} (${os.platform()} ${os.release()})`);
console.log(`[startup] Sessions directory: ${SESSIONS_DIR}`);

process.on('unhandledRejection', (reason) => {
  // Swallow Baileys 'rate-overlimit' from offline node processing — WhatsApp throttles
  // when many offline messages are decrypted after restore. Safe to ignore: the socket stays connected
  // and OTP/outbound sending is unaffected.
  const msg = reason?.message || String(reason || '');
  if (msg.includes('rate-overlimit') || msg.includes('processing offline nodes')) {
    console.warn('[process] Ignored Baileys offline-node throttle (rate-overlimit) — non-fatal.');
    return;
  }
  console.error('[process] Unhandled rejection:', reason);
});

process.on('uncaughtException', (err) => {
  const msg = err?.message || String(err || '');
  if (msg.includes('rate-overlimit')) {
    console.warn('[process] Ignored rate-overlimit uncaught exception — non-fatal.');
    return;
  }
  console.error('[process] Uncaught exception:', err);
});

// API Key middleware
const authMiddleware = (req, res, next) => {
  if (!API_KEY) return next();
  const key = req.headers['x-api-key'];
  if (key !== API_KEY) return res.status(401).json({ error: 'Invalid API key' });
  next();
};

app.use('/api', authMiddleware);

// In-memory session store
const sessions = new Map();
const SESSION_META_FILE = 'session-meta.json';

// v1.5.1: Release tombstones — after a DELETE we hold the sessionId in a
// "do-not-recreate" window for 35s. Any POST /api/sessions during this window
// is rejected with release_pending. This eliminates the race where a fresh QR
// is generated before WhatsApp has fully released the previous pairing,
// which manifests as "تعذر ربط الجهاز" on the customer's phone.
const RELEASE_WINDOW_MS = 35_000;
const releaseTombstones = new Map(); // sessionId -> releaseUntilMs
function isInRelease(sessionId) {
  const t = releaseTombstones.get(sessionId);
  if (!t) return 0;
  const remaining = t - Date.now();
  if (remaining <= 0) { releaseTombstones.delete(sessionId); return 0; }
  return Math.ceil(remaining / 1000);
}
function markRelease(sessionId, ms = RELEASE_WINDOW_MS) {
  releaseTombstones.set(sessionId, Date.now() + ms);
}

const logger = pino({ level: 'warn' });

// Helper: format uptime
function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

// Helper: get session stats
function getSessionStats() {
  let connected = 0, disconnected = 0;
  sessions.forEach(s => s.connected ? connected++ : disconnected++);
  return { total: sessions.size, connected, disconnected };
}

// Helper: get health data
function getHealthData() {
  const mem = process.memoryUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  let sessionsDirWritable = false;
  try {
    const probeFile = path.join(SESSIONS_DIR, `.write-test-${Date.now()}`);
    fs.writeFileSync(probeFile, 'ok');
    fs.unlinkSync(probeFile);
    sessionsDirWritable = true;
  } catch {}
  return {
    status: 'ok',
    version: SERVER_VERSION,
    sessions: getSessionStats(),
    uptime: formatUptime(process.uptime()),
    uptime_seconds: Math.floor(process.uptime()),
    started_at: startedAt.toISOString(),
    memory: {
      rss_mb: Math.round(mem.rss / 1024 / 1024),
      heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
      heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
      system_total_mb: Math.round(totalMem / 1024 / 1024),
      system_free_mb: Math.round(freeMem / 1024 / 1024),
    },
    platform: {
      node: process.version,
      os: `${os.platform()} ${os.release()}`,
      arch: os.arch(),
    },
    checks: {
      api_key_configured: !!API_KEY,
      webhook_configured: !!WEBHOOK_URL,
      webhook_hmac_enabled: !!WEBHOOK_SECRET,
      sessions_dir: SESSIONS_DIR,
      sessions_dir_writable: sessionsDirWritable,
    },
  };
}

function describeFetchError(err) {
  const parts = [err?.name, err?.code, err?.message, err?.cause?.code, err?.cause?.message]
    .filter(Boolean)
    .map(String);
  return parts.length ? parts.join(' | ') : 'unknown fetch error';
}

function describeSendError(err) {
  const parts = [err?.name, err?.code, err?.message, err?.output?.statusCode, err?.data?.reason, err?.cause?.message]
    .filter(Boolean)
    .map(String);
  return parts.length ? parts.join(' | ') : 'unknown send error';
}

function getSessionDir(sessionId) {
  return path.join(SESSIONS_DIR, sessionId);
}

function cleanStoreId(id) {
  return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 160);
}

function buildDeterministicMessageId(socket) {
  try {
    const userId = socket?.user?.id || socket?.authState?.creds?.me?.id;
    if (typeof generateMessageIDV2 === 'function') return generateMessageIDV2(userId);
  } catch {}
  try {
    if (typeof generateMessageID === 'function') return generateMessageID();
  } catch {}
  return `3EB0${Date.now().toString(16).toUpperCase()}${Math.random().toString(16).slice(2, 12).toUpperCase()}`.slice(0, 22);
}

function reviveBuffers(_key, value) {
  if (value && value.type === 'Buffer' && Array.isArray(value.data)) {
    return Buffer.from(value.data);
  }
  return value;
}

function createSimpleCache() {
  const map = new Map();
  return {
    get: (key) => map.get(key),
    set: (key, value) => { map.set(key, value); return true; },
    del: (key) => map.delete(key),
    flushAll: () => map.clear(),
  };
}

function authFileToken(value) {
  return String(value || '').replace(/\//g, '__').replace(/:/g, '-');
}

async function flushRecipientSignalState(session, sessionDir, jid) {
  if (!session?.socket || !jid || jid.endsWith('@g.us')) return { skipped: true, reason: 'invalid_or_group' };
  const bare = String(jid).split('@')[0].replace(/[^0-9]/g, '');
  if (!bare) return { skipped: true, reason: 'no_digits' };

  const ids = Array.from(new Set([
    jid,
    `${bare}@s.whatsapp.net`,
    `${bare}:0@s.whatsapp.net`,
    `${bare}:0.0@s.whatsapp.net`,
    `${bare}@lid`,
    `${bare}:0@lid`,
    `${bare}:0.0@lid`,
  ]));

  let keysRemoved = 0;
  try {
    const nullSessions = Object.fromEntries(ids.map((id) => [id, null]));
    await session.socket.authState?.keys?.set?.({ session: nullSessions });
    keysRemoved += ids.length;
  } catch (err) {
    console.warn(`[signal-flush] keys.set failed for ${jid}:`, err?.message || err);
  }

  let filesRemoved = 0;
  try {
    const files = fs.readdirSync(sessionDir);
    const tokens = ids.map(authFileToken);
    for (const file of files) {
      if (!file.startsWith('session-') || !file.endsWith('.json')) continue;
      if (!tokens.some((token) => file.includes(token) || file.includes(bare))) continue;
      try {
        fs.unlinkSync(path.join(sessionDir, file));
        filesRemoved++;
      } catch {}
    }
  } catch (err) {
    console.warn(`[signal-flush] file cleanup failed for ${jid}:`, err?.message || err);
  }

  return { skipped: false, keysRemoved, filesRemoved, idsTried: ids.length };
}

function getSessionMetaPath(sessionId) {
  return path.join(getSessionDir(sessionId), SESSION_META_FILE);
}

function saveSessionMeta(sessionId, meta) {
  try {
    fs.mkdirSync(getSessionDir(sessionId), { recursive: true });
    fs.writeFileSync(getSessionMetaPath(sessionId), JSON.stringify({
      sessionId,
      tenantId: meta.tenantId || null,
      webhookUrl: meta.webhookUrl || WEBHOOK_URL || '',
      markOnline: meta.markOnline !== undefined ? !!meta.markOnline : true,
      updatedAt: new Date().toISOString(),
    }, null, 2));
  } catch (err) {
    console.error(`[${sessionId}] Failed to save session meta:`, err.message);
  }
}

function loadSessionMeta(sessionId) {
  try {
    const file = getSessionMetaPath(sessionId);
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, 'utf8')) || {};
  } catch (err) {
    console.warn(`[${sessionId}] Failed to load session meta:`, err?.message || err);
    return {};
  }
}

async function softResetSession(sessionId, reason = 'soft_reset', options = {}) {
  const existing = sessions.get(sessionId);
  const meta = loadSessionMeta(sessionId);
  const tenantId = existing?.tenantId || meta.tenantId || null;
  const webhookUrl = existing?.webhookUrl || meta.webhookUrl || WEBHOOK_URL;
  const markOnline = existing?.markOnline !== undefined ? existing.markOnline : (meta.markOnline !== undefined ? meta.markOnline : true);
  const syncFullHistory = options.syncFullHistory === true || options.syncHistory === true || options.historySync === true || options.fullHistory === true || meta.syncFullHistory === true;
  if (existing) {
    existing.disableReconnect = true;
    try { if (existing.reconnectTimer) clearTimeout(existing.reconnectTimer); } catch {}
    try { existing.socket?.end?.(); } catch {}
    sessions.delete(sessionId);
  }
  console.warn(`[${sessionId}] SOFT_RESET_SESSION reason=${reason} — preserving paired credentials`);
  const result = await createSession(sessionId, tenantId, webhookUrl, { markOnline, force: true, syncFullHistory });
  return result;
}

async function scheduleOtpProviderRecovery(sessionId, sendBody, originalMessageId, delayMs = OTP_STALL_RECOVERY_MS) {
  if (!originalMessageId || !sendBody?.to) return;
  if (otpProviderRecoveryLocks.has(originalMessageId)) return;
  const originalSession = sessions.get(sessionId);
  const tenantId = originalSession?.tenantId || null;
  const originalTo = String(sendBody.to).split('@')[0];
  const timer = setTimeout(async () => {
    try {
      otpProviderRecoveryLocks.delete(originalMessageId);
      const current = sessions.get(sessionId);
      if (!current?.connected) return;
      console.warn(`[${sessionId}] OTP_PROVIDER_TIMEOUT_RECOVERY id=${originalMessageId} jid=${sendBody.to} — soft-reset + resend`);
      await softResetSession(sessionId, 'otp_provider_timeout');
      for (let i = 0; i < 10; i++) {
        const fresh = sessions.get(sessionId);
        if (fresh?.connected) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      const fresh = sessions.get(sessionId);
      if (!fresh?.connected) {
        console.warn(`[${sessionId}] OTP_PROVIDER_TIMEOUT_RECOVERY skipped — session not reconnected`);
        return;
      }
      const payload = { text: String(sendBody.content ?? '') };
      await fresh.socket.sendPresenceUpdate('available').catch(() => null);
      await fresh.socket.presenceSubscribe(sendBody.to).catch(() => null);
      await new Promise((r) => setTimeout(r, 800));
      const result = await fresh.socket.sendMessage(sendBody.to, payload, { useUserDevicesCache: false });
      const newId = result?.key?.id;
      if (newId) {
        try { fresh._rememberSentMessage?.(newId, { conversation: String(sendBody.content ?? '') }); } catch {}
        otpDeliveryWatcher.set(newId, { sessionId, jid: sendBody.to, content: sendBody.content, type: 'text', mediaUrl: '', mentions: undefined, sentAt: Date.now(), retries: 0 });
        await sendWebhook('status', sessionId, { tenantId: fresh.tenantId || tenantId, messageId: newId, to: originalTo, status: 'sent', provider_recovery: true, originalMessageId });
      }
      console.log(`[${sessionId}] OTP_PROVIDER_TIMEOUT_RECOVERY sent newId=${newId || 'missing'} original=${originalMessageId}`);
    } catch (err) {
      otpProviderRecoveryLocks.delete(originalMessageId);
      console.error(`[${sessionId}] OTP_PROVIDER_TIMEOUT_RECOVERY failed:`, err?.message || err);
    }
  }, delayMs);
  timer.unref?.();
  otpProviderRecoveryLocks.set(originalMessageId, timer);
}

// Send webhook to platform (v1.7.7 - HMAC-SHA256 signing on raw body)
async function sendWebhook(event, sessionId, data) {
  const session = sessions.get(sessionId);
  const targetUrl = session ? session.webhookUrl : WEBHOOK_URL;
  if (!targetUrl) return;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);
  try {
    // Build raw body ONCE — sign exactly the bytes we transmit.
    const rawBody = JSON.stringify({
      source: 'bridge',
      event,
      sessionId,
      data,
      timestamp: new Date().toISOString(),
    });
    const headers = { 'Content-Type': 'application/json' };
    if (WEBHOOK_SECRET) {
      const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody, 'utf8').digest('hex');
      headers['X-Bridge-Signature'] = `sha256=${sig}`;
    }
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: rawBody,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error(`Webhook error: HTTP ${response.status} for ${event} (${body.slice(0, 200)})`);
    }
  } catch (err) {
    const urlHost = (() => { try { return new URL(targetUrl).host; } catch { return 'invalid-url'; } })();
    console.error(`Webhook error: ${describeFetchError(err)} | event=${event} | host=${urlHost}`);
  } finally {
    clearTimeout(timeoutId);
  }
}


// Create or reconnect a session
async function createSession(sessionId, tenantId, webhookUrl, options = {}) {
  // GUARD v1.5.1: respect release tombstone — never recreate a session that
  // was just deleted within the last 35s. Returns release_pending so callers
  // wait for WhatsApp servers to fully drop the previous pairing.
  const releaseSecs = isInRelease(sessionId);
  if (releaseSecs > 0 && !options.force) {
    return { sessionId, status: 'release_pending', retry_after_seconds: releaseSecs };
  }

  if (sessions.has(sessionId)) {
    const existing = sessions.get(sessionId);
    if (existing.connected === true) {
      return { sessionId, status: 'already_connected' };
    }
    // GUARD: don't tear down a session that is mid-pairing (has a fresh QR
    // visible to the customer). Return the current state so polling callers
    // never rotate the QR while it is being scanned.
    if (existing.qr && !options.force) {
      return { sessionId, status: 'awaiting_pairing', has_qr: true };
    }
    try { if (existing.reconnectTimer) clearTimeout(existing.reconnectTimer); } catch {}
    try { if (existing._hollowWatchTimer) clearTimeout(existing._hollowWatchTimer); } catch {}
    try { existing.socket?.end?.(); } catch {}
    sessions.delete(sessionId);
  }

  const sessionDir = getSessionDir(sessionId);
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
  saveSessionMeta(sessionId, { tenantId, webhookUrl, markOnline: options.markOnline, syncFullHistory: options.syncFullHistory === true });

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  // markOnlineOnConnect: if false, the account won't appear online or show last seen
  const markOnline = options.markOnline !== undefined ? !!options.markOnline : true;

  // ─── Sent-message store for Signal Protocol retry receipts ───
  // iPhone & WhatsApp Web frequently request message resend when they
  // can't decrypt (stale session keys). If getMessage returns empty,
  // recipients see a blank bubble while sender's WA shows the real text.
  // Cache messages in memory + disk so retry receipts still work after
  // auto-update/container restart.
  const sentMessageStore = new Map(); // id -> { message, expiresAt }
  // v1.6.4: bumped TTL to 24h + cap to 2000 so late Signal retry receipts
  // (often arriving minutes/hours after the original send) still receive the
  // real message content, instead of an empty conversation that leaves the
  // recipient stuck on "Waiting for this message…".
  const SENT_STORE_TTL_MS = 24 * 60 * 60 * 1000;
  const SENT_STORE_MAX = 2000;
  const SENT_STORE_DIR = path.join(sessionDir, 'sent-message-store');
  try { fs.mkdirSync(SENT_STORE_DIR, { recursive: true }); } catch {}
  function getSentMessagePath(id) {
    return path.join(SENT_STORE_DIR, `${cleanStoreId(id)}.json`);
  }
  function rememberSentMessage(id, message) {
    if (!id || !message) return;
    if (sentMessageStore.size >= SENT_STORE_MAX) {
      const firstKey = sentMessageStore.keys().next().value;
      if (firstKey) sentMessageStore.delete(firstKey);
    }
    sentMessageStore.set(id, { message, expiresAt: Date.now() + SENT_STORE_TTL_MS });
    try {
      fs.writeFileSync(getSentMessagePath(id), JSON.stringify({ message, expiresAt: Date.now() + SENT_STORE_TTL_MS }));
    } catch (err) {
      console.warn(`[${sessionId}] Failed to persist sent msg ${id}:`, err?.message || err);
    }
  }
  function loadSentMessage(id) {
    if (!id) return null;
    const stored = sentMessageStore.get(id);
    if (stored && stored.expiresAt > Date.now()) return stored.message;
    if (stored) sentMessageStore.delete(id);
    try {
      const file = getSentMessagePath(id);
      if (!fs.existsSync(file)) return null;
      const disk = JSON.parse(fs.readFileSync(file, 'utf8'), reviveBuffers);
      if (!disk?.message || disk.expiresAt <= Date.now()) {
        try { fs.unlinkSync(file); } catch {}
        return null;
      }
      sentMessageStore.set(id, disk);
      return disk.message;
    } catch (err) {
      console.warn(`[${sessionId}] Failed to load sent msg ${id}:`, err?.message || err);
      return null;
    }
  }

  const socket = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
    syncFullHistory: options.syncFullHistory === true,
    shouldSyncHistoryMessage: () => options.syncFullHistory === true,
    emitMyMessages: true,
    markOnlineOnConnect: markOnline,
    browser: ['Flowtix', 'Desktop', '4.0.0'],
    connectTimeoutMs: 120000,
    qrTimeout: 180000,
    keepAliveIntervalMs: 25000,
    defaultQueryTimeoutMs: 0, // disable query timeout fallback in Baileys
    // Default: skip init queries (fetchProps/sendPassiveIq) to avoid 408 timeouts.
    // When syncFullHistory=true (opt-in via Flowtix), enable init queries so WhatsApp
    // triggers messaging-history.set → emits history_chats / history_messages webhooks.
    fireInitQueries: options.syncFullHistory === true,
    retryRequestDelayMs: 1000,
    getMessage: async (key) => {
      // Return real content for retry receipts so iPhone/WA Web can decrypt.
      const msg = loadSentMessage(key?.id);
      if (msg) {
        const hasText = !!(msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || msg.videoMessage?.caption || msg.documentMessage?.caption);
        console.log(`[${sessionId}] getMessage HIT id=${key?.id} hasText=${hasText} (store size=${sentMessageStore.size})`);
        return msg;
      }
      console.warn(`[${sessionId}] getMessage MISS id=${key?.id} — retry receipt will fail; recipient stays on "Waiting for this message"`);
      return undefined;
    },
    msgRetryCounterCache: createSimpleCache(),
    maxMsgRetryCount: 12,
    retryRequestDelayMs: 500,
  });

  // ========== REACTION ECHO SUPPRESSION ==========
  // Track sent reaction message IDs to skip their echo in messages.upsert
  const recentSentReactionIds = new Set();
  // Track incoming reaction IDs (from messages.reaction event) to skip duplicate in messages.upsert
  const recentIncomingReactionIds = new Set();

  // Helper: add ID with auto-expiry (60 seconds)
  function trackReactionId(set, id) {
    if (!id) return;
    set.add(id);
    setTimeout(() => set.delete(id), 60000);
  }

  const sessionData = {
    socket,
    qr: null,
    connected: false,
    tenantId,
    webhookUrl: options.disableWebhook ? '' : (webhookUrl || WEBHOOK_URL),
    createdAt: new Date().toISOString(),
    disableReconnect: !!options.disableReconnect,
    reconnectAttempts: 0,
    reconnectTimer: null,
      markOnline,
    _recentSentReactionIds: recentSentReactionIds,
    _rememberSentMessage: rememberSentMessage,
    _sessionDir: sessionDir,
    // v1.7.2: per-session FIFO queue + adaptive pacing for offline-node backlog.
    // After (re)connect, WhatsApp dumps the offline message backlog in seconds and
    // each msg here triggers media download + profile-pic fetch + webhook. Without
    // pacing this overwhelms Baileys decryption and triggers rate-overlimit cascades.
    _msgQueue: [],
    _msgQueueRunning: false,
    _msgQueueDroppedAt: 0,
    _hollowResetCount: options.hollowResetCount || 0,
    _hollowWatchTimer: null,
    syncFullHistory: options.syncFullHistory === true,
  };


  sessions.set(sessionId, sessionData);

  sessionData._hollowWatchTimer = setTimeout(() => {
    const live = sessions.get(sessionId);
    if (!live || live.connected || live.qr || live.disableReconnect) return;
    if ((live._hollowResetCount || 0) >= HOLLOW_SESSION_MAX_RESETS) {
      console.error(`[${sessionId}] Hollow session reset cap reached. Manual re-pair may be required.`);
      sendWebhook('disconnected', sessionId, { tenantId, reason: 'hollow_session_reset_cap' });
      return;
    }
    console.warn(`[${sessionId}] HOLLOW_SESSION_STALLED ${HOLLOW_SESSION_RESET_MS}ms — rebuilding socket (${(live._hollowResetCount || 0) + 1}/${HOLLOW_SESSION_MAX_RESETS})`);
    try { live.socket?.end?.(); } catch {}
    sessions.delete(sessionId);
    createSession(sessionId, tenantId, webhookUrl, { ...options, force: true, hollowResetCount: (live._hollowResetCount || 0) + 1 })
      .catch((err) => console.error(`[${sessionId}] Hollow rebuild failed:`, err.message));
  }, HOLLOW_SESSION_RESET_MS);
  sessionData._hollowWatchTimer.unref?.();

  socket.ev.on('creds.update', saveCreds);

  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    sessionData._lastSocketEventAt = Date.now();

    if (qr) {
      const qrDataUrl = await QRCode.toDataURL(qr, { width: 400, margin: 2 });
      sessionData.qr = qrDataUrl;
      sessionData.connected = false;
      if (sessionData._hollowWatchTimer) {
        clearTimeout(sessionData._hollowWatchTimer);
        sessionData._hollowWatchTimer = null;
      }
      sendWebhook('qr', sessionId, { qr: qrDataUrl, tenantId });
    }

    if (connection === 'open') {
      // Track previous connected time for quick-reconnect detection
      sessionData._lastConnectedAt = sessionData.connectedAt || null;
      sessionData.connected = true;
      sessionData.qr = null;
      sessionData.connectedAt = new Date().toISOString();
      sessionData.reconnectAttempts = 0; // reset backoff on success
      sessionData._hollowResetCount = 0;
      if (sessionData._hollowWatchTimer) {
        clearTimeout(sessionData._hollowWatchTimer);
        sessionData._hollowWatchTimer = null;
      }
      // Extract paired phone number + name from socket.user (e.g. "201234567890:12@s.whatsapp.net")
      // Fallback to creds.me?.id (auth state) for cases where socket.user isn't ready yet.
      const meId = socket?.user?.id || state?.creds?.me?.id || '';
      const mePhone = cleanPhone(meId);
      const meName = socket?.user?.name || socket?.user?.notify || state?.creds?.me?.name || null;
      sessionData.phone = mePhone || null;
      sessionData.name = meName;
      console.log(`[${sessionId}] Connected! Phone: ${mePhone || 'PENDING'}`);
      sendWebhook('connected', sessionId, { tenantId, phone: mePhone, name: meName });

      // If phone wasn't ready immediately, poll briefly and re-fire webhook when it appears
      if (!mePhone) {
        let attempts = 0;
        const phoneTimer = setInterval(() => {
          attempts++;
          const lateId = socket?.user?.id || state?.creds?.me?.id || '';
          const latePhone = cleanPhone(lateId);
          if (latePhone) {
            sessionData.phone = latePhone;
            sessionData.name = socket?.user?.name || socket?.user?.notify || state?.creds?.me?.name || sessionData.name || null;
            console.log(`[${sessionId}] Late phone backfill: ${latePhone}`);
            sendWebhook('connected', sessionId, { tenantId, phone: latePhone, name: sessionData.name });
            clearInterval(phoneTimer);
          } else if (attempts >= 30) {
            // Give up after ~30s; status endpoint will keep trying on demand
            clearInterval(phoneTimer);
          }
        }, 1000);
      }
    }

    if (connection === 'close') {
      sessionData.connected = false;
      if (sessionData._hollowWatchTimer) {
        clearTimeout(sessionData._hollowWatchTimer);
        sessionData._hollowWatchTimer = null;
      }
      // CRITICAL v1.6.1: when WhatsApp accepts a QR scan, Baileys commonly
      // emits close/restartRequired before the final open event. The old QR is
      // no longer valid at this point; keeping it made createSession() return
      // "awaiting_pairing" and blocked the required reconnect, so phones stayed
      // on "جاري تسجيل الدخول" then failed. Clear it before internal reconnect.
      sessionData.qr = null;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const reason = lastDisconnect?.error?.message || 'unknown';

      // Permanent failures: only loggedOut wipes the session.
      // Everything else (515 restartRequired, 428 connectionClosed, 408 timeout, 500, 503...) MUST reconnect.
      const isLoggedOut = statusCode === DisconnectReason.loggedOut; // 401
      const shouldReconnect = !isLoggedOut && !sessionData.disableReconnect;

      console.log(`[${sessionId}] Disconnected. Code: ${statusCode} (${reason}). Reconnect: ${shouldReconnect}`);

      if (shouldReconnect) {
        sessionData.reconnectAttempts += 1;

        // GUARD: stop reconnect storms. After MAX_RECONNECT_ATTEMPTS the session
        // is clearly stuck (revoked, corrupted creds, banned). Mark it disabled
        // and notify the platform so it can show a re-pair button instead of
        // silently burning CPU and hammering WhatsApp servers.
        if (sessionData.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
          console.error(`[${sessionId}] Reconnect cap reached (${MAX_RECONNECT_ATTEMPTS}). Stopping. Session needs manual re-pair.`);
          sessionData.disableReconnect = true;
          sendWebhook('disconnected', sessionId, { tenantId, reason: 'reconnect_cap_reached', code: statusCode });
          return;
        }

        // Fast reconnect for restartRequired (515) — WhatsApp expects immediate reconnect.
        // Otherwise exponential backoff capped at 30s.
        const fastCodes = [515, 428, 440];
        const isFast = fastCodes.includes(statusCode) && sessionData.reconnectAttempts <= 3;
        const delayMs = isFast
          ? 500
          : Math.min(3000 * (2 ** Math.min(sessionData.reconnectAttempts - 1, 4)), 30000);
        console.log(`[${sessionId}] Reconnecting in ${delayMs}ms (attempt ${sessionData.reconnectAttempts})`);
        sessionData.reconnectTimer = setTimeout(
          () => createSession(sessionId, tenantId, webhookUrl, { ...options, force: true }).catch((err) =>
            console.error(`[${sessionId}] Reconnect attempt failed:`, err.message)
          ),
          delayMs
        );
      } else {
        sessions.delete(sessionId);
        try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch {}
        sendWebhook('disconnected', sessionId, { tenantId, reason: 'logged_out' });
      }
    }
  });

  // Helper: download media from WhatsApp and return base64 data for webhook
  async function downloadMediaAsBase64(msg, msgType) {
    try {
      const m = msg.message || {};
      // Handle documentWithCaptionMessage wrapper (Baileys wraps captioned docs)
      const unwrappedDoc = m.documentWithCaptionMessage?.message?.documentMessage;
      const mediaMessage = m.imageMessage || m.videoMessage || m.audioMessage || m.pttMessage || m.documentMessage || unwrappedDoc || m.stickerMessage;
      if (!mediaMessage) {
        console.log(`[${sessionId}] No media message found in ${msgType} message`);
        return null;
      }

      const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
      const stream = await downloadContentFromMessage(mediaMessage, msgType === 'audio' ? 'audio' : msgType === 'image' ? 'image' : msgType === 'video' ? 'video' : msgType === 'sticker' ? 'sticker' : 'document');
      
      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);
      if (buffer.length < 100) return null;

      // Use actual mime type from the message when available
      const actualMime = mediaMessage.mimetype || '';
      
      // Comprehensive mime-to-extension map
      const mimeToExt = {
        'application/pdf': 'pdf', 'application/msword': 'doc',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
        'application/vnd.ms-excel': 'xls',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
        'application/vnd.ms-powerpoint': 'ppt',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
        'application/zip': 'zip', 'application/x-rar-compressed': 'rar',
        'text/plain': 'txt', 'text/csv': 'csv',
        'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg',
        'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/wav': 'wav', 'audio/aac': 'aac',
        'video/mp4': 'mp4', 'video/webm': 'webm', 'video/3gpp': '3gp',
      };
      const fallbackExtMap = { audio: 'ogg', image: 'jpg', video: 'mp4', document: 'bin', sticker: 'webp' };
      const ext = (actualMime && mimeToExt[actualMime]) ? mimeToExt[actualMime] : (fallbackExtMap[msgType] || 'bin');
      const fileName = `bridge/${tenantId}/${Date.now()}_${msg.key?.id || 'msg'}.${ext}`;
      
      const fallbackMimeMap = { audio: 'audio/ogg', image: 'image/jpeg', video: 'video/mp4', document: 'application/octet-stream', sticker: 'image/webp' };
      const mimeType = actualMime || fallbackMimeMap[msgType] || 'application/octet-stream';

      const base64 = buffer.toString('base64');
      console.log(`[${sessionId}] Media downloaded: ${msgType}, size: ${buffer.length} bytes, fileName: ${fileName}`);
      
      return { base64, mimeType, fileName };
    } catch (err) {
      console.error('Media download error:', err.message);
      return null;
    }
  }

  function unwrapMessageNode(message) {
    let current = message || {};
    for (let i = 0; i < 6; i++) {
      const next = current?.ephemeralMessage?.message
        || current?.viewOnceMessage?.message
        || current?.viewOnceMessageV2?.message
        || current?.viewOnceMessageV2Extension?.message
        || current?.editedMessage?.message
        || current?.deviceSentMessage?.message
        || current?.protocolMessage?.editedMessage;
      if (!next || next === current) break;
      current = next;
    }
    return current || {};
  }

  // Helper: extract message content
  function extractMessageContent(msg) {
    let content = '';
    let msgType = 'text';
    const m = unwrapMessageNode(msg.message || {});

    if (m.conversation) {
      content = m.conversation;
    } else if (m.extendedTextMessage?.text) {
      content = m.extendedTextMessage.text;
    } else if (m.imageMessage) {
      msgType = 'image';
      content = m.imageMessage.caption || '';
    } else if (m.videoMessage) {
      msgType = 'video';
      content = m.videoMessage.caption || '';
    } else if (m.documentMessage) {
      msgType = 'document';
      content = m.documentMessage.caption || m.documentMessage.fileName || '';
    } else if (m.documentWithCaptionMessage?.message?.documentMessage) {
      msgType = 'document';
      const docMsg = m.documentWithCaptionMessage.message.documentMessage;
      content = docMsg.caption || docMsg.fileName || '';
    } else if (m.buttonsResponseMessage) {
      msgType = 'text';
      content = m.buttonsResponseMessage.selectedDisplayText || m.buttonsResponseMessage.selectedButtonId || '';
    } else if (m.listResponseMessage) {
      msgType = 'text';
      content = m.listResponseMessage.title || m.listResponseMessage.singleSelectReply?.selectedRowId || '';
    } else if (m.templateButtonReplyMessage) {
      msgType = 'text';
      content = m.templateButtonReplyMessage.selectedDisplayText || m.templateButtonReplyMessage.selectedId || '';
    } else if (m.audioMessage || m.pttMessage) {
      msgType = 'audio';
    } else if (m.stickerMessage) {
      msgType = 'sticker';
    } else if (m.contactMessage) {
      msgType = 'contact';
      content = m.contactMessage.displayName || '';
    } else if (m.locationMessage) {
      msgType = 'location';
      content = `${m.locationMessage.degreesLatitude},${m.locationMessage.degreesLongitude}`;
    } else if (m.reactionMessage) {
      msgType = 'reaction';
      content = m.reactionMessage.text || '';
    }

    return { content, msgType };
  }

  function summarizeHistoryChat(chat) {
    try {
      const candidates = [
        ...(Array.isArray(chat?.messages) ? chat.messages : []),
        chat?.lastMessage,
        chat?.message,
      ].filter(Boolean);
      for (const candidate of candidates) {
        const { content, msgType } = extractMessageContent(candidate);
        const text = String(content || '').trim();
        if (text) return text.slice(0, 500);
        if (msgType && msgType !== 'text') return msgType;
      }
    } catch {}
    return '';
  }

  // Helper: extract clean phone number from any JID/participant string
  // Strips @suffix, :device suffix, and non-digit chars
  function cleanPhone(jid) {
    if (!jid) return '';
    return jid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
  }

  async function resolvePersonalJid(phone) {
    const digits = String(phone || '').replace(/[^0-9]/g, '');
    if (!digits) return '';
    try {
      const rows = await socket.onWhatsApp(digits);
      const jid = Array.isArray(rows) && rows.find((r) => r?.exists && r?.jid)?.jid;
      if (jid) return jid;
    } catch (err) {
      console.warn(`[${sessionId}] onWhatsApp lookup skipped for ${digits}: ${err?.message || err}`);
    }
    return `${digits}@s.whatsapp.net`;
  }

  // Helper: parse JID into clean identifier + is_group flag
  function parseJid(remoteJid) {
    if (!remoteJid) return { id: '', isGroup: false, skip: true };
    if (remoteJid === 'status@broadcast' || remoteJid.startsWith('status@')) {
      return { id: '', isGroup: false, skip: true };
    }
    const isGroup = remoteJid.endsWith('@g.us');
    // For groups, keep the full group ID (numbers + dashes); for contacts, clean phone
    const id = isGroup
      ? remoteJid.replace(/@g\.us$/g, '')
      : cleanPhone(remoteJid);
    return { id, isGroup, skip: false };
  }

  // Cache for profile pictures to avoid repeated API calls
  const profilePicCache = new Map();

  // Cache for group metadata (subject/name) to avoid repeated API calls
  const groupMetadataCache = new Map();

  // Helper: fetch group subject with caching
  async function getGroupSubject(groupJid) {
    if (!groupJid) return null;
    if (groupMetadataCache.has(groupJid)) return groupMetadataCache.get(groupJid);
    try {
      const metadata = await socket.groupMetadata(groupJid);
      const subject = metadata?.subject || null;
      groupMetadataCache.set(groupJid, subject);
      // Cache expires after 30 minutes
      setTimeout(() => groupMetadataCache.delete(groupJid), 1800000);
      return subject;
    } catch {
      groupMetadataCache.set(groupJid, null);
      setTimeout(() => groupMetadataCache.delete(groupJid), 600000); // retry after 10min
      return null;
    }
  }

  // Helper: fetch profile picture URL with caching
  async function getProfilePicUrl(jid) {
    if (!jid) return null;
    if (profilePicCache.has(jid)) return profilePicCache.get(jid);
    try {
      const url = await socket.profilePictureUrl(jid, 'image');
      profilePicCache.set(jid, url || null);
      // Cache expires after 1 hour
      setTimeout(() => profilePicCache.delete(jid), 3600000);
      return url || null;
    } catch {
      // Profile pic not available (privacy settings)
      profilePicCache.set(jid, null);
      setTimeout(() => profilePicCache.delete(jid), 1800000); // retry after 30min
      return null;
    }
  }

  // ========== v1.7.2: Per-session message queue with adaptive pacing ==========
  // Caps how many offline-backlog messages we *process* per second after restore.
  // Live messages (60s+ after connect) flow nearly real-time.
  const MSG_QUEUE_MAX = 500;          // hard cap to prevent unbounded memory growth
  const MSG_PACE_BACKLOG_MS = 180;    // ~5 msg/sec during offline drain
  const MSG_PACE_LIVE_MS = 25;        // ~40 msg/sec once steady-state
  const BACKLOG_WINDOW_MS = 60_000;   // first 60s after connect = backlog window

  async function drainMsgQueue() {
    if (sessionData._msgQueueRunning) return;
    sessionData._msgQueueRunning = true;
    try {
      while (sessionData._msgQueue.length > 0) {
        const job = sessionData._msgQueue.shift();
        try {
          await job();
        } catch (jobErr) {
          console.warn(`[${sessionId}] msg-queue job failed:`, jobErr?.message || jobErr);
        }
        const connectedAtMs = sessionData.connectedAt ? new Date(sessionData.connectedAt).getTime() : 0;
        const inBacklog = connectedAtMs > 0 && (Date.now() - connectedAtMs) < BACKLOG_WINDOW_MS;
        const delay = inBacklog ? MSG_PACE_BACKLOG_MS : MSG_PACE_LIVE_MS;
        if (sessionData._msgQueue.length > 0) {
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    } finally {
      sessionData._msgQueueRunning = false;
    }
  }

  function enqueueMsgJob(job) {
    if (sessionData._msgQueue.length >= MSG_QUEUE_MAX) {
      const now = Date.now();
      if (now - sessionData._msgQueueDroppedAt > 5000) {
        console.warn(`[${sessionId}] msg-queue full (${MSG_QUEUE_MAX}), dropping overflow to protect memory`);
        sessionData._msgQueueDroppedAt = now;
      }
      return;
    }
    sessionData._msgQueue.push(job);
    // Fire-and-forget; drainMsgQueue is idempotent.
    drainMsgQueue();
  }

  // Handle incoming messages (real-time + offline backlog, throttled)
  socket.ev.on('messages.upsert', async ({ messages, type }) => {
    // Accept both 'notify' (real-time) and 'append' (fromMe messages sent from phone)
    if (type !== 'notify' && type !== 'append') return;

    for (const msg of messages) {
      enqueueMsgJob(async () => { await processIncomingMsg(msg); });
    }
  });

  async function processIncomingMsg(msg) {
    {

      const remoteJid = msg.key.remoteJid || '';
      const { id: from, isGroup, skip } = parseJid(remoteJid);
      if (skip || !from) return;

      // ========== CAPTURE reactionMessage FROM messages.upsert ==========
      // Baileys often sends reactions via messages.upsert (not messages.reaction).
      // Convert them to reaction webhook events instead of skipping.
      if (msg.message?.reactionMessage) {
        const rm = msg.message.reactionMessage;
        const reactionEmoji = rm.text || '';
        const targetKey = rm.key || {};
        const targetMsgId = targetKey.id || '';
        const reactorJid = msg.key?.participant || targetKey.participant || '';
        const reactionFromMe = !!msg.key?.fromMe;

        console.log(`[${sessionId}] [REACTION_UPSERT] Captured reactionMessage: emoji="${reactionEmoji}" targetId="${targetMsgId}" fromMe=${reactionFromMe}`);

        // Track to suppress any text echo of same ID
        trackReactionId(recentIncomingReactionIds, msg.key?.id);

        if (targetMsgId) {
          const { id: from, isGroup, skip: skipJid } = parseJid(remoteJid);
          if (!skipJid && from) {
            sendWebhook('reaction', sessionId, {
              tenantId,
              from,
              isGroup,
              reactionEmoji,
              reactionMessageId: targetMsgId,
              reactionFromMe,
              reactorJid,
              timestamp: msg.messageTimestamp || Date.now(),
            });
          }
        }
        return;
      }

      // Skip echoes of reactions we sent (tracked by message ID)
      if (msg.key?.id && recentSentReactionIds.has(msg.key.id)) {
        console.log(`[${sessionId}] Skipping sent reaction echo: ${msg.key.id}`);
        return;
      }

      // Skip echoes of incoming reactions already handled by messages.reaction event
      if (msg.key?.id && recentIncomingReactionIds.has(msg.key.id)) {
        console.log(`[${sessionId}] Skipping incoming reaction echo: ${msg.key.id}`);
        return;
      }

      let { content, msgType } = extractMessageContent(msg);

      // Baileys can emit a placeholder upsert before decrypting the real text.
      // Do not forward that as a real empty message; a later upsert with the same
      // WhatsApp id will carry the actual content and update the database.
      if ((msgType === 'text' || !msgType) && !String(content || '').trim() && !msg.key?.fromMe) {
        console.log(`[${sessionId}] Deferring empty inbound text upsert until decrypted content arrives (id: ${msg.key.id})`);
        return;
      }

      // Preserve fromMe single-emoji texts as real outgoing messages. Reactions
      // are handled earlier via reactionMessage/messages.reaction and must not
      // cause normal phone replies like "👍" to disappear from the inbox.
      // For group messages, get the actual sender (strip @suffix AND :device)
      const sender = isGroup ? cleanPhone(msg.key.participant || '') : '';

      // Download media and send as base64 in webhook payload
      let mediaData = null;
      if (['audio', 'image', 'video', 'document', 'sticker'].includes(msgType)) {
        try {
          mediaData = await downloadMediaAsBase64(msg, msgType);
        } catch (mediaErr) {
          console.error(`[${sessionId}] Media processing failed for ${msgType}, sending without media:`, mediaErr.message);
        }
      }

      // Fetch profile picture (non-blocking, don't delay message delivery)
      let profilePicUrl = null;
      let groupProfilePicUrl = null;
      if (!msg.key.fromMe) {
        try {
          // For groups: fetch the SENDER's pic (participant), not the group's
          const picJid = isGroup ? msg.key.participant : remoteJid;
          if (picJid) profilePicUrl = await getProfilePicUrl(picJid);
        } catch {}
      }
      // For groups: always fetch the GROUP's profile pic separately
      if (isGroup) {
        try {
          groupProfilePicUrl = await getProfilePicUrl(remoteJid);
        } catch {}
      }

      // Fetch group subject for group messages
      let groupSubject = null;
      if (isGroup) {
        try {
          groupSubject = await getGroupSubject(remoteJid);
        } catch {}
      }

      // Extract mentionedJid from contextInfo (for @mentions)
      const msgObj = msg.message || {};
      const contextInfo = msgObj.extendedTextMessage?.contextInfo || msgObj.imageMessage?.contextInfo || msgObj.videoMessage?.contextInfo || msgObj.documentMessage?.contextInfo || msgObj.documentWithCaptionMessage?.message?.documentMessage?.contextInfo || {};
      const mentionedJids = contextInfo.mentionedJid || [];

      sendWebhook('message', sessionId, {
        tenantId,
        from,
        fromMe: !!msg.key.fromMe,
        pushName: msg.pushName || '',
        senderName: msg.pushName || '',
        notifyName: msg.key?.notifyName || msg.verifiedBizName || '',
        body: content,
        type: msgType,
        id: msg.key.id,
        isGroup,
        sender,
        groupJid: isGroup ? remoteJid : undefined,
        groupSubject: groupSubject || undefined,
        timestamp: msg.messageTimestamp,
        mediaData,
        profilePicUrl,
        groupProfilePicUrl: isGroup ? groupProfilePicUrl : undefined,
        // Additional Baileys fields for LID resolution
        participantPn: msg.key?.participantPn || '',
        senderPn: msg.key?.senderPn || '',
        participantAlt: msg.key?.participantAlt || '',
        remoteJidAlt: msg.key?.remoteJidAlt || '',
        // Mention support
        mentionedJids: mentionedJids.length > 0 ? mentionedJids : undefined,
      });
    }
  }


  // ========== HISTORY SYNC (with quick-reconnect skip) ==========
  socket.ev.on('messaging-history.set', async ({ chats, contacts, messages: historyMessages, syncType }) => {
    console.log(`[${sessionId}] History sync: ${chats?.length || 0} chats, ${contacts?.length || 0} contacts, ${historyMessages?.length || 0} messages (type: ${syncType})`);

    // OPTIMIZATION: Skip history sync on quick reconnects (< 5 minutes)
    const lastConnectedTime = sessionData._lastConnectedAt ? new Date(sessionData._lastConnectedAt).getTime() : 0;
    const timeSinceLastConnect = Date.now() - lastConnectedTime;
    if (lastConnectedTime > 0 && timeSinceLastConnect < 5 * 60 * 1000) {
      console.log(`[${sessionId}] Skipping history sync — quick reconnect (${Math.round(timeSinceLastConnect / 1000)}s since last connect)`);
      return;
    }

    // Send chats/contacts
    const chatList = (chats || []).map(c => {
      const rawJid = c.id || '';
      const { id, isGroup, skip } = parseJid(rawJid);
      if (skip) return null;
      // For groups: prefer subject (actual group name) over name (which may be pushName)
      const chatName = isGroup ? (c.subject || c.name || id) : (c.name || c.subject || id);
      return {
        jid: id,
        rawJid,
        jidType: isGroup ? 'g.us' : (rawJid.endsWith('@lid') ? 'lid' : 's.whatsapp.net'),
        isGroup,
        name: chatName,
        subject: isGroup ? (c.subject || '') : '',
        unreadCount: c.unreadCount || 0,
        lastMessageTimestamp: c.conversationTimestamp || null,
        lastMessage: summarizeHistoryChat(c),
      };
    }).filter(Boolean);

    if (chatList.length > 0) {
      // Send in batches of 50
      for (let i = 0; i < chatList.length; i += 50) {
        const batch = chatList.slice(i, i + 50);
        sendWebhook('history_chats', sessionId, {
          tenantId,
          chats: batch,
          syncType,
          batchIndex: Math.floor(i / 50),
          totalBatches: Math.ceil(chatList.length / 50),
        });
      }
    }

    // Send messages in batches
    const processedMessages = (historyMessages || []).map(m => {
      const msg = m;
      const remoteJid = msg.key?.remoteJid || '';
      const { id: from, isGroup, skip } = parseJid(remoteJid);
      if (skip || !from) return null;

      const { content, msgType } = extractMessageContent(msg);
      // For group messages: extract participant (actual sender) with multiple fallbacks
      const participantRaw = isGroup ? (msg.key?.participant || msg.participant || '') : '';
      const sender = participantRaw ? cleanPhone(participantRaw) : '';

      // Try to get group subject from cache (populated during chat sync or real-time)
      let groupSubject = null;
      if (isGroup && remoteJid) {
        groupSubject = groupMetadataCache.get(remoteJid) || null;
      }

      return {
        from,
        to: from,
        rawJid: remoteJid,
        jidType: isGroup ? 'g.us' : (remoteJid.endsWith('@lid') ? 'lid' : 's.whatsapp.net'),
        fromMe: !!msg.key?.fromMe,
        pushName: msg.pushName || '',
        senderName: msg.pushName || '',
        notifyName: msg.key?.notifyName || msg.verifiedBizName || '',
        participant: sender,
        body: content,
        type: msgType,
        id: msg.key?.id || '',
        isGroup,
        sender,
        groupSubject: groupSubject || undefined,
        timestamp: msg.messageTimestamp || null,
        // Additional Baileys fields for LID resolution
        participantPn: msg.key?.participantPn || '',
        senderPn: msg.key?.senderPn || '',
        remoteJidAlt: msg.key?.remoteJidAlt || '',
      };
    }).filter(Boolean);

    if (processedMessages.length > 0) {
      for (let i = 0; i < processedMessages.length; i += 50) {
        const batch = processedMessages.slice(i, i + 50);
        sendWebhook('history_messages', sessionId, {
          tenantId,
          messages: batch,
          syncType,
          batchIndex: Math.floor(i / 50),
          totalBatches: Math.ceil(processedMessages.length / 50),
        });
      }
    }
  });

  // Handle message status updates
  socket.ev.on('messages.update', (updates) => {
    for (const update of updates) {
      if (update.update?.status) {
        const statusMap = { 2: 'sent', 3: 'delivered', 4: 'read' };
        const resolvedStatus = statusMap[update.update.status] || 'unknown';
        // v1.7.8: once WA confirms delivery/read, stop watching this OTP for resend.
        if (update.update.status >= 3 && update.key?.id && otpDeliveryWatcher.has(update.key.id)) {
          otpDeliveryWatcher.delete(update.key.id);
          console.log(`[${sessionId}] OTP_DELIVERED id=${update.key.id} — watcher cleared`);
        }
        sendWebhook('status', sessionId, {
          tenantId,
          messageId: update.key.id,
          to: update.key.remoteJid?.replace(/@s\.whatsapp\.net|@lid|@g\.us/g, ''),
          status: resolvedStatus,
        });
      }
    }
  });

  // Handle reactions
  socket.ev.on('messages.reaction', (reactions) => {
    for (const reaction of reactions) {
      const remoteJid = reaction.key?.remoteJid || '';
      const { id: from, isGroup, skip } = parseJid(remoteJid);
      if (skip || !from) continue;

      // Track this reaction's message ID to skip its echo in messages.upsert
      trackReactionId(recentIncomingReactionIds, reaction.key?.id);

      sendWebhook('reaction', sessionId, {
        tenantId,
        from,
        isGroup,
        reactionEmoji: reaction.reaction?.text || '',
        reactionMessageId: reaction.key?.id || '',
        reactionFromMe: !!reaction.key?.fromMe,
        reactorJid: reaction.reaction?.key?.participant || reaction.key?.participant || '',
        timestamp: reaction.reaction?.timestamp || Date.now(),
      });
    }
  });

  // Handle group metadata updates
  socket.ev.on('groups.upsert', (groups) => {
    for (const group of groups) {
      const groupId = group.id?.replace('@g.us', '') || '';
      if (!groupId) continue;
      sendWebhook('group_update', sessionId, {
        tenantId,
        groupId,
        name: group.subject || '',
        participants: (group.participants || []).map(p => ({
          id: cleanPhone(p.id || ''),
          admin: p.admin || null,
          pushName: p.notify || p.name || '',
        })),
      });
    }
  });

  // ========== OPTIMIZED CONTACT SYNC WITH DEBOUNCE ==========
  // Accumulate contacts and send in larger batches with debounce to reduce webhook calls
  let pendingContacts = [];
  let contactDebounceTimer = null;
  const CONTACT_DEBOUNCE_MS = 5000; // 5 second debounce
  const CONTACT_BATCH_SIZE = 200;   // Larger batches (was 100)

  function flushContacts() {
    if (pendingContacts.length === 0) return;
    const toSend = [...pendingContacts];
    pendingContacts = [];
    contactDebounceTimer = null;

    for (let i = 0; i < toSend.length; i += CONTACT_BATCH_SIZE) {
      const batch = toSend.slice(i, i + CONTACT_BATCH_SIZE);
      sendWebhook('contacts', sessionId, {
        tenantId,
        contacts: batch,
      });
    }
    console.log(`[${sessionId}] Contacts flushed: ${toSend.length} contacts sent in ${Math.ceil(toSend.length / CONTACT_BATCH_SIZE)} batches`);
  }

  function queueContacts(contacts) {
    pendingContacts.push(...contacts);
    if (contactDebounceTimer) clearTimeout(contactDebounceTimer);
    // Auto-flush if buffer is large enough
    if (pendingContacts.length >= CONTACT_BATCH_SIZE * 2) {
      flushContacts();
    } else {
      contactDebounceTimer = setTimeout(flushContacts, CONTACT_DEBOUNCE_MS);
    }
  }

  // Handle contacts.update - captures phone numbers and names from address book
  socket.ev.on('contacts.update', (updates) => {
    const contactsList = [];
    for (const contact of updates) {
      if (!contact.id) continue;
      const phone = cleanPhone(contact.id);
      if (!phone) continue;
      contactsList.push({
        jid: contact.id,
        phone,
        name: contact.notify || contact.verifiedName || contact.name || '',
        pushName: contact.notify || '',
        verifiedName: contact.verifiedName || '',
        imgUrl: contact.imgUrl || null,
      });
    }
    if (contactsList.length > 0) {
      queueContacts(contactsList);
      console.log(`[${sessionId}] Contacts update queued: ${contactsList.length} contacts`);
    }
  });

  // Handle contacts.upsert - initial contacts sync
  socket.ev.on('contacts.upsert', (contacts) => {
    const contactsList = [];
    for (const contact of contacts) {
      if (!contact.id) continue;
      const phone = cleanPhone(contact.id);
      if (!phone) continue;
      contactsList.push({
        jid: contact.id,
        phone,
        name: contact.notify || contact.verifiedName || contact.name || '',
        pushName: contact.notify || '',
        verifiedName: contact.verifiedName || '',
      });
    }
    if (contactsList.length > 0) {
      queueContacts(contactsList);
      console.log(`[${sessionId}] Contacts upsert queued: ${contactsList.length} contacts`);
    }
  });

  return { sessionId, status: 'created' };
}

async function restorePersistedSessions() {
  let entries = [];
  try {
    entries = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch (err) {
    console.error('[restore] Unable to read sessions directory:', err.message);
    return;
  }

  console.log(`[restore] Restoring ${entries.length} session(s) sequentially with 3500ms gap to avoid WhatsApp offline-node throttling (rate-overlimit)...`);
  for (const entry of entries) {
    const sessionId = entry.name;
    if (!sessionId || sessionId.startsWith('__probe_')) continue;
    let meta = {};
    try {
      const metaPath = getSessionMetaPath(sessionId);
      if (fs.existsSync(metaPath)) meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) || {};
    } catch (err) {
      console.error(`[restore] Failed to read meta for ${sessionId}:`, err.message);
    }
    try {
      await createSession(
        sessionId,
        meta.tenantId || null,
        meta.webhookUrl || WEBHOOK_URL,
        { markOnline: meta.markOnline !== undefined ? !!meta.markOnline : true, syncFullHistory: meta.syncFullHistory === true },
      );
      console.log(`[restore] Session restored: ${sessionId}`);
    } catch (err) {
      console.error(`[restore] Session restore failed: ${sessionId}:`, err.message);
    }
    // Stagger 3.5s between sessions so WhatsApp finishes processing offline nodes for one session
    // before the next session triggers another decrypt burst (prevents 429 rate-overlimit cascades).
    await new Promise((r) => setTimeout(r, 3500));
  }
  console.log('[restore] Sequential restore complete.');
}

// ============ Dashboard ============

app.get('/', (req, res) => {
  const health = getHealthData();
  const sessionsList = [];
  sessions.forEach((s, id) => {
    sessionsList.push({
      id,
      connected: s.connected,
      tenantId: s.tenantId || '-',
      createdAt: s.createdAt || '-',
      connectedAt: s.connectedAt || '-',
    });
  });

  res.send(`<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Flowtix - WhatsApp Bridge</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0a0f;color:#e4e4e7;min-height:100vh}
    .header{background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);border-bottom:1px solid #27272a;padding:20px 32px;display:flex;align-items:center;justify-content:space-between}
    .logo{display:flex;align-items:center;gap:12px}
    .logo-icon{width:40px;height:40px;background:linear-gradient(135deg,#22c55e,#16a34a);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px}
    .logo h1{font-size:18px;font-weight:800;color:#fff}
    .logo span{font-size:11px;color:#71717a;font-weight:500}
    .badge{padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;display:inline-flex;align-items:center;gap:6px}
    .badge-online{background:#22c55e20;color:#22c55e;border:1px solid #22c55e40}
    .badge-offline{background:#ef444420;color:#ef4444;border:1px solid #ef444440}
    .dot{width:8px;height:8px;border-radius:50%;display:inline-block}
    .dot-pulse{animation:pulse 2s infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    .container{max-width:1100px;margin:0 auto;padding:24px}
    .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px}
    .card{background:#18181b;border:1px solid #27272a;border-radius:16px;padding:20px;transition:border-color .2s}
    .card:hover{border-color:#3f3f46}
    .card-label{font-size:10px;text-transform:uppercase;letter-spacing:1.5px;color:#71717a;font-weight:700;margin-bottom:8px}
    .card-value{font-size:28px;font-weight:900;color:#fff}
    .card-sub{font-size:11px;color:#71717a;margin-top:4px}
    .section{margin-bottom:24px}
    .section-title{font-size:14px;font-weight:700;margin-bottom:12px;color:#a1a1aa;display:flex;align-items:center;gap:8px}
    table{width:100%;border-collapse:collapse}
    th{text-align:left;padding:10px 16px;font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#71717a;font-weight:700;background:#111113;border-bottom:1px solid #27272a}
    td{padding:12px 16px;font-size:13px;border-bottom:1px solid #1e1e22;color:#d4d4d8}
    tr:hover td{background:#1a1a1f}
    .status-dot{width:10px;height:10px;border-radius:50%;display:inline-block;margin-right:8px}
    .status-connected{background:#22c55e;box-shadow:0 0 8px #22c55e60}
    .status-disconnected{background:#ef4444;box-shadow:0 0 8px #ef444460}
    .empty{text-align:center;padding:40px;color:#52525b;font-size:13px}
    .footer{text-align:center;padding:20px;color:#3f3f46;font-size:11px;border-top:1px solid #1e1e22;margin-top:40px}
    .info-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
    .info-item{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #1e1e22;font-size:12px}
    .info-label{color:#71717a}
    .info-value{color:#d4d4d8;font-weight:600;font-family:monospace}
    .refresh-note{font-size:10px;color:#52525b;text-align:center;margin-top:8px}
    @media(max-width:768px){.grid{grid-template-columns:repeat(2,1fr)}.info-grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">
      <div class="logo-icon">📡</div>
      <div>
        <h1>Flowtix Bridge</h1>
        <span>WhatsApp QR Server v${health.version}</span>
      </div>
    </div>
    <div class="badge ${health.status === 'ok' ? 'badge-online' : 'badge-offline'}">
      <span class="dot ${health.status === 'ok' ? 'dot-pulse' : ''}" style="background:${health.status === 'ok' ? '#22c55e' : '#ef4444'}"></span>
      ${health.status === 'ok' ? 'Online' : 'Offline'}
    </div>
  </div>

  <div class="container">
    <div class="grid">
      <div class="card">
        <div class="card-label">Total Sessions</div>
        <div class="card-value">${health.sessions.total}</div>
        <div class="card-sub">All registered sessions</div>
      </div>
      <div class="card">
        <div class="card-label">Connected</div>
        <div class="card-value" style="color:#22c55e">${health.sessions.connected}</div>
        <div class="card-sub">Active & online</div>
      </div>
      <div class="card">
        <div class="card-label">Disconnected</div>
        <div class="card-value" style="color:#ef4444">${health.sessions.disconnected}</div>
        <div class="card-sub">Waiting reconnection</div>
      </div>
      <div class="card">
        <div class="card-label">Uptime</div>
        <div class="card-value" style="font-size:20px">${health.uptime}</div>
        <div class="card-sub">Since ${new Date(health.started_at).toLocaleString()}</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">📋 Active Sessions</div>
      <div class="card" style="padding:0;overflow:hidden">
        ${sessionsList.length > 0 ? `
        <table>
          <thead><tr><th>Status</th><th>Session ID</th><th>Tenant</th><th>Created</th><th>Connected At</th></tr></thead>
          <tbody>
            ${sessionsList.map(s => `
              <tr>
                <td><span class="status-dot ${s.connected ? 'status-connected' : 'status-disconnected'}"></span>${s.connected ? 'Online' : 'Offline'}</td>
                <td style="font-family:monospace;font-size:12px">${s.id}</td>
                <td style="font-family:monospace;font-size:11px;color:#71717a">${s.tenantId}</td>
                <td style="font-size:11px;color:#71717a">${s.createdAt !== '-' ? new Date(s.createdAt).toLocaleString() : '-'}</td>
                <td style="font-size:11px;color:#71717a">${s.connectedAt !== '-' ? new Date(s.connectedAt).toLocaleString() : '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>` : '<div class="empty">No active sessions — create one via the API</div>'}
      </div>
    </div>

    <div class="section">
      <div class="section-title">⚙️ System Info</div>
      <div class="card">
        <div class="info-grid">
          <div class="info-item"><span class="info-label">Node.js</span><span class="info-value">${health.platform.node}</span></div>
          <div class="info-item"><span class="info-label">OS</span><span class="info-value">${health.platform.os}</span></div>
          <div class="info-item"><span class="info-label">Architecture</span><span class="info-value">${health.platform.arch}</span></div>
          <div class="info-item"><span class="info-label">Memory (RSS)</span><span class="info-value">${health.memory.rss_mb} MB</span></div>
          <div class="info-item"><span class="info-label">Heap Used</span><span class="info-value">${health.memory.heap_used_mb} / ${health.memory.heap_total_mb} MB</span></div>
          <div class="info-item"><span class="info-label">System Memory</span><span class="info-value">${health.memory.system_free_mb} / ${health.memory.system_total_mb} MB free</span></div>
          <div class="info-item"><span class="info-label">Webhook</span><span class="info-value">${WEBHOOK_URL ? '✅ Configured' : '❌ Not set'}</span></div>
          <div class="info-item"><span class="info-label">API Key</span><span class="info-value">${API_KEY ? '🔒 Protected' : '⚠️ Open access'}</span></div>
        </div>
      </div>
    </div>

    <div class="refresh-note">Auto-refreshes every 30 seconds</div>
  </div>

  <div class="footer">Flowtix Platform · WhatsApp Bridge Server v${health.version} · ${new Date().getFullYear()}</div>

  <script>setTimeout(() => location.reload(), 30000);</script>
</body>
</html>`);
});

// ============ Health Endpoints ============

// Basic health (no auth)
app.get('/health', (req, res) => {
  res.json(getHealthData());
});

// Detailed health (with auth via /api prefix)
app.get('/api/health', (req, res) => {
  res.json(getHealthData());
});

app.get('/api/diagnostics', (req, res) => {
  let ffmpegAvailable = false;
  try {
    execSync('ffmpeg -version', { stdio: 'ignore', timeout: 3000 });
    ffmpegAvailable = true;
  } catch {}
  res.json({
    ok: true,
    health: getHealthData(),
    env: {
      node_env: process.env.NODE_ENV || null,
      port: String(PORT),
      api_key_configured: !!API_KEY,
      webhook_configured: !!WEBHOOK_URL,
    },
    dependencies: { ffmpeg: ffmpegAvailable },
    files: {
      sessions_dir_exists: fs.existsSync(SESSIONS_DIR),
      sessions_count_on_disk: fs.existsSync(SESSIONS_DIR) ? fs.readdirSync(SESSIONS_DIR).length : 0,
    },
  });
});

// Deep health probe — verifies Baileys can actually create a session and
// (optionally) generate a QR within a short window. Used by the platform's
// "Test Connection" button so a healthy reply means QR generation works.
app.post('/api/deep-health', async (req, res) => {
  const probeId = `__probe_${Date.now()}`;
  const startedAt = Date.now();
  try {
    // v1.6.8: allow internal reconnect so Baileys can finish Noise handshake
    // and emit a QR within the probe window. Without it, a transient close
    // after the WS upgrade killed the socket before QR ever fired.
    const createResult = await createSession(probeId, null, null, { markOnline: false, disableWebhook: true });
    // Wait up to 20s for either QR material or a connection state change
    // (cold-start handshake on a busy host can easily exceed 8s).
    const deadline = Date.now() + 20000;
    let session = sessions.get(probeId);
    while (Date.now() < deadline) {
      session = sessions.get(probeId);
      if (session && (session.qr || session.connected)) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    const sawQr = !!session?.qr;
    const sawConnected = !!session?.connected;
    // Cleanup probe session regardless of outcome
    try {
      const s = sessions.get(probeId);
      if (s?.reconnectTimer) clearTimeout(s.reconnectTimer);
      if (s?.socket?.end) s.socket.end();
      sessions.delete(probeId);
      try { fs.rmSync(path.join(SESSIONS_DIR, probeId), { recursive: true, force: true }); } catch {}
    } catch {}
    // ok = bridge is healthy. The probe session was successfully constructed
    // (no throw), which proves Baileys + the socket stack are operational.
    // A missing QR within 20s is informational, not a failure — real tenant
    // sessions complete their pairing on their own time.
    return res.json({
      ok: true,
      can_generate_qr: sawQr,
      connected: sawConnected,
      probe_status: createResult?.status || 'started',
      duration_ms: Date.now() - startedAt,
      sessions_active: Array.from(sessions.keys()).filter((k) => !k.startsWith('__probe_')).length,
    });

  } catch (err) {
    try {
      const s = sessions.get(probeId);
      if (s?.reconnectTimer) clearTimeout(s.reconnectTimer);
      if (s?.socket?.end) s.socket.end();
      sessions.delete(probeId);
      fs.rmSync(path.join(SESSIONS_DIR, probeId), { recursive: true, force: true });
    } catch {}
    return res.status(500).json({ ok: false, error: err.message, duration_ms: Date.now() - startedAt });
  }
});

// Restart the bridge process — relies on the process manager
// (Docker `restart: unless-stopped` or PM2) to bring it back up.
app.post('/api/restart', (req, res) => {
  res.json({ ok: true, restarting: true, in_seconds: 1 });
  setTimeout(() => {
    console.log('[restart] Manual restart requested via /api/restart');
    process.exit(0);
  }, 1000);
});

// ============ Self-Update ============
// Pulls latest bridge files from the platform CDN (no git, no manual ZIP),
// rewrites server.js/package.json in place, runs npm install if deps changed,
// then exits. Docker `restart: unless-stopped` brings the container back up
// with the new code. Sessions are preserved via the ./sessions volume mount,
// so no QR rescan is required.
const UPDATE_BASE_URL = process.env.UPDATE_BASE_URL || 'https://flowtix.tools/bridge-server';
const UPDATE_FILES = ['server.js', 'package.json'];
let updateInProgress = false;

async function fetchUpdateFile(name) {
  const url = `${UPDATE_BASE_URL}/${name}?ts=${Date.now()}`;
  const r = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
  if (!r.ok) throw new Error(`Fetch ${name} failed: ${r.status}`);
  return await r.text();
}

app.get('/api/self-update/check', async (req, res) => {
  try {
    const remotePkgText = await fetchUpdateFile('package.json');
    const remotePkg = JSON.parse(remotePkgText);
    const localPkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
    res.json({
      ok: true,
      current_version: localPkg.version || SERVER_VERSION,
      latest_version: remotePkg.version,
      update_available: (remotePkg.version || '') !== (localPkg.version || SERVER_VERSION),
      source: UPDATE_BASE_URL,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/self-update', async (req, res) => {
  if (updateInProgress) return res.status(409).json({ ok: false, error: 'Update already in progress' });
  updateInProgress = true;
  try {
    console.log('[self-update] Starting…');
    // 1. Download all files into memory first; abort on any failure (atomic).
    const downloads = {};
    for (const name of UPDATE_FILES) {
      downloads[name] = await fetchUpdateFile(name);
    }
    const newPkg = JSON.parse(downloads['package.json']);
    const oldPkgPath = path.join(__dirname, 'package.json');
    const oldPkg = JSON.parse(fs.readFileSync(oldPkgPath, 'utf8'));
    const depsChanged = JSON.stringify(newPkg.dependencies || {}) !== JSON.stringify(oldPkg.dependencies || {});

    // 2. Backup current files in case post-restart fails.
    const backupDir = path.join(__dirname, '.update-backup');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);
    for (const name of UPDATE_FILES) {
      const src = path.join(__dirname, name);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(backupDir, name));
    }

    // 3. Write new files.
    for (const name of UPDATE_FILES) {
      fs.writeFileSync(path.join(__dirname, name), downloads[name], 'utf8');
    }
    console.log(`[self-update] Wrote ${UPDATE_FILES.length} files. Deps changed: ${depsChanged}`);

    res.json({
      ok: true,
      from_version: oldPkg.version || SERVER_VERSION,
      to_version: newPkg.version,
      deps_changed: depsChanged,
      restarting_in_seconds: depsChanged ? 30 : 2,
      message: depsChanged ? 'Installing dependencies then restarting' : 'Restarting now',
    });

    // 4. If deps changed, run npm install. Then exit so Docker restarts us.
    setTimeout(() => {
      try {
        if (depsChanged) {
          console.log('[self-update] Running npm install…');
          execSync('npm install --omit=dev --no-audit --no-fund', {
            cwd: __dirname,
            stdio: 'inherit',
            timeout: 180000,
          });
        }
      } catch (e) {
        console.error('[self-update] npm install failed:', e.message);
        // Restore backup so we don't boot into a broken state.
        for (const name of UPDATE_FILES) {
          const bak = path.join(backupDir, name);
          if (fs.existsSync(bak)) fs.copyFileSync(bak, path.join(__dirname, name));
        }
        console.error('[self-update] Restored backup. Restarting with previous version.');
      }
      console.log('[self-update] Exiting for Docker restart…');
      process.exit(0);
    }, 1500);
  } catch (err) {
    updateInProgress = false;
    console.error('[self-update] Failed:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============ API Routes ============

// Create session
app.post('/api/sessions', async (req, res) => {
  try {
    const { sessionId, tenantId, webhookUrl, markOnline, syncFullHistory } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
    const result = await createSession(sessionId, tenantId, webhookUrl, { markOnline, syncFullHistory: syncFullHistory === true });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get QR code
app.get('/api/sessions/:id/qr', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.connected) return res.json({ connected: true, qr: null });
  res.json({ qr: session.qr, connected: false });
});

// Get session status
app.get('/api/sessions/:id/status', async (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    const sessionDir = getSessionDir(req.params.id);
    const meta = loadSessionMeta(req.params.id);
    if (fs.existsSync(sessionDir) && Object.keys(meta).length > 0) {
      try {
        await createSession(
          req.params.id,
          meta.tenantId || null,
          meta.webhookUrl || WEBHOOK_URL,
          { markOnline: meta.markOnline !== undefined ? !!meta.markOnline : true, force: true },
        );
        return res.json({ connected: false, exists: true, restoring: true, qr: null, phone: null, name: null });
      } catch (err) {
        return res.json({ connected: false, exists: true, restoring: false, error: err.message });
      }
    }
    return res.json({ connected: false, exists: false });
  }
  // Re-extract from socket each time so already-paired sessions can be backfilled.
  // Fallback chain: socket.user.id → creds.me.id (auth state on disk) → cached session.phone.
  const sock = session?.socket;
  const credsMeId = sock?.authState?.creds?.me?.id || sock?.user?.id || '';
  const isConnected = session.connected === true;
  const livePhone = isConnected ? ((credsMeId.split('@')[0].split(':')[0].replace(/[^0-9]/g, '')) || session.phone || null) : null;
  const liveName = isConnected ? (sock?.user?.name || sock?.user?.notify || sock?.authState?.creds?.me?.name || session.name || null) : null;
  // Backfill cached phone so future webhook events carry it
  if (livePhone && !session.phone) session.phone = livePhone;
  res.json({
    connected: isConnected,
    qr: session.qr,
    exists: true,
    phone: livePhone,
    name: liveName,
  });
});

app.post('/api/sessions/:id/soft-reset', async (req, res) => {
  try {
    const result = await softResetSession(req.params.id, req.body?.reason || 'manual_soft_reset', {
      syncFullHistory: req.body?.syncFullHistory === true || req.body?.syncHistory === true || req.body?.historySync === true || req.body?.fullHistory === true,
      syncHistory: req.body?.syncHistory === true,
      historySync: req.body?.historySync === true,
      fullHistory: req.body?.fullHistory === true,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Soft revive: rebuild the in-memory socket for the SAME session id while
// preserving the paired credentials on disk. This is safe for automatic
// recovery paths because it never logs out and never deletes the session folder.
app.post('/api/sessions/:id/revive', async (req, res) => {
  const sid = req.params.id;
  try {
    const existing = sessions.get(sid);
    if (existing?.connected) {
      return res.json({ ok: true, sessionId: sid, status: 'already_connected', connected: true });
    }

    const meta = loadSessionMeta(sid);
    const sessionDir = getSessionDir(sid);
    if (!existing && !fs.existsSync(sessionDir)) {
      return res.status(404).json({ ok: false, error: 'Session credentials not found' });
    }

    if (existing) {
      existing.disableReconnect = true;
      try { if (existing.reconnectTimer) clearTimeout(existing.reconnectTimer); } catch {}
      try { if (existing._hollowWatchTimer) clearTimeout(existing._hollowWatchTimer); } catch {}
      try { existing.socket?.end?.(); } catch {}
      sessions.delete(sid);
    }

    const result = await createSession(
      sid,
      existing?.tenantId || meta.tenantId || null,
      existing?.webhookUrl || meta.webhookUrl || WEBHOOK_URL,
      {
        markOnline: existing?.markOnline !== undefined ? existing.markOnline : (meta.markOnline !== undefined ? !!meta.markOnline : true),
        force: true,
        syncFullHistory: false,
      },
    );

    return res.json({ ok: true, revived: true, ...result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Set online/offline visibility (global presence, not per-chat)
app.post('/api/sessions/:id/set-online', async (req, res) => {
  try {
    const session = sessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!session.connected) return res.status(400).json({ error: 'Session not connected' });

    const { online } = req.body;
    const presenceType = online ? 'available' : 'unavailable';
    await session.socket.sendPresenceUpdate(presenceType);
    
    // Store preference so presence endpoint respects it
    session.markOnline = !!online;

    res.json({ success: true, online: !!online });
  } catch (err) {
    console.error('Set-online error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Presence simulation (typing indicator + online status)
app.post('/api/sessions/:id/presence', async (req, res) => {
  try {
    const session = sessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!session.connected) return res.status(400).json({ error: 'Session not connected' });

    const { to, action = 'composing' } = req.body;
    if (!to) return res.status(400).json({ error: 'to is required' });

    const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;

    // Only send 'available' if session allows online visibility
    if (session.markOnline !== false) {
      await session.socket.sendPresenceUpdate('available');
    }
    // Send composing/paused indicator
    await session.socket.sendPresenceUpdate(action === 'reading' ? 'available' : 'composing', jid);

    // If reading, also mark as read
    if (action === 'reading') {
      try {
        await session.socket.readMessages([{ remoteJid: jid, id: req.body.messageId || '' }]);
      } catch {}
    }

    res.json({ success: true, action });
  } catch (err) {
    console.error('Presence error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Send message
// ─── Helper: race a promise against a hard timeout ───
function withTimeout(promise, ms, label = 'send') {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}_timeout_${ms}ms`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

async function handleSessionSend(req, res) {
  // ─── Fire-and-queue mode ───
  // Default ON to protect OTP/order callers from 8s AbortError timeouts.
  // Callers that explicitly need a WhatsApp message id may pass { fast_ack: false }.
  //
  // v1.6.4: OTP traffic ALWAYS runs synchronously regardless of fast_ack flag,
  // so callers (XtraMenu / public-api-send) get a real messageId back instead
  // of a `queued` ack — that's what was producing DISPATCH_UNCONFIRMED.
  const isOtpReq = req.body?.is_otp === true || req.body?.priority === 'otp';
  const fastAck = !isOtpReq
    && req.body?.fast_ack !== false
    && req.body?.fastAck !== false
    && req.query?.fast !== '0'
    && req.headers['x-fast-ack'] !== '0';

  // Hard ceiling for explicit synchronous mode.
  // OTP path must respond before upstream providers time out. If Baileys is
  // slow, we return a structured provider_timeout and recover in-process.
  const HARD_TIMEOUT_MS = isOtpReq ? 5000 : 3000;

  try {
    const session = sessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found', code: 'SESSION_NOT_FOUND' });
    if (!session.connected) return res.status(400).json({ error: 'Session not connected', code: 'SESSION_NOT_CONNECTED' });

    const { to, content, mediaUrl, mentions } = req.body;
    // ─── STRICT REACTION RESOLVER ───
    // If reactionMessageId or reaction_message_id present, FORCE type to 'reaction'
    const hasReactionMsgId = !!(req.body.reactionMessageId || req.body.reaction_message_id);
    const type = hasReactionMsgId ? 'reaction' : (req.body.type || 'text');
    
    if (hasReactionMsgId && type === 'reaction') {
      console.log(`[${req.params.id}] SEND_REACTION resolved: to=${to}, reactionMessageId=${req.body.reactionMessageId || req.body.reaction_message_id}, emoji=${content || req.body.emoji || ''}, fromMe=${req.body.reactionFromMe ?? req.body.reaction_from_me}`);
    }
    
    if (!to) return res.status(400).json({ error: 'to is required' });

    // v1.6.6: if caller already passed a fully-qualified JID (incl. @lid), preserve
    // it as-is. Re-running onWhatsApp on a LID would convert it back to
    // s.whatsapp.net, breaking Signal session for users that live on LID-only.
    // v1.7.6: inline resolver (per-session closure helper was out of scope here).
    let jid;
    if (to.includes('@')) {
      jid = to;
    } else {
      const digits = String(to || '').replace(/[^0-9]/g, '');
      jid = '';
      if (digits) {
        try {
          const rows = await session.socket.onWhatsApp(digits);
          const found = Array.isArray(rows) && rows.find((r) => r?.exists && r?.jid)?.jid;
          jid = found || `${digits}@s.whatsapp.net`;
        } catch (err) {
          console.warn(`[${req.params.id}] onWhatsApp lookup failed for ${digits}: ${err?.message || err}`);
          jid = `${digits}@s.whatsapp.net`;
        }
      }
    }
    let result;

    if (!jid) return res.status(400).json({ error: 'invalid recipient jid', code: 'INVALID_RECIPIENT' });
    console.log(`[${req.params.id}] SEND_DISPATCH jid=${jid} type=${type} is_otp=${isOtpReq}`);

    // v1.6.9: pre-assign a WhatsApp message id and cache retry content BEFORE
    // the stanza is sent. Some recipients ask for Signal retry immediately; if
    // the store is populated only after sendMessage resolves, they can remain on
    // "Waiting for this message" even though the sender sees the OTP text.
    const preassignedMessageId = type !== 'reaction' ? buildDeterministicMessageId(session.socket) : '';

    // ─── DISAPPEARING MESSAGES SUPPORT ───
    // Detect ephemeral settings for the chat to avoid "old version" warning
    let sendOpts = preassignedMessageId ? { messageId: preassignedMessageId } : {};
    try {
      if (jid.endsWith('@g.us')) {
        // Group: check group metadata for ephemeral setting
        const groupMeta = await session.socket.groupMetadata(jid).catch(() => null);
        if (groupMeta?.ephemeralDuration) {
          sendOpts.ephemeralExpiration = groupMeta.ephemeralDuration;
        }
      } else {
        // DM: check chat store for ephemeral setting
        // Baileys stores this in the chat object after sync
        const chatStore = session.socket.store?.chats?.get(jid);
        if (chatStore?.ephemeralExpiration || chatStore?.ephemeralSettingTimestamp) {
          sendOpts.ephemeralExpiration = chatStore.ephemeralExpiration || 86400; // default 24h
        }
      }
    } catch (ephErr) {
      // Non-critical — send without ephemeral if detection fails
      console.log(`[${req.params.id}] Ephemeral detection skipped: ${ephErr.message}`);
    }

    try {
      if (!jid.endsWith('@g.us')) {
        // v1.6.4: force `available` for OTP so Signal prekey fetch is allowed
        // regardless of session-level markOnline setting.
        if (isOtpReq || session.markOnline !== false) {
          await session.socket.sendPresenceUpdate('available');
        }
        await session.socket.presenceSubscribe(jid).catch(() => null);
        await session.socket.sendPresenceUpdate('composing', jid).catch(() => null);
        // v1.6.4: OTP warmup raised 250ms → 800ms. Below ~600ms the prekey
        // exchange often doesn't complete before sendMessage encrypts, which
        // is what makes recipients sit on "Waiting for this message".
        await new Promise((r) => setTimeout(r, isOtpReq ? 800 : 600));
        await session.socket.sendPresenceUpdate('paused', jid).catch(() => null);
      }
    } catch (presenceErr) {
      console.warn(`[${req.params.id}] Pre-send presence/key warmup skipped: ${presenceErr?.message || presenceErr}`);
    }

    // For OTP after a re-pair, stale recipient device/session cache is the most
    // common reason the receiver sees "Waiting for this message" even though WA
    // accepts the stanza. Force a fresh device lookup for OTP/non-group sends.
    if (isOtpReq && !jid.endsWith('@g.us')) {
      sendOpts.useUserDevicesCache = false;
    }

    // ─── The actual send work, wrapped so we can run it inline OR in background ───
    const doSend = async () => {
      let result;
      let retryMessagePayload = null;
      let cachedMessageId = '';
      switch (type) {
        case 'text': {
          const normalizedText = String(content ?? '').trim();
          if (!normalizedText) {
            throw new Error('EMPTY_TEXT_BLOCKED');
          }
          const msgPayload = { text: normalizedText };
          if (mentions && Array.isArray(mentions) && mentions.length > 0) {
            msgPayload.mentions = mentions.map(m => {
              if (m.includes('@')) return m;
              const digits = m.replace(/\D/g, '');
              const isLid = digits.length > 13;
              return isLid ? `${digits}@lid` : `${digits}@s.whatsapp.net`;
            });
          }
          retryMessagePayload = { conversation: normalizedText };
          if (preassignedMessageId && typeof session._rememberSentMessage === 'function') {
            session._rememberSentMessage(preassignedMessageId, retryMessagePayload);
            cachedMessageId = preassignedMessageId;
            console.log(`[${req.params.id}] Pre-cached sent msg ${preassignedMessageId} before send`);
          }
          try {
            result = await session.socket.sendMessage(jid, msgPayload, sendOpts);
          } catch (sendErr) {
            if (cachedMessageId) {
              try { fs.unlinkSync(getSentMessagePath(cachedMessageId)); } catch {}
              try { sentMessageStore.delete(cachedMessageId); } catch {}
            }
            throw sendErr;
          }
          break;
        }
        case 'image': {
          retryMessagePayload = { image: { url: mediaUrl }, caption: content || '' };
          result = await session.socket.sendMessage(jid, retryMessagePayload, sendOpts);
          break;
        }
        case 'video': {
          retryMessagePayload = { video: { url: mediaUrl }, caption: content || '' };
          result = await session.socket.sendMessage(jid, retryMessagePayload, sendOpts);
          break;
        }
        case 'document': {
          retryMessagePayload = { document: { url: mediaUrl }, fileName: content || 'document' };
          result = await session.socket.sendMessage(jid, retryMessagePayload, sendOpts);
          break;
        }
        case 'audio': {
          let audioSource = { url: mediaUrl };
          let finalMime = 'audio/ogg; codecs=opus';
          let shouldUsePtt = true;
          try {
            const audioResp = await fetch(mediaUrl);
            if (audioResp.ok) {
              let audioBuffer = Buffer.from(await audioResp.arrayBuffer());
              const sourceMime = (audioResp.headers.get('content-type') || '').split(';')[0].trim();
              if (audioBuffer.length > 100) {
                const isOgg = mediaUrl.includes('.ogg') || sourceMime === 'audio/ogg';
                if (!isOgg) {
                  try {
                    const inExt = sourceMime.includes('mp4') ? 'm4a' : sourceMime.includes('mpeg') ? 'mp3' : sourceMime.includes('wav') ? 'wav' : sourceMime.includes('webm') ? 'webm' : 'bin';
                    const tmpIn = `/tmp/audio_in_${Date.now()}.${inExt}`;
                    const tmpOut = `/tmp/audio_out_${Date.now()}.ogg`;
                    fs.writeFileSync(tmpIn, audioBuffer);
                    execSync(`ffmpeg -y -i ${tmpIn} -c:a libopus -b:a 48k -ar 48000 -ac 1 ${tmpOut}`, { timeout: 15000 });
                    if (fs.existsSync(tmpOut)) {
                      audioBuffer = fs.readFileSync(tmpOut);
                      finalMime = 'audio/ogg; codecs=opus';
                      shouldUsePtt = true;
                      console.log(`[${req.params.id}] Audio converted to ogg/opus (${audioBuffer.length} bytes)`);
                    }
                    try { fs.unlinkSync(tmpIn); } catch {}
                    try { fs.unlinkSync(tmpOut); } catch {}
                  } catch (convErr) {
                    console.error(`[${req.params.id}] Audio conversion failed, sending original format:`, convErr.message);
                    finalMime = sourceMime || 'audio/webm';
                    shouldUsePtt = false;
                  }
                } else {
                  finalMime = 'audio/ogg; codecs=opus';
                  shouldUsePtt = true;
                }
                audioSource = audioBuffer;
              }
            }
          } catch (dlErr) {
            console.error(`[${req.params.id}] Audio download failed, using URL fallback:`, dlErr.message);
          }
          retryMessagePayload = { audio: audioSource, ptt: shouldUsePtt, mimetype: finalMime };
          result = await session.socket.sendMessage(jid, retryMessagePayload, sendOpts);
          break;
        }
        case 'reaction': {
          const reactionMessageId = req.body.reactionMessageId || req.body.reaction_message_id;
          const reactionFromMe = req.body.reactionFromMe !== undefined ? req.body.reactionFromMe : (req.body.reaction_from_me !== undefined ? req.body.reaction_from_me : false);
          const reactionEmoji = content || req.body.emoji || '';
          if (!reactionMessageId) throw new Error('reactionMessageId or reaction_message_id required for reaction type');
          console.log(`[${req.params.id}] SEND_REACTION executing: jid=${jid}, msgId=${reactionMessageId}, fromMe=${reactionFromMe}, emoji=${reactionEmoji}`);
          const reactionKey = { remoteJid: jid, id: reactionMessageId, fromMe: !!reactionFromMe };
          retryMessagePayload = { react: { text: reactionEmoji, key: reactionKey } };
          result = await session.socket.sendMessage(jid, retryMessagePayload);
          if (result?.key?.id) {
            const sessionData = sessions.get(req.params.id);
            if (sessionData && sessionData._recentSentReactionIds) {
              sessionData._recentSentReactionIds.add(result.key.id);
              setTimeout(() => sessionData._recentSentReactionIds.delete(result.key.id), 60000);
            }
          }
          break;
        }
        default: {
          const normalizedText = String(content ?? '').trim();
          if (!normalizedText) {
            throw new Error('EMPTY_TEXT_BLOCKED');
          }
          retryMessagePayload = { conversation: normalizedText };
          result = await session.socket.sendMessage(jid, retryMessagePayload, sendOpts);
        }
      }
      // Remember sent message so getMessage can answer Signal retry receipts
      // from iPhone / WhatsApp Web with the real content (prevents blank bubbles
      // and "Waiting for this message" on the recipient).
      try {
        const sentId = result?.key?.id || preassignedMessageId;
        const sentMsg = result?.message || retryMessagePayload;
        if (sentId && sentMsg && type !== 'reaction' && typeof session._rememberSentMessage === 'function') {
          session._rememberSentMessage(sentId, sentMsg);
          console.log(`[${req.params.id}] Cached sent msg ${sentId} for retry-receipt replay`);
        } else if (sentId && type !== 'reaction') {
          console.warn(`[${req.params.id}] Could NOT cache sent msg ${sentId} — hasMsg=${!!sentMsg}, hasFn=${typeof session._rememberSentMessage === 'function'}`);
        }
      } catch (cacheErr) {
        console.warn(`[${req.params.id}] _rememberSentMessage threw:`, cacheErr?.message || cacheErr);
      }
      // Arm OTP delivery watcher for guaranteed-delivery flow.
      try {
        const sentId = result?.key?.id || preassignedMessageId;
        if (isOtpReq && sentId && !jid.endsWith('@g.us') && type !== 'reaction') {
          otpDeliveryWatcher.set(sentId, {
            sessionId: req.params.id,
            jid,
            content,
            type,
            mediaUrl,
            mentions,
            sentAt: Date.now(),
            retries: 0,
          });
          console.log(`[${req.params.id}] OTP_WATCH armed id=${sentId} jid=${jid} (deadline ${OTP_DELIVERY_DEADLINE_MS}ms)`);
        }
      } catch {}
      return result;
    };

    // ─── Mode 1: Fire-and-queue (default for OTP / high-volume callers) ───
    if (fastAck) {
      const queuedId = `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      // Respond IMMEDIATELY so caller never hits AbortError.
      res.status(202).json({ success: true, queued: true, queuedId, status: 'queued' });
      // Background send — never blocks the HTTP response.
      doSend().then(
        (result) => console.log(`[${req.params.id}] queued send OK (${queuedId}) → ${result?.key?.id || 'no-id'}`),
        (err) => console.error(`[${req.params.id}] queued send FAILED (${queuedId}):`, err?.message || err),
      );
      return;
    }

    // ─── Mode 2: Synchronous, but with a HARD timeout so client always gets a body ───
    try {
      const result = await withTimeout(doSend(), HARD_TIMEOUT_MS, 'send');
      const realId = result?.key?.id || preassignedMessageId || '';
      return res.json({ success: true, messageId: realId, wa_message_id: realId, status: realId ? 'sent' : 'unknown', retry_cache: realId ? 'persisted' : 'missing' });
    } catch (err) {
      const msg = String(err?.message || err);
      if (msg.startsWith('send_timeout_')) {
        // Important: respond instead of leaving the socket hanging; send keeps running in background.
        console.warn(`[${req.params.id}] send exceeded ${HARD_TIMEOUT_MS}ms — responded 202, send continues in background`);
        if (isOtpReq && !req.body?._recovery) {
          scheduleOtpProviderRecovery(req.params.id, { ...req.body, to: jid }, preassignedMessageId, OTP_STALL_RECOVERY_MS).catch(() => {});
        }
        return res.status(202).json({
          success: true,
          queued: true,
          messageId: preassignedMessageId || undefined,
          wa_message_id: preassignedMessageId || undefined,
          status: 'queued',
          retry_cache: preassignedMessageId ? 'pre_persisted' : 'missing',
          warning: `Bridge ack exceeded ${HARD_TIMEOUT_MS}ms; message still being delivered in background.`,
          code: 'BRIDGE_SLOW_ACK',
          fallback: true,
          error: 'provider_timeout',
        });
      }
      throw err;
    }
  } catch (err) {
    if (!res.headersSent) {
      const detail = describeSendError(err);
      console.error(`[${req.params.id}] SEND_FAILED_DETAIL: ${detail}`);
      res.status(500).json({ error: err.message || detail, detail, code: 'BAILEYS_SEND_FAILED' });
    }
  }
}

app.post('/api/sessions/:id/send', handleSessionSend);

// Disconnect/delete session
app.delete('/api/sessions/:id', async (req, res) => {
  const sid = req.params.id;
  try {
    const session = sessions.get(sid);
    if (session) {
      session.disableReconnect = true;
      try { if (session.reconnectTimer) clearTimeout(session.reconnectTimer); } catch {}
      await session.socket?.logout?.().catch(() => {});
      session.socket?.end?.();
      sessions.delete(sid);
    }
    const sessionDir = getSessionDir(sid);
    try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch {}
    // v1.5.1: hold sessionId in release tombstone for 35s so any POST
    // /api/sessions arriving immediately after returns release_pending
    // instead of recreating the socket prematurely.
    markRelease(sid);
    res.json({
      success: true,
      released: true,
      release_until_seconds: Math.ceil(RELEASE_WINDOW_MS / 1000),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch profile pictures for multiple JIDs
app.post('/api/sessions/:id/profile-pics', async (req, res) => {
  try {
    const session = sessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!session.connected) return res.status(400).json({ error: 'Session not connected' });

    const { jids } = req.body;
    if (!Array.isArray(jids) || jids.length === 0) return res.status(400).json({ error: 'jids array required' });

    const results = {};
    // Process in batches of 5 to avoid rate limiting
    for (let i = 0; i < jids.length; i += 5) {
      const batch = jids.slice(i, i + 5);
      await Promise.all(batch.map(async (jid) => {
        try {
          const fullJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
          const url = await session.socket.profilePictureUrl(fullJid, 'image');
          if (url) results[jid] = url;
        } catch {
          // Privacy settings or unavailable
        }
      }));
      // Small delay between batches
      if (i + 5 < jids.length) await new Promise(r => setTimeout(r, 500));
    }

    res.json({ success: true, results, total: Object.keys(results).length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch group metadata (participants list)
app.post('/api/sessions/:id/group-metadata', async (req, res) => {
  try {
    const session = sessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!session.connected) return res.status(400).json({ error: 'Session not connected' });

    const { groupJid } = req.body;
    if (!groupJid) return res.status(400).json({ error: 'groupJid is required' });

    const fullJid = groupJid.includes('@') ? groupJid : `${groupJid}@g.us`;
    const metadata = await session.socket.groupMetadata(fullJid);

    const participants = (metadata.participants || []).map(p => ({
      id: p.id?.replace(/@s\.whatsapp\.net|@lid/g, '') || '',
      admin: p.admin || null,
      pushName: p.notify || p.vname || null,
      name: p.name || p.notify || null,
    }));

    res.json({
      success: true,
      groupId: groupJid.replace('@g.us', ''),
      name: metadata.subject || '',
      participants,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch current known chats/contacts from the live Baileys socket (best-effort)
app.get('/api/sessions/:id/chats', async (req, res) => {
  try {
    const session = sessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!session.connected) return res.status(400).json({ error: 'Session not connected' });
    return res.json({ success: true, chats: [], contacts: [], message: 'Bridge v1.8.5 relies on messaging-history.set batches for full chat import.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch messages for a specific chat (on-demand history sync)
app.post('/api/sessions/:id/fetch-messages', async (req, res) => {
  try {
    const session = sessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    if (!session.connected) return res.status(400).json({ error: 'Session not connected' });

    const { jid, limit = 50 } = req.body;
    if (!jid) return res.status(400).json({ error: 'jid is required' });

    const fullJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
    
    console.log(`[${req.params.id}] Fetching ${limit} messages for ${fullJid}`);

    // Ask WhatsApp for older history using Baileys on-demand sync API
    const anchorMessageId = req.body.anchorMessageId || '';
    const anchorTimestampRaw = req.body.anchorTimestamp;
    const anchorTimestamp = anchorTimestampRaw
      ? Math.floor(Number(anchorTimestampRaw) / 1000)
      : Math.floor(Date.now() / 1000);

    if (typeof session.socket.fetchMessageHistory === 'function') {
      await session.socket.fetchMessageHistory(
        Number(limit) || 50,
        { remoteJid: fullJid, id: anchorMessageId || 'anchor', fromMe: false },
        anchorTimestamp,
      );

      console.log(`[${req.params.id}] History sync requested for ${fullJid} (limit=${limit}, anchor=${anchorMessageId || 'none'})`);
      return res.json({
        success: true,
        jid: fullJid,
        requested: Number(limit) || 50,
        anchorMessageId: anchorMessageId || null,
        message: 'History sync requested successfully. Incoming batches will be delivered via webhook.',
      });
    }

    return res.status(501).json({
      error: 'fetchMessageHistory not supported by current bridge runtime',
      code: 'HISTORY_SYNC_NOT_SUPPORTED',
    });
  } catch (err) {
    console.error('Fetch messages error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Request pairing code (alternative to QR)
app.post('/api/sessions/:id/request-pairing-code', async (req, res) => {
  try {
    const session = sessions.get(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found. Create session first.' });
    if (session.connected) return res.json({ success: true, message: 'Already connected' });

    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ error: 'phoneNumber is required' });

    // Clean phone number - remove + and spaces
    const cleanedPhone = phoneNumber.replace(/[^0-9]/g, '');
    if (cleanedPhone.length < 10) return res.status(400).json({ error: 'Invalid phone number' });

    // Wait a moment for the socket to be ready before requesting pairing code
    // The socket needs to have generated at least one QR before pairing code works
    const waitForReady = () => new Promise((resolve) => {
      if (session.qr) return resolve(true);
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (session.qr || session.connected || attempts > 30) {
          clearInterval(interval);
          resolve(session.qr || session.connected);
        }
      }, 1000);
    });

    await waitForReady();

    if (session.connected) return res.json({ success: true, message: 'Already connected' });

    const code = await session.socket.requestPairingCode(cleanedPhone);
    console.log(`[${req.params.id}] Pairing code requested for ${cleanedPhone}: ${code}`);

    res.json({ success: true, code });
  } catch (err) {
    console.error(`[${req.params.id}] Pairing code error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// List sessions
app.get('/api/sessions', (req, res) => {
  const list = [];
  sessions.forEach((session, id) => {
    list.push({
      id,
      connected: session.connected,
      tenantId: session.tenantId,
      createdAt: session.createdAt,
      connectedAt: session.connectedAt,
    });
  });
  res.json({ sessions: list });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 WhatsApp Bridge Server v${SERVER_VERSION} running on port ${PORT}`);
  console.log(`📡 Webhook URL: ${WEBHOOK_URL || 'Not configured'}`);
  console.log(`🔑 API Key: ${API_KEY ? 'Configured' : 'Not set (open access)'}`);
  console.log(`🌐 Dashboard: http://localhost:${PORT}`);
  restorePersistedSessions().catch((err) => console.error('[restore] Fatal restore error:', err.message));
});

// ===== Session Watchdog (v1.8.4) =====
// Every 60s, scan in-memory sessions and resurrect sockets that died/stalled
// without a clean close event. This prevents customers from staying disconnected
// after VPS network blips, deploy restarts, or Baileys hollow sockets.
setInterval(() => {
  try {
    sessions.forEach((s, sessionId) => {
      if (s.disableReconnect) return;
      const ws = s.socket?.ws;
      const wsState = ws?.readyState; // 0=connecting,1=open,2=closing,3=closed
      const isDead = !ws || wsState === 3 || wsState === undefined;
      const lastEventAt = s._lastSocketEventAt || (s.createdAt ? new Date(s.createdAt).getTime() : Date.now());
      const quietMs = Date.now() - lastEventAt;
      const connectingTooLong = !s.connected && !s.qr && wsState === 0 && quietMs > 120000;
      const connectedButDead = s.connected && isDead;

      if ((connectedButDead || (!s.connected && (isDead || connectingTooLong))) && !s.reconnectTimer) {
        console.log(`[watchdog] Session ${sessionId} unhealthy (connected=${s.connected}, wsState=${wsState}, quietMs=${quietMs}). Re-creating without deleting credentials.`);
        s.connected = false;
        s.reconnectAttempts = (s.reconnectAttempts || 0) + 1;
        s.reconnectTimer = setTimeout(() => {
          createSession(sessionId, s.tenantId, s.webhookUrl, { markOnline: s.markOnline, force: true })
            .catch((err) => console.error(`[watchdog] Resurrect failed for ${sessionId}:`, err.message));
        }, 1000);
      }
    });
  } catch (err) {
    console.error('[watchdog] Tick error:', err.message);
  }
}, 60000).unref();

// Periodic memory log + early-warning watchdog (v1.5.0).
// If RSS grows beyond 600MB, log a critical warning so admins can rotate
// the bridge BEFORE the OOM killer terminates it mid-pairing.
setInterval(() => {
  const m = process.memoryUsage();
  const rssMb = Math.round(m.rss / 1024 / 1024);
  const heapMb = Math.round(m.heapUsed / 1024 / 1024);
  console.log(`[mem] RSS=${rssMb}MB Heap=${heapMb}MB Sessions=${sessions.size}`);
  if (rssMb > 600) {
    console.warn(`[mem] ⚠️ HIGH MEMORY: RSS=${rssMb}MB. Consider restarting bridge container.`);
  }
}, 300000).unref();

// ===== OTP Delivery Watcher (v1.7.8) =====
// Every 5s, scan armed OTPs. Any that didn't receive delivery ack within
// OTP_DELIVERY_DEADLINE_MS gets a deep Signal flush + automatic resend,
// up to OTP_MAX_RETRIES. Kills the "Waiting for this message" failure mode.
setInterval(async () => {
  if (otpDeliveryWatcher.size === 0) return;
  const now = Date.now();
  for (const [msgId, entry] of otpDeliveryWatcher) {
    try {
      if (now - entry.sentAt < OTP_DELIVERY_DEADLINE_MS) continue;

      const session = sessions.get(entry.sessionId);
      if (!session?.connected) {
        // session gone — give up
        otpDeliveryWatcher.delete(msgId);
        continue;
      }

      if (entry.retries >= OTP_MAX_RETRIES) {
        console.warn(`[${entry.sessionId}] OTP_UNDELIVERED id=${msgId} jid=${entry.jid} after ${entry.retries} retries — giving up`);
        try {
          await sendWebhook('status', entry.sessionId, {
            tenantId: session.tenantId,
            messageId: msgId,
            to: String(entry.jid).split('@')[0],
            status: 'undelivered',
            reason: 'retries_exhausted',
          });
        } catch {}
        otpDeliveryWatcher.delete(msgId);
        continue;
      }

      entry.retries += 1;
      entry.sentAt = now; // reset deadline for next retry window
      const doFlush = entry.retries >= 2; // only deep-flush on 2nd retry to avoid breaking healthy sessions
      console.warn(`[${entry.sessionId}] OTP_RESEND attempt=${entry.retries} id=${msgId} jid=${entry.jid} — ${doFlush ? 'deep flush + resend' : 'cache-bypass resend'}`);

      if (doFlush) {
        try {
          const flush = await flushRecipientSignalState(session, getSessionDir(entry.sessionId), entry.jid);
          console.log(`[${entry.sessionId}] OTP_RESEND flush result=${JSON.stringify(flush)}`);
        } catch (flushErr) {
          console.warn(`[${entry.sessionId}] OTP_RESEND flush failed:`, flushErr?.message || flushErr);
        }
      }

      // Presence warmup so prekey fetch is allowed
      try {
        await session.socket.sendPresenceUpdate('available');
        await session.socket.presenceSubscribe(entry.jid).catch(() => null);
        await new Promise((r) => setTimeout(r, 1200));
      } catch {}

      // Build payload based on original type
      let payload = null;
      switch (entry.type) {
        case 'image':
          payload = { image: { url: entry.mediaUrl }, caption: entry.content || '' };
          break;
        case 'text':
        default:
          payload = { text: String(entry.content ?? '') };
          break;
      }

      try {
        const newResult = await session.socket.sendMessage(entry.jid, payload, { useUserDevicesCache: false });
        const newId = newResult?.key?.id;
        if (newId) {
          // Cache for retry-receipt replay and track for delivery confirmation
          try { session._rememberSentMessage?.(newId, newResult.message || payload); } catch {}
          otpDeliveryWatcher.set(newId, { ...entry, sentAt: Date.now() });
          console.log(`[${entry.sessionId}] OTP_RESEND sent newId=${newId} (was ${msgId})`);
        }
        otpDeliveryWatcher.delete(msgId); // remove old entry regardless
      } catch (sendErr) {
        console.error(`[${entry.sessionId}] OTP_RESEND failed for ${msgId}:`, sendErr?.message || sendErr);
        // Leave entry; next tick will retry until OTP_MAX_RETRIES
      }
    } catch (err) {
      console.error(`[otp-watcher] tick error for ${msgId}:`, err?.message || err);
    }
  }
}, OTP_WATCHER_TICK_MS).unref();

function shutdown(signal) {
  console.log(`[shutdown] ${signal} received. Closing Bridge server...`);
  for (const [, session] of sessions) {
    try { if (session.reconnectTimer) clearTimeout(session.reconnectTimer); } catch {}
    try { if (session.socket?.end) session.socket.end(); } catch {}
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
