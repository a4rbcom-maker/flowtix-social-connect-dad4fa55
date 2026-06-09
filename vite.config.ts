import { defineConfig } from "@lovable.dev/vite-tanstack-config";

function prewarmWhatsAppServerFns() {
  const modules = [
    "/src/lib/wa.functions.ts",
    "/src/lib/wa-chat.functions.ts",
    "/src/lib/wa-automation.functions.ts",
  ];

  let warmed: Promise<void> | null = null;
  const warm = (server: any) => {
    warmed ??= Promise.all(
      modules.map((module) => server.transformRequest(module).catch(() => null)),
    ).then(() => undefined);
    return warmed;
  };

  return {
    name: "flowtix-prewarm-whatsapp-server-fns",
    configureServer(server: any) {
      server.middlewares.use(async (req: any, _res: any, next: () => void) => {
        if (req.url?.startsWith("/_serverFn/")) await warm(server);
        next();
      });

      setTimeout(() => void warm(server), 0);
    },
  };
}

export default defineConfig({
  plugins: [prewarmWhatsAppServerFns()],
  optimizeDeps: {
    exclude: ["@tanstack/react-start", "zod"],
  },
});
