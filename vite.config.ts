import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    host: "127.0.0.1",
    open: false,
    hmr: {
      host: "127.0.0.1",
      port: 5173,
      protocol: "ws",
      overlay: false,
    },
    watch: {
      usePolling: false,
      useFsEvents: false,
      interval: 10000,
      binaryInterval: 30000,
      ignored: [
        "**/.git/**",
        "**/node_modules/**",
        "**/dist/**",
        "**/build/**",
        "**/coverage/**",
        "**/extraction-service/**",
        "**/supabase/**",
        "**/specs/**",
        "**/.opencode/**",
        "**/*.db",
        "**/*.db-journal",
        "**/*.db-wal",
        "**/*.db-shm",
        "D:/داتا مصر/**",
        "D:/FlowTix-Data/**",
      ],
    },
    fs: {
      strict: false,
    },
  },
  build: {
    target: "es2022",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          i18n: ["i18next", "react-i18next", "i18next-browser-languagedetector"],
          supabase: ["@supabase/supabase-js"],
        },
      },
    },
  },
});
