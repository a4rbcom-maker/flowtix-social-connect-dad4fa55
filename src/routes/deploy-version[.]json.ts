import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/deploy-version.json")({
  server: {
    handlers: {
      GET: async () => {
        const sha = process.env.DEPLOY_SHA || process.env.GITHUB_SHA || "development";
        const deployedAt = process.env.DEPLOYED_AT || new Date().toISOString();

        return Response.json(
          {
            sha,
            short_sha: sha === "development" ? "dev" : sha.slice(0, 7),
            run_id: process.env.DEPLOY_RUN_ID || process.env.GITHUB_RUN_ID || null,
            repo: process.env.DEPLOY_REPOSITORY || process.env.GITHUB_REPOSITORY || null,
            deployed_at: deployedAt,
            mode: "ssr",
            status: "ok",
          },
          {
            headers: {
              "Cache-Control": "no-store, max-age=0",
            },
          },
        );
      },
    },
  },
});
