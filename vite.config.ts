import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  optimizeDeps: {
    exclude: ["@tanstack/react-start", "zod"],
  },
});
