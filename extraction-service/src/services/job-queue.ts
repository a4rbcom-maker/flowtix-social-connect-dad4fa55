import PQueue from "p-queue";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { ExtractionError, ErrorCodes, isRetryable } from "../errors.js";

const log = logger;

export interface IJobQueue {
  add(task: () => Promise<void>): Promise<void>;
  get pending(): number;
  get size(): number;
  onIdle(): Promise<void>;
  clear(): void;
  pause(): void;
}

class PQueueAdapter implements IJobQueue {
  private queue: PQueue;

  constructor() {
    // No p-queue timeout: a queue-level timeout would trigger a retry while
    // the timed-out task is still running in the background (double run).
    // Per-job runtime is bounded by BaseExtractor.maxExecutionMs instead.
    this.queue = new PQueue({
      concurrency: config.maxConcurrentJobs,
    });
  }

  async add(task: () => Promise<void>): Promise<void> {
    await this.queue.add(task);
  }

  get pending(): number {
    return this.queue.pending;
  }

  get size(): number {
    return this.queue.size;
  }

  async onIdle(): Promise<void> {
    await this.queue.onIdle();
  }

  clear(): void {
    this.queue.clear();
  }

  pause(): void {
    this.queue.pause();
  }
}

class JobQueueManager {
  private impl: IJobQueue;

  constructor() {
    this.impl = new PQueueAdapter();
  }

  async enqueue(task: () => Promise<void>, retryable: () => Promise<void>): Promise<void> {
    await this.impl.add(async () => {
      let lastError: unknown;
      for (let attempt = 1; attempt <= config.maxRetries + 1; attempt++) {
        try {
          await task();
          return;
        } catch (err) {
          lastError = err;
          const code = err instanceof ExtractionError ? err.code : ErrorCodes.UNKNOWN_ERROR;
          if (!isRetryable(code) || attempt === config.maxRetries + 1) {
            throw err;
          }
          const delayMs = config.retryDelayMs * attempt;
          log.warn("JobQueue", `retrying attempt ${attempt}/${config.maxRetries} after ${delayMs}ms`, {
            code,
            error: err instanceof Error ? err.message : String(err),
          });
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
      throw lastError;
    });
  }

  get pending(): number {
    return this.impl.pending;
  }

  get size(): number {
    return this.impl.size;
  }

  async onIdle(): Promise<void> {
    await this.impl.onIdle();
  }

  clear(): void {
    this.impl.clear();
  }

  pause(): void {
    this.impl.pause();
  }

  swapImplementation(newImpl: IJobQueue): void {
    this.impl = newImpl;
  }
}

export const jobQueue = new JobQueueManager();
