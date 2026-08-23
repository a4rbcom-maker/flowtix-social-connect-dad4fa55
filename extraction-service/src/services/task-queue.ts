/** Leased task queue: every task is claimed with an exclusive, expiring lease.
 *  A worker dying mid-task no longer loses the task — the lease expires and
 *  another worker re-claims it (bounded by maxRetries, then dead-letter). */

export interface LeasedTask<T> {
  id: string;
  task: T;
  attempt: number;
  leasedBy?: string;
  leaseExpiresMs?: number;
}

interface TaskEntry<T> extends LeasedTask<T> {
  seq: number;
}

export class LeasedTaskQueue<T> {
  private entries = new Map<string, TaskEntry<T>>();
  private dead: Array<LeasedTask<T>> = [];
  private nextSeq = 0;

  constructor(
    private leaseMs = 120_000,
    private maxRetries = 2,
    private idFn: (t: T) => string = (t) => String(t),
  ) {}

  /** Dedup-enqueue. Returns how many NEW tasks were added. */
  enqueue(tasks: T[]): number {
    let added = 0;
    for (const task of tasks) {
      const id = this.idFn(task);
      if (this.entries.has(id)) continue;
      if (this.dead.some((d) => d.id === id)) continue;
      this.entries.set(id, { id, task, attempt: 0, seq: this.nextSeq++ });
      added++;
    }
    return added;
  }

  /** Claim the next available task (FIFO). Expired leases are reclaimed first
   *  (attempt++ or dead-letter when out of retries). */
  claim(workerId: string, nowMs = Date.now()): LeasedTask<T> | null {
    this.drainExpired(nowMs);
    let best: TaskEntry<T> | null = null;
    for (const entry of this.entries.values()) {
      if (entry.leasedBy !== undefined) continue;
      if (!best || entry.seq < best.seq) best = entry;
    }
    if (!best) return null;
    best.leasedBy = workerId;
    best.leaseExpiresMs = nowMs + this.leaseMs;
    const { seq: _seq, ...leased } = best;
    return leased;
  }

  /** Task finished — remove permanently. */
  complete(id: string): void {
    this.entries.delete(id);
  }

  /** Task failed while leased — requeue immediately for another worker. */
  fail(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.leasedBy = undefined;
    entry.leaseExpiresMs = undefined;
    if (entry.attempt >= this.maxRetries) {
      this.entries.delete(id);
      const { seq: _seq, ...dead } = entry;
      this.dead.push(dead);
      return;
    }
    entry.attempt++;
  }

  /** Heartbeat: extend the lease of a task still owned by the same worker. */
  renew(id: string, workerId: string, nowMs = Date.now()): void {
    const entry = this.entries.get(id);
    if (!entry || entry.leasedBy !== workerId) return;
    entry.leaseExpiresMs = nowMs + this.leaseMs;
  }

  /** Reclaim expired leases. Returns how many were reclaimed/dead-lettered. */
  drainExpired(nowMs = Date.now()): number {
    let reclaimed = 0;
    for (const entry of this.entries.values()) {
      if (entry.leasedBy === undefined) continue;
      if ((entry.leaseExpiresMs ?? 0) > nowMs) continue;
      entry.leasedBy = undefined;
      entry.leaseExpiresMs = undefined;
      if (entry.attempt >= this.maxRetries) {
        this.entries.delete(entry.id);
        const { seq: _seq, ...dead } = entry;
        this.dead.push(dead);
      } else {
        entry.attempt++;
      }
      reclaimed++;
    }
    return reclaimed;
  }

  /** Total tracked tasks (queued + leased). For backpressure decisions. */
  size(): number {
    return this.entries.size;
  }

  pending(): number {
    return this.entries.size;
  }

  deadLetters(): T[] {
    return this.dead.map((d) => d.task);
  }
}
