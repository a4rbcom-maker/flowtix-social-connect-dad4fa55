// Facebook Webhook receiver — handles comment events and triggers auto-reply engine.
// CRITICAL: signature verification (x-hub-signature-256) is enforced before any write.
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "node:crypto";

export const Route = createFileRoute("/api/public/webhooks/facebook")({
  server: {
    handlers: {
      // Facebook verification handshake
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");
        const verifyToken = process.env.FB_WEBHOOK_VERIFY_TOKEN;
        if (mode === "subscribe" && token && verifyToken && token === verifyToken) {
          return new Response(challenge ?? "", { status: 200 });
        }
        return new Response("Forbidden", { status: 403 });
      },

      POST: async ({ request }) => {
        const appSecret = process.env.FB_APP_SECRET;
        const signature = request.headers.get("x-hub-signature-256") ?? "";
        const raw = await request.text();

        if (!appSecret) {
          return Response.json(
            { ok: true, status: "disabled", reason: "facebook_webhook_not_configured" },
            {
              status: 200,
              headers: { "Cache-Control": "no-store, max-age=0" },
            },
          );
        }
        const expected = "sha256=" + createHmac("sha256", appSecret).update(raw).digest("hex");
        const sigBuf = Buffer.from(signature);
        const expBuf = Buffer.from(expected);
        if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: any;
        try {
          payload = JSON.parse(raw);
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }

        const { matchRule, executeRule, logExecution } = await import(
          "@/lib/fb-autoreply-engine.server"
        );

        if (payload.object === "page" && Array.isArray(payload.entry)) {
          for (const entry of payload.entry) {
            const pageId = String(entry.id ?? "");
            if (!pageId) continue;
            const changes = entry.changes ?? [];
            for (const ch of changes) {
              if (ch.field !== "feed") continue;
              const v = ch.value ?? {};
              if (v.item !== "comment" || v.verb !== "add") continue;
              const event = {
                pageId,
                postId: v.post_id ?? v.parent_id ?? undefined,
                commentId: String(v.comment_id ?? ""),
                commenterId: v.from?.id ? String(v.from.id) : undefined,
                commenterName: v.from?.name ?? undefined,
                text: String(v.message ?? ""),
                isFromPageAdmin: v.from?.id ? String(v.from.id) === pageId : false,
              };
              if (!event.commentId) continue;
              try {
                const rule = await matchRule(event);
                if (!rule) continue;
                const result = await executeRule(rule, event);
                await logExecution(rule, event, result);
              } catch (e) {
                console.error("autoreply error", e);
              }
            }
          }
        }
        return new Response("ok", { status: 200 });
      },
    },
  },
});
