import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { detectBot } from "@/lib/bot-detect";

async function handle(request: Request) {
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const path = typeof body?.path === "string" ? body.path.slice(0, 500) : "/";
  const referrer = typeof body?.referrer === "string" ? body.referrer.slice(0, 500) : null;
  const sessionId = typeof body?.session_id === "string" ? body.session_id.slice(0, 64) : null;
  const lang = typeof body?.lang === "string" ? body.lang.slice(0, 16) : null;

  const ua = request.headers.get("user-agent");
  const { isBot, reason } = detectBot(ua);
  const country = request.headers.get("cf-ipcountry") || request.headers.get("x-vercel-ip-country") || null;

  try {
    const db = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    await db.from("site_visits").insert({
      path,
      referrer,
      user_agent: ua?.slice(0, 500) ?? null,
      is_bot: isBot,
      bot_reason: reason,
      session_id: sessionId,
      lang,
      country,
    } as never);
  } catch (err) {
    // Never let analytics logging break the page
    console.warn("track-visit insert failed", err);
  }

  return Response.json({ ok: true, counted: !isBot });
}

export const Route = createFileRoute("/api/public/track-visit")({
  component: () => null,
  server: {
    handlers: {
      POST: async ({ request }) => handle(request),
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        }),
    },
  },
});
