import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  nitro: false,
  optimizeDeps: {
    exclude: ["@tanstack/react-start", "zod"],
  },
});
