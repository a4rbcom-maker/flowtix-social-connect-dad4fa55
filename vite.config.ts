import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  optimizeDeps: {
    include: [
      "@tanstack/history",
      "@tanstack/react-query",
      "@tanstack/react-router",
      "@tanstack/react-start",
      "@tanstack/router-core",
      "@tanstack/router-core/ssr/client",
      "@tanstack/router-core/ssr/server",
      "h3-v2",
      "react",
      "react-dom",
      "seroval",
    ],
  },
});
