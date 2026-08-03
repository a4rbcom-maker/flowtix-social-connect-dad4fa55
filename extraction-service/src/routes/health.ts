import { Router } from "express";
import { browserPool } from "../services/browser-pool.js";
import { contextManager } from "../services/context-manager.js";
import { jobQueue } from "../services/job-queue.js";
import type { HealthStatus } from "../types.js";

const router = Router();
const startTime = Date.now();
const version = "1.0.0";
let shuttingDown = false;

export function setShuttingDown(v: boolean): void {
  shuttingDown = v;
}

router.get("/health", (_req, res) => {
  const browserStats = browserPool.getStats();
  const status: HealthStatus = {
    status: shuttingDown ? "shutting_down" : "ok",
    version,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    browsers: browserStats,
    contexts: { active: contextManager.getActiveCount() },
    queue: { pending: jobQueue.pending, size: jobQueue.size },
    memory: process.memoryUsage(),
  };
  res.json(status);
});

export default router;
