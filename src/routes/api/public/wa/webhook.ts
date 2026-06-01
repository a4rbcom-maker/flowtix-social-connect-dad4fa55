// Inbound webhook from the BotXtra WhatsApp bridge (v1.7.7+).
// Verifies HMAC-SHA256(WA_BRIDGE_WEBHOOK_SECRET, rawBody) and stores messages
// + updates session state. Maps bridge sessionId -> user_id via wa_sessions.
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { handleAiAutoReply, upsertConversationFromMessage } from "@/lib/wa-ai.server";

function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const received = header.slice(7);
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected, "hex");
  let b: Buffer;
  try {
    b = Buffer.from(received, "hex");
  } catch {
    return false;
  }
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function digits(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const d = s.replace(/[^0-9]/g, "");
  return d || null;
}

export const Route = createFileRoute("/api/public/wa/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.WA_BRIDGE_WEBHOOK_SECRET;
        if (!secret) {
          return new Response("Webhook secret not configured", { status: 500 });
        }

        const raw = await request.text();
        const sig = request.headers.get("x-bridge-signature");
        if (!verifySignature(raw, sig, secret)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: {
          sessionId?: string;
          event?: string;
          data?: Record<string, unknown>;
        };
        try {
          payload = JSON.parse(raw);
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }

        const sessionId = payload.sessionId;
        if (!sessionId || typeof sessionId !== "string") {
          return new Response("Missing sessionId", { status: 400 });
        }

        // Map session -> user
        const { data: sess } = await supabaseAdmin
          .from("wa_sessions")
          .select("user_id")
          .eq("session_id", sessionId)
          .maybeSingle();
        if (!sess?.user_id) {
          // Unknown session — ack to avoid retries, but do nothing
          return new Response("ok", { status: 200 });
        }

        const userId = sess.user_id;
        const event = String(payload.event || "").toLowerCase();
        const data = (payload.data || {}) as Record<string, unknown>;

        if (event === "status") {
          const raw = String(data.status ?? data.state ?? "").toLowerCase();
          const map: Record<string, string> = {
            open: "connected",
            ready: "connected",
            connected: "connected",
            qr: "qr",
            scan: "qr",
            connecting: "connecting",
            starting: "connecting",
            disconnected: "disconnected",
            closed: "disconnected",
            logged_out: "disconnected",
          };
          const next = map[raw] ?? "unknown";
          await supabaseAdmin
            .from("wa_sessions")
            .update({
              status: next,
              phone_number: digits(data.phoneNumber ?? data.phone),
              qr_data_url: next === "qr" ? null : null,
              last_seen_at: new Date().toISOString(),
            })
            .eq("user_id", userId);
          return new Response("ok");
        }

        if (event === "qr") {
          const qr = data.qr ?? data.qrCode ?? data.dataUrl;
          const qrDataUrl =
            typeof qr === "string"
              ? qr.startsWith("data:image")
                ? qr
                : `data:image/png;base64,${qr}`
              : null;
          await supabaseAdmin
            .from("wa_sessions")
            .update({
              status: "qr",
              qr_data_url: qrDataUrl,
              last_seen_at: new Date().toISOString(),
            })
            .eq("user_id", userId);
          return new Response("ok");
        }

        if (event === "message") {
          const from = digits(data.from);
          const text = typeof data.text === "string" ? data.text : null;
          const type = (typeof data.type === "string" ? data.type : "text").toLowerCase();
          const mediaUrl = typeof data.mediaUrl === "string" ? data.mediaUrl : null;
          const remoteJid = from ?? String(data.from ?? "unknown");
          const contactName =
            typeof data.pushName === "string"
              ? data.pushName
              : typeof data.contactName === "string"
                ? data.contactName
                : null;

          await supabaseAdmin.from("wa_messages").insert({
            user_id: userId,
            session_id: sessionId,
            direction: "in",
            remote_jid: remoteJid,
            from_phone: from,
            msg_type: type,
            text_body: text,
            media_url: mediaUrl,
            raw: data as never,
          });

          const conversationId = await upsertConversationFromMessage({
            userId,
            sessionId,
            remoteJid,
            contactName,
            contactPhone: from,
            text: text ?? (type !== "text" ? `[${type}]` : null),
            direction: "in",
          });

          if (text) {
            handleAiAutoReply({
              userId,
              sessionId,
              conversationId,
              remoteJid,
              fromPhone: from,
              inboundText: text,
            }).catch((err) => console.error("[wa-webhook] AI handler error:", err));
          }

          return new Response("ok");
        }

        // Unknown event — accept silently
        return new Response("ok");
      },
    },
  },
});
