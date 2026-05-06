// Build for Node.js (VPS + PM2) instead of Cloudflare Workers.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  cloudflare: false,
  tanstackStart: {
    target: "node-server",
  },
});
