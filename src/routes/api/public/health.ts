import { createAPIFileRoute } from "@tanstack/react-start/api";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Public health-check endpoint.
 * Used by the deployment smoke test and external uptime monitors.
 * Returns 200 + JSON when the SSR app is alive. No DB calls, no PII.
 *
 * Also surfaces the currently-deployed build SHA (from deploy-version.json
 * on disk) so a single endpoint can confirm both "alive" and "right build".
 */
function readBuildInfo() {
  try {
    const p = resolve(process.cwd(), "deploy-version.json");
    if (!existsSync(p)) return { source: "missing" as const };
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    return {
      source: "file" as const,
      sha: typeof parsed?.sha === "string" ? parsed.sha : null,
      short_sha: typeof parsed?.short_sha === "string" ? parsed.short_sha : null,
      deployed_at: typeof parsed?.deployed_at === "string" ? parsed.deployed_at : null,
    };
  } catch {
    return { source: "error" as const };
  }
}

export const APIRoute = createAPIFileRoute("/api/public/health")({
  GET: async () => {
    return Response.json(
      {
        status: "ok",
        service: process.env.APP_NAME || "tanstack-start-app",
        timestamp: new Date().toISOString(),
        uptime_seconds: Math.round(process.uptime?.() ?? 0),
        build: readBuildInfo(),
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, max-age=0",
          "Content-Type": "application/json",
        },
      },
    );
  },
});
