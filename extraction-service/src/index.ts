import express from "express";
import dotenv from "dotenv";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { browserPool } from "./services/browser-pool.js";
import { contextManager } from "./services/context-manager.js";
import { jobQueue } from "./services/job-queue.js";
import { supabaseService } from "./services/supabase.js";
import healthRouter, { setShuttingDown } from "./routes/health.js";
import extractRouter from "./routes/extract.js";
import sessionCheckRouter from "./routes/session-check.js";
import listPagesRouter from "./routes/list-pages.js";
import listGroupsRouter from "./routes/list-groups.js";
import publishRouter from "./routes/publish.js";
import waRouter from "./wa/routes.js";
import aiRouter from "./ai/routes.js";
import debugPageRouter from "./routes/debug-page.js";
import { waManager } from "./wa/wa-manager.js";

dotenv.config();
const log = logger;

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && config.allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  } else if (config.isDev) {
    res.header("Access-Control-Allow-Origin", "*");
  }
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.use((req, _res, next) => {
  if (req.path === "/health") return next();
  const key = req.headers["x-api-key"];
  if (key !== config.apiKey) {
    return _res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Invalid API key" } });
  }
  next();
});

app.use("/", healthRouter);
app.use("/", extractRouter);
app.use("/", sessionCheckRouter);
app.use("/", listPagesRouter);
app.use("/", listGroupsRouter);
app.use("/", publishRouter);
app.use("/", waRouter);
app.use("/", aiRouter);
app.use("/", debugPageRouter);

app.use((_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Endpoint not found" } });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  log.error("Server", `unhandled error: ${String(err)}`);
  res.status(500).json({ error: { code: "UNKNOWN_ERROR", message: "Internal server error" } });
});

log.info("Server", `attempting to listen on port ${config.port}...`);
log.info("Server", `attempting to listen on port ${config.port}...`);

const server = app.listen(config.port, async () => {
  log.info("Server", `FlowTix Extraction Service v1.0.0 starting on port ${config.port}`);
  log.info("Server", `env: ${config.nodeEnv} | headless: ${config.headless} | pool: ${config.browserPoolSize} | concurrency: ${config.maxConcurrentJobs}`);

  try {
    const orphaned = await supabaseService.cleanupOrphanedJobs();
    if (orphaned > 0) {
      log.info("Server", `cleaned up ${orphaned} orphaned running jobs from previous session`);
    }
    await browserPool.init();
    log.info("Server", "browser pool initialized — service ready");
    await waManager.boot();
    log.info("Server", "WhatsApp manager booted");

    const address = server.address();
    log.info("Server", `server address: ${JSON.stringify(address)}`);
  } catch (err) {
    log.error("Server", `failed to initialize browser pool: ${String(err)}`);
    process.exit(1);
  }
});

server.on("error", (err: unknown) => {
  log.error("Server", `server error: ${String(err)}`);
  process.exit(1);
});

let isShuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  setShuttingDown(true);

  log.info("Shutdown", `received ${signal} — initiating graceful shutdown`);

  server.close();
  log.info("Shutdown", "server stopped accepting new requests");

  await supabaseService.pauseAllRunningJobs("Server shutdown - job can be resumed");
  log.info("Shutdown", "all running jobs marked as paused");

  jobQueue.pause();
  jobQueue.clear();
  log.info("Shutdown", "job queue paused and cleared");

  try {
    await Promise.race([
      jobQueue.onIdle(),
      new Promise((r) => setTimeout(r, 30000)),
    ]);
    log.info("Shutdown", "all active jobs completed");
  } catch {
    log.warn("Shutdown", "timeout waiting for active jobs — proceeding with shutdown");
  }

  await contextManager.releaseAll();
  log.info("Shutdown", "all browser contexts released");

  await waManager.shutdown();
  log.info("Shutdown", "WhatsApp manager shut down");

  await browserPool.shutdown();
  log.info("Shutdown", "all browsers closed");

  log.info("Shutdown", "graceful shutdown complete");
  process.exit(0);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

process.on("uncaughtException", (err) => {
  log.error("Process", `uncaught exception: ${err.message}`, { stack: err.stack });
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  log.error("Process", `unhandled rejection: ${String(reason)}`);
});

process.on("exit", (code) => {
  log.info("Process", `process exiting with code ${code}`);
});

export { server };
