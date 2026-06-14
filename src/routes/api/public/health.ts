import { createFileRoute } from "@tanstack/react-router";

async function readBuildInfo() {
  try {
    const [{ existsSync, readFileSync }, { resolve }] = await Promise.all([
      import("node:fs"),
      import("node:path"),
    ]);
    const p = resolve(process.cwd(), "deploy-version.json");
    if (!existsSync(p)) return { source: "missing" as const };
    const raw = readFileSync(p, "utf8");
    if (!raw.trim()) return { source: "empty" as const };
    const parsed = JSON.parse(raw);
    return {
      source: "file" as const,
      sha: typeof parsed?.sha === "string" ? parsed.sha : null,
      short_sha: typeof parsed?.short_sha === "string" ? parsed.short_sha : null,
      deployed_at: typeof parsed?.deployed_at === "string" ? parsed.deployed_at : null,
    };
  } catch (err) {
    return { source: "error" as const, message: err instanceof Error ? err.message : String(err) };
  }
}

export const Route = createFileRoute("/api/public/health")({
  component: () => null,
  server: {
    handlers: {
      GET: async () => {
        let uptime = 0;
        try {
          uptime = Math.round(process.uptime?.() ?? 0);
        } catch {}

        return Response.json(
          {
            status: "ok",
            service: process.env.APP_NAME || "tanstack-start-app",
            timestamp: new Date().toISOString(),
            uptime_seconds: uptime,
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
