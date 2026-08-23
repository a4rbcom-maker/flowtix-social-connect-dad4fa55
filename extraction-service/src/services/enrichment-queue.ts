/** Background enrichment queue: enrichment runs AFTER the job is marked
 *  completed, outside its queue slot — the user's next queued job starts
 *  immediately instead of waiting up to enrichmentTimeoutMs. Bounded retries
 *  with linear backoff; failures are recorded into job progress. */
import PQueue from "p-queue";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { enrichmentService } from "./enrichment-service.js";

const log = logger;

class EnrichmentQueueManager {
  private queue = new PQueue({ concurrency: config.enrichmentQueueConcurrency });
  private enqueued = new Map<string, number>(); // jobId → attempt

  enqueue(jobId: string): void {
    if (this.enqueued.has(jobId)) return;
    this.enqueued.set(jobId, 0);
    void this.run(jobId);
  }

  private run(jobId: string): void {
    void this.queue.add(async () => {
      const attempt = (this.enqueued.get(jobId) ?? 0) + 1;
      this.enqueued.set(jobId, attempt);
      try {
        await enrichmentService.enrichJobResults(jobId);
        this.enqueued.delete(jobId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (attempt <= config.enrichmentMaxRetries) {
          const delayMs = config.enrichmentRetryDelayMs * attempt;
          log.warn("EnrichQ", `job ${jobId} enrichment failed (attempt ${attempt}/${config.enrichmentMaxRetries + 1}) — retrying in ${Math.round(delayMs / 1000)}s: ${message.substring(0, 100)}`);
          setTimeout(() => this.run(jobId), delayMs).unref?.();
          return;
        }
        log.error("EnrichQ", `job ${jobId} enrichment failed permanently after ${attempt} attempts: ${message.substring(0, 120)}`);
        this.enqueued.delete(jobId);
        await enrichmentService.recordEnrichmentSkip(jobId, "ENRICHMENT_FAILED", { error: message.substring(0, 200) }).catch(() => {});
      }
    });
  }

  get size(): number {
    return this.queue.size + this.queue.pending;
  }
}

export const enrichmentQueue = new EnrichmentQueueManager();
