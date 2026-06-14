import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  nitro: {
    preset: "cloudflare-module",
    output: {
      dir: "dist",
      serverDir: "dist/server",
      publicDir: "dist/client",
    },
    cloudflare: {
      nodeCompat: true,
    },
  },
  vite: {
    optimizeDeps: {
      exclude: ["@tanstack/react-start", "zod"],
    },
  },
});
