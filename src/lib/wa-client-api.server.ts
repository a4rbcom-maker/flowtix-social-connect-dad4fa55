import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { waBridge, inferStatus, BridgeError, type BridgeSessionStatus } from "./wa-bridge.server";
import { deriveWebhookUrl, describeBridgeError, doPing } from "./wa-helpers.server";

const corsHeaders = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

type Action = "state" | "connect" | "disconnect" | "ping" | "reset";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function readBearer(request: Request) {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function getSupabaseForToken(token: string) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Backend auth is not configured");
  return createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

export async function handleWaClientApi(request: Request) {
  try {
    const token = readBearer(request);
    if (!token) return json({ error: "Unauthorized" }, 401);

    const supabase = getSupabaseForToken(token);
    const { data: claims, error } = await supabase.auth.getClaims(token);
    const userId = claims?.claims?.sub;
    if (error || !userId) return json({ error: "Unauthorized" }, 401);

    const body = (await request.json().catch(() => ({}))) as { action?: Action };
    const action = body.action;
    if (action === "ping") return json(await doPing());
    if (action === "state") return json(await getState(supabase, userId));
    if (action === "connect") return json(await connect(supabase, userId));
    if (action === "reset") return json(await reset(supabase, userId));
    if (action === "disconnect") return json(await disconnect(supabase, userId));
    return json({ error: "Invalid action" }, 400);
  } catch (err) {
    console.error("[wa-client] error:", err instanceof Error ? err.message : err);
    return json({ error: describeBridgeError(err) }, 500);
  }
}

async function connect(supabase: ReturnType<typeof getSupabaseForToken>, userId: string) {
  const { data: existing } = await supabase
    .from("wa_sessions")
    .select("session_id, phone_number")
    .eq("user_id", userId)
    .maybeSingle();

  let sessionId = existing?.session_id;
  if (!sessionId) {
    sessionId = `flowtix-${userId.replace(/-/g, "").slice(0, 16)}-${Date.now().toString(36)}`;
    const { error } = await supabase
      .from("wa_sessions")
      .insert({ user_id: userId, session_id: sessionId, status: "connecting" });
    if (error) throw new Error(`DB insert failed: ${error.message}`);
  }

  try {
    await waBridge.createSession(sessionId, {
      webhookUrl: (await deriveWebhookUrl()) ?? undefined,
      tenantId: userId,
    });
  } catch (err) {
    if (!(err instanceof BridgeError && (err.status === 409 || err.status === 400))) {
      const now = new Date().toISOString();
      const msg = describeBridgeError(err);
      await supabase
        .from("wa_sessions")
        .update({ status: "disconnected", qr_data_url: null, last_seen_at: now })
        .eq("user_id", userId)
        .eq("session_id", sessionId);
      return stateDto("disconnected", sessionId, null, null, existing?.phone_number ?? null, now, msg);
    }
  }

  return readState(supabase, userId, sessionId);
}

async function getState(supabase: ReturnType<typeof getSupabaseForToken>, userId: string) {
  const { data: row } = await supabase
    .from("wa_sessions")
    .select("session_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!row?.session_id) return null;
  return readState(supabase, userId, row.session_id);
}

async function disconnect(supabase: ReturnType<typeof getSupabaseForToken>, userId: string) {
  const { data: row } = await supabase
    .from("wa_sessions")
    .select("session_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (row?.session_id) {
    try { await waBridge.deleteSession(row.session_id); } catch { /* best effort */ }
    await supabase.from("wa_sessions").delete().eq("user_id", userId);
  }
  return { ok: true };
}

async function reset(supabase: ReturnType<typeof getSupabaseForToken>, userId: string) {
  const { data: existing } = await supabase
    .from("wa_sessions")
    .select("session_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (existing?.session_id) {
    try { await waBridge.deleteSession(existing.session_id); } catch { /* best effort */ }
  }

  const sessionId = `flowtix-${userId.replace(/-/g, "").slice(0, 16)}-${Date.now().toString(36)}`;
  await waBridge.createSession(sessionId, {
    webhookUrl: (await deriveWebhookUrl()) ?? undefined,
    tenantId: userId,
  });

  const now = new Date().toISOString();
  if (existing) {
    await supabase
      .from("wa_sessions")
      .update({ session_id: sessionId, status: "qr", qr_data_url: null, phone_number: null, last_seen_at: now })
      .eq("user_id", userId);
  } else {
    await supabase.from("wa_sessions").insert({ user_id: userId, session_id: sessionId, status: "qr" });
  }

  return readState(supabase, userId, sessionId);
}

async function readState(supabase: ReturnType<typeof getSupabaseForToken>, userId: string, sessionId: string) {
  let status: BridgeSessionStatus = "unknown";
  let qrRaw: string | null = null;
  let phoneNumber: string | null = null;
  let error: string | null = null;

  try {
    const s = await waBridge.getStatus(sessionId);
    status = inferStatus(s);
    phoneNumber = s.phoneNumber ?? s.phone ?? null;
    if ((status === "qr" || status === "connecting") && s.qr) {
      qrRaw = s.qr;
      status = "qr";
    }
  } catch (err) {
    error = describeBridgeError(err);
    status = "disconnected";
  }

  if (!qrRaw && (status === "qr" || status === "connecting" || status === "unknown")) {
    try {
      const q = await waBridge.getQr(sessionId);
      qrRaw = q?.qr ?? q?.qrCode ?? q?.dataUrl ?? null;
      if (qrRaw) status = "qr";
    } catch { /* no QR yet */ }
  }

  const now = new Date().toISOString();
  const update: Database["public"]["Tables"]["wa_sessions"]["Update"] = {
    status,
    qr_data_url: null,
    last_seen_at: now,
  };
  if (phoneNumber) update.phone_number = phoneNumber;
  await supabase.from("wa_sessions").update(update).eq("user_id", userId).eq("session_id", sessionId);

  let surfacedPhone = phoneNumber;
  if (!surfacedPhone) {
    const { data } = await supabase
      .from("wa_sessions")
      .select("phone_number")
      .eq("user_id", userId)
      .eq("session_id", sessionId)
      .maybeSingle();
    surfacedPhone = data?.phone_number ?? null;
  }

  return stateDto(status, sessionId, null, status === "qr" ? qrRaw : null, surfacedPhone, now, error);
}

function stateDto(
  status: BridgeSessionStatus,
  sessionId: string,
  qrDataUrl: string | null,
  qrRaw: string | null,
  phoneNumber: string | null,
  lastSeenAt: string | null,
  error: string | null,
) {
  return { status, sessionId, qrDataUrl, qrRaw, phoneNumber, lastSeenAt, error };
}