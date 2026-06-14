import { createFileRoute } from "@tanstack/react-router";

/**
 * Public health-check endpoint.
 * Used by the deployment smoke test and external uptime monitors.
 * Returns 200 + JSON when the SSR app is alive. No DB calls, no PII.
 *
 * Also surfaces the currently-deployed build SHA (from deploy-version.json
 * on disk) so a single endpoint can confirm both "alive" and "right build".
 */
async function readBuildInfo() {
  try {
    const [{ existsSync, readFileSync }, { resolve }] = await Promise.all([
      import("node:fs"),
      import("node:path"),
    ]);
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

export const Route = createFileRoute("/api/public/health")({
  component: () => null,
  server: {
    handlers: {
      GET: async () => {
        return Response.json(
          {
            status: "ok",
            service: process.env.APP_NAME || "tanstack-start-app",
            timestamp: new Date().toISOString(),
            uptime_seconds: Math.round(process.uptime?.() ?? 0),
            build: await readBuildInfo(),
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
    },
  },
});
