# Adaptive Extraction Orchestrator — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** تحويل pipeline استخراج أعضاء مجموعات Facebook إلى Orchestrator تكيفي يقيس إنتاجية كل مصدر فعلياً، ينتقل بين المصادر تلقائياً، يدير صحة الجلسات كـ state machine، يفصل Enrichment عن الاستخراج، ويحفظ checkpoints للاستكمال بعد الفشل — بدون كسر أي ميزة موجودة.

**Architecture:** إضافة طبقة تنسيق مركزية (`orchestrator-core`) فوق الـ extractors الحاليين (members-list / search-shards / feed-cascade تعمل كما هي كـ "source runners")، مع `LeasedTaskQueue` لمنع فقدان/تكرار البوستات، `SessionHealthMonitor` كـ state machine للجلسات، و`EnrichmentQueue` منفصل يعمل بعد اكتمال المهمة. كل القرارات مبنية على قياس `users/minute` الفعلي وليس أرقام ثابتة.

**Tech Stack:** TypeScript + Express + Playwright (extraction-service) — React 19 + TanStack Query (frontend) — بدون migrations جديدة (الـ progress هو JSONB) — بدون dependencies جديدة (الاختبارات عبر `node:test` المدمج في Node 22 + tsx الموجود).

---

## Current State — Root Causes & Bottlenecks (من الفحص الفعلي)

| # | المشكلة | الموقع | الأثر |
|---|---------|--------|-------|
| R1 | **البوست لا يعود للـ queue إذا مات الـ worker أثناء معالجته** — `nextIdx++` claim بلا lease؛ موت/توقف worker بعد claim = بوست مفقود للأبد | `group-cascade-core.ts:344-346` | فقدان تغطية عند فشل جلسة |
| R2 | **لا توجد session state machine** — worker يتوقف بعد 8 أخطاء متتالية (`consecutiveErrors >= 8`) لكن الجلسة لا تُصنّف ولا يُسجّل سبب الفشل ولا تُستبعد من إعادة التشغيل | `group-cascade-core.ts:378-381` | جلسة ميتة تُعاد استخدامها؛ لا تمييز network/auth/restriction/bug |
| R3 | **Enrichment يحجب اكتمال المهمة وبدء التالية** — `runEnrichmentSafely` يعمل داخل queue slot المهمة؛ المهمة التالية في queue المستخدم لا تبدأ حتى ينتهي enrichment (حتى 10 دقائق `enrichmentTimeoutMs`) | `routes/extract.ts:105-122, 302-338` | إهدار وقت؛ طابور المستخدم متجمد |
| R4 | **الـ checkpoint محدود** — الـ cursor يحفظ رابط members-list فقط؛ resume بعد pause/watchdog يعيد كل الـ pipeline من الصفر (phases/shards/cascade state مفقودة) | `extractors/group-members.ts:37`, `routes/extract.ts:318-323` | إعادة عمل مكلفة بعد الفشل |
| R5 | **metrics ناقصة** — لا `duplicates_skipped` (يُفلتر في `processBatch` بلا عدّ)، لا requests count، لا per-source stats، لا session health في الـ progress | `extractors/base.ts:637-652` | الداشبورد لا يستطيع عرض Duplicate rate / Error rate / Source productivity |
| R6 | **الداشبورد يعرض جزءاً فقط** — `ExtractMembersPage` يعرض discovered + posts_done فقط؛ `rate_per_min` / `active_sessions` / `stop_reason` / `next_phase` غير معروضة | `src/pages/dashboard/extraction/ExtractMembersPage.tsx:358-445` | المستخدم لا يرى Current Source/Rate/Errors/Next Strategy |
| R7 | **fallback صغير لـ max_results** — `runExtractionJob` يستخدم `\|\| 10000` بدلاً من 100000 | `routes/extract.ts:134` | حد أدنى من غير قصد |
| R8 | **budgets ثابتة جزئياً** — `MEMBERS_PHASE_MAX_MS=8min` و`GROUP_CASCADE_MAX_POSTS=400` سقوف safety وليست قرارات adaptive؛ الموجود (stall/low-yield/saturation) جيد لكنه غير مقاس/مُبلَّغ كمعدلات | `group-members-core.ts:52-62` | قرارات انتقال غير مرئية وغير قابلة للضبط |

**ما هو جيد أصلاً ويُبنى عليه (لا يُعاد بناؤه):** multi-session parallel members scroll، GraphQL interception، stall/low-yield/saturation detection، feed discovery + rediscovery + latePages، dedup على مستوى insert عبر `getExistingIds` (workspace-wide)، incremental `processBatch`، watchdog + paused/resume، letter-shard search، pre-flight auth check، proxy/fingerprint isolation.

---

## Proposed Approach

```
START job (type=groups)
 ↓ Validate sessions (موجود) + SessionHealthMonitor init (جديد)
 ↓ members_list  ──(RateMeter)──┐
 ↓ members_search (shards)      ├─ Orchestrator: يقيس users/min لكل مصدر،
 ↓ feed_cascade (posts/comments/┘   يبدّل عند low-rate/exhaustion، يسلّم
   reactions)                       البوستات عبر LeasedTaskQueue
 ↓ Dedup (موجود) + duplicates counter (جديد)
 ↓ Checkpoint: config.orchestrator_state (جديد)
 ↓ Job status=completed فوراً → EnrichmentQueue (منفصل، retry محدود)
 ↓ Final dataset (موجود)
```

**قواعد الانتقال بين المصادر (decideNextSource):**
- مصدر "منخفض الإنتاجية": `ratePerMin < ORCH_MIN_RATE_PER_MIN (default 5)` لمدة `ORCH_EVAL_WINDOW_MS (default 90s)` وبعد `ORCH_MIN_PHASE_MS (default 120s)` من بدايته → بدّل.
- مصدر "مستنزف": stop reason ∈ {stagnated, source_exhausted, saturated, posts_exhausted} → بدّل فوراً.
- `canceled` لا يُبدّل — يوقف الكل (موجود).
- الأولوية عند التساوي: `feed_cascade > members_search > members_list` (مبنية على الإنتاجية التاريخية المقاسة في نفس المهمة، `SourceStats.best()`).
- لا زيادة على معدل الطلبات إطلاقاً — نفس الـ human-like delays الموجودة؛ التحسين من إيقاف إهدار الوقت على مصادر منخفضة فقط.

---

## Task 1: `orchestrator-core.ts` — RateMeter + SourceStats + decideNextSource

**Objective:** منطق القياس والقرار كـ pure logic قابل للاختبار بدون Playwright.

**Files:**
- Create: `extraction-service/src/services/orchestrator-core.ts`
- Test: `extraction-service/src/services/__tests__/orchestrator-core.test.ts`

**Step 1: Write failing test** (`node --import tsx --test`):

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { RateMeter, SourceStats, decideNextSource, type SourceKey } from "../orchestrator-core.js";

test("RateMeter computes users/min over rolling window", () => {
  const m = new RateMeter(90_000);
  m.add(30);                       // t=0
  assert.equal(m.ratePerMin(30_000), 60); // 30 users / 30s → 60/min
});

test("low productivity triggers switch after min phase time", () => {
  const stats = new SourceStats<SourceKey>();
  stats.start("members_list", 0);
  stats.addUsers("members_list", 3);          // ~3 users in 150s → ~1.2/min
  stats.markExhausted?.call; // no-op guard
  const next = decideNextSource(stats, { nowMs: 150_000 });
  assert.equal(next, "members_search");
});

test("exhausted source switches immediately regardless of rate", () => {
  const stats = new SourceStats<SourceKey>();
  stats.start("members_list", 0);
  stats.addUsers("members_list", 500);
  stats.finish("members_list", "stagnated", 60_000);
  assert.equal(decideNextSource(stats, { nowMs: 61_000 }), "members_search");
});

test("cascade preferred when members sources exhausted", () => {
  const stats = new SourceStats<SourceKey>();
  stats.start("members_list", 0);
  stats.finish("members_list", "stagnated", 60_000);
  stats.start("members_search", 61_000);
  stats.finish("members_search", "source_exhausted", 120_000);
  assert.equal(decideNextSource(stats, { nowMs: 121_000 }), "feed_cascade");
});

test("returns null when current source is productive", () => {
  const stats = new SourceStats<SourceKey>();
  stats.start("feed_cascade", 0);
  stats.addUsers("feed_cascade", 500); // high rate
  assert.equal(decideNextSource(stats, { nowMs: 150_000 }), null);
});
```

**Step 2: Run** `cd extraction-service && node --import tsx --test src/services/__tests__/orchestrator-core.test.ts`
Expected: FAIL (module not found)

**Step 3: Implement** — الجوهر:

```typescript
export type SourceKey = "members_list" | "members_search" | "feed_cascade";
export type SourceStopReason =
  | "target_reached" | "stagnated" | "low_yield" | "source_exhausted"
  | "saturated" | "posts_exhausted" | "max_duration" | "canceled";

const SOURCE_ORDER: SourceKey[] = ["members_list", "members_search", "feed_cascade"];

export class RateMeter {
  private buckets = new Map<number, number>(); // bucketStartMs → count
  constructor(private windowMs = 90_000, private bucketSizeMs = 10_000) {}
  add(count: number, nowMs = Date.now()): void { /* bucket + prune old */ }
  ratePerMin(nowMs = Date.now()): number { /* sum(window)/windowElapsed*60000, 0 if <5s */ }
}

export interface SourceStat {
  key: SourceKey; users: number; startedMs: number; endedMs: number | null;
  errors: number; requests: number; stopReason: SourceStopReason | null;
  meter: RateMeter;
}

export class SourceStats<K extends string = SourceKey> {
  start(key: K, nowMs = Date.now()): void
  addUsers(key: K, count: number, nowMs = Date.now()): void
  addError(key: K): void
  addRequest(key: K): void
  finish(key: K, reason: SourceStopReason, nowMs = Date.now()): void
  get(key: K): SourceStat | undefined
  snapshot(): Record<string, { users: number; rate_per_min: number; duration_ms: number; errors: number; requests: number; stop_reason: string | null }>
}

export interface OrchestratorThresholds {
  minRatePerMin: number;   // default 5
  evalWindowMs: number;    // default 90_000
  minPhaseMs: number;      // default 120_000
}

export function decideNextSource(
  stats: SourceStats, opts: { nowMs?: number } & Partial<OrchestratorThresholds>,
): SourceKey | null {
  // 1. آخر source نشط: إن كان stopReason ∈ {stagnated, low_yield, source_exhausted, saturated, posts_exhausted}
  //    → أول source غير مجرَّب بعده حسب SOURCE_ORDER
  // 2. إن كان نشطاً: ratePerMin < minRatePerMin && elapsed >= minPhaseMs && elapsed >= evalWindowMs
  //    → التالي غير المجرب
  // 3. كلهم exhausted/نشط منتج → null (استمر)
  // canceled لا يدخل هذه الدالة أصلاً (يعالجه extractor)
}
```

**Step 4: Run tests** → PASS
**Step 5: Commit** `git commit -m "feat: orchestrator core — rate meter, source stats, adaptive source-switching decision"`

---

## Task 2: `task-queue.ts` — LeasedTaskQueue (منع فقدان/تكرار البوستات)

**Objective:** كل task (بوست) يُ claim بـ lease له owner + expiry؛ موت worker → انتهاء الـ lease → إعادة البوست للـ queue تلقائياً. يعالج **R1**.

**Files:**
- Create: `extraction-service/src/services/task-queue.ts`
- Test: `extraction-service/src/services/__tests__/task-queue.test.ts`

**Step 1: Failing test:**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { LeasedTaskQueue } from "../task-queue.js";

test("claim gives exclusive lease; second claim gets next task", () => {
  const q = new LeasedTaskQueue<string>(/* leaseMs */ 30_000, /* maxRetries */ 2);
  q.enqueue(["p1", "p2"]);
  const a = q.claim("workerA");
  const b = q.claim("workerB");
  assert.equal(a?.task, "p1");
  assert.equal(b?.task, "p2");
});

test("complete removes task permanently", () => {
  const q = new LeasedTaskQueue<string>(30_000, 2);
  q.enqueue(["p1"]);
  const t = q.claim("w1")!;
  q.complete(t.id);
  assert.equal(q.claim("w2"), null);
});

test("expired lease requeues task for another worker", () => {
  const q = new LeasedTaskQueue<string>(50, 2); // 50ms lease
  q.enqueue(["p1"]);
  const t = q.claim("w1")!;
  q.complete; // not completed
  await new Promise(r => setTimeout(r, 80));
  const t2 = q.claim("w2");
  assert.equal(t2?.task, "p1");
  assert.equal(t2?.attempt, 1);
});

test("task exceeding maxRetries goes to dead letter", () => {
  const q = new LeasedTaskQueue<string>(30, 1);
  q.enqueue(["p1"]);
  q.claim("w1"); // attempt 0, expires
  await new Promise(r => setTimeout(r, 60));
  q.claim("w2"); // attempt 1, expires
  await new Promise(r => setTimeout(r, 60));
  assert.equal(q.claim("w3"), null);
  assert.deepEqual(q.deadLetters(), ["p1"]);
});

test("backpressure: size() and pending() exposed", () => {
  const q = new LeasedTaskQueue<string>(30_000, 2);
  q.enqueue(["p1", "p2"]);
  assert.equal(q.size(), 2);
});
```

**Step 2: Run** → FAIL. **Step 3: Implement:**

```typescript
export interface LeasedTask<T> {
  id: string;          // stable hash of task value (dedup key)
  task: T;
  attempt: number;
  leasedBy?: string;
  leaseExpiresMs?: number;
}

export class LeasedTaskQueue<T> {
  constructor(private leaseMs = 120_000, private maxRetries = 2,
              private idFn: (t: T) => string = String) {}
  enqueue(tasks: T[]): number          // dedup by id; returns added count
  claim(workerId: string, nowMs = Date.now()): LeasedTask<T> | null
        // 1) reclaim expired leases (attempt++ or dead-letter)
        // 2) FIFO claim, set leasedBy/leaseExpiresMs
  complete(id: string): void
  fail(id: string): void               // immediate requeue (attempt++)
  renew(id: string, workerId: string): void  // heartbeat lease extension
  size(): number; pending(): number    // queued + leased (for backpressure)
  deadLetters(): T[]
  drainExpired(nowMs = Date.now()): number  // called inside claim
}
```

**Step 4:** PASS. **Step 5:** Commit `feat: leased task queue with expiry, requeue, dead-letter`

---

## Task 3: `session-health.ts` — State Machine + تصنيف الأخطاء

**Objective:** يعالج **R2**. `healthy → degraded → unavailable → recovery` + heartbeat + backoff + تسجيل سبب الفشل مصنّفاً.

**Files:**
- Create: `extraction-service/src/services/session-health.ts`
- Test: `extraction-service/src/services/__tests__/session-health.test.ts`

**Step 1: Failing test:**

```typescript
import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionHealthMonitor, classifyFailure, type FailureKind } from "../session-health.js";
import { ExtractionError, ErrorCodes } from "../../errors.js";

test("classifies error kinds", () => {
  assert.equal(classifyFailure(new ExtractionError(ErrorCodes.NETWORK_ERROR, "x")).kind, "network");
  assert.equal(classifyFailure(new ExtractionError(ErrorCodes.TIMEOUT, "x")).kind, "network");
  assert.equal(classifyFailure(new ExtractionError(ErrorCodes.SESSION_EXPIRED, "x")).kind, "auth");
  assert.equal(classifyFailure(new ExtractionError(ErrorCodes.AUTH_FAILED, "x")).kind, "auth");
  assert.equal(classifyFailure(new Error("boom")).kind, "bug");
});

test("transitions healthy → degraded → unavailable", () => {
  const m = new SessionHealthMonitor();
  m.register("s1");
  m.recordFailure("s1", { kind: "network", detail: "nav timeout" });
  assert.equal(m.state("s1"), "degraded");
  for (let i = 0; i < 4; i++) m.recordFailure("s1", { kind: "network", detail: "x" });
  assert.equal(m.state("s1"), "unavailable");
  assert.equal(m.available("s1"), false);
});

test("success recovers degraded to healthy; unavailable needs quarantine", () => {
  const m = new SessionHealthMonitor();
  m.register("s1");
  m.recordFailure("s1", { kind: "network", detail: "x" });
  m.recordSuccess("s1");
  assert.equal(m.state("s1"), "healthy");
  for (let i = 0; i < 5; i++) m.recordFailure("s1", { kind: "auth", detail: "login redirect" });
  assert.equal(m.state("s1"), "unavailable");
  assert.equal(m.lastFailure("s1")?.kind, "auth"); // سبب واضح مسجّل
});

test("retry backoff is exponential and capped", () => {
  const m = new SessionHealthMonitor({ baseMs: 1000, maxMs: 30_000 });
  assert.equal(m.backoffMs("s1", 1), 1000);
  assert.equal(m.backoffMs("s1", 2), 2000);
  assert.equal(m.backoffMs("s1", 9), 30000); // cap
});
```

**Step 2:** FAIL. **Step 3: Implement:**

```typescript
export type FailureKind = "network" | "auth" | "restriction" | "data_unavailable" | "bug";
export interface FailureInfo { kind: FailureKind; detail: string; atMs?: number }
export type SessionState = "healthy" | "degraded" | "unavailable" | "recovery";

const KIND_BY_CODE: Record<string, FailureKind> = {
  [ErrorCodes.NETWORK_ERROR]: "network", [ErrorCodes.TIMEOUT]: "network",
  [ErrorCodes.BROWSER_CRASH]: "network",
  [ErrorCodes.SESSION_EXPIRED]: "auth", [ErrorCodes.AUTH_FAILED]: "auth",
  [ErrorCodes.SESSION_NOT_CONNECTED]: "auth", [ErrorCodes.NO_COOKIES]: "auth",
};

export function classifyFailure(err: unknown): FailureInfo {
  if (err instanceof ExtractionError) {
    const kind = KIND_BY_CODE[err.code] ?? "bug";
    return { kind, detail: err.message };
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/checkpoint|locked|security check/i.test(msg)) return { kind: "restriction", detail: msg };
  if (/login|password form/i.test(msg)) return { kind: "auth", detail: msg };
  if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|net::/i.test(msg)) return { kind: "network", detail: msg };
  return { kind: "bug", detail: msg };
}

export class SessionHealthMonitor {
  constructor(private opts = { degradeAfter: 1, unavailableAfter: 3, baseMs: 2000, maxMs: 30000 }) {}
  register(sessionId: string): void
  recordSuccess(sessionId: string): void   // degraded→healthy, recovery→healthy
  recordFailure(sessionId: string, info: FailureInfo): void
      // kind==="auth" → unavailable فوراً (لا تُستخدم الجلسة حتى فحص)
      // غير ذلك: عدّ الأخطاء → degraded → unavailable
  available(sessionId: string): boolean    // state !== "unavailable"
  state(sessionId: string): SessionState
  lastFailure(sessionId: string): FailureInfo | undefined
  backoffMs(sessionId: string, attempt: number): number  // base*2^(n-1), cap
  snapshot(): Array<{ session_id: string; state: SessionState; failures: number; last_failure?: FailureInfo }>
}
```

**Step 4:** PASS. **Step 5:** Commit `feat: session health monitor — state machine, failure classification, backoff`

---

## Task 4: config knobs + أنواع الـ progress (backend + frontend)

**Objective:** ضبط العتبات عبر env بدون إعادة نشر كود + توسيع `ExtractionJobProgress` (يعالج **R5** جزئياً و**R7**).

**Files:**
- Modify: `extraction-service/src/config.ts` (بعد سطر `groupCascadeMaxPosts`)
- Modify: `extraction-service/src/types.ts`
- Modify: `src/lib/extraction/types.ts:93-110`

**Step 1 (config.ts):**

```typescript
  /** Adaptive orchestrator thresholds (see services/orchestrator-core.ts) */
  orchMinRatePerMin: envInt("ORCH_MIN_RATE_PER_MIN", 5),
  orchEvalWindowMs: envInt("ORCH_EVAL_WINDOW_MS", 90000),
  orchMinPhaseMs: envInt("ORCH_MIN_PHASE_MS", 120000),
  /** Lease TTL for cascade post tasks (worker death → requeue) */
  taskLeaseMs: envInt("TASK_LEASE_MS", 120000),
  /** Max requeue attempts per post before dead-letter */
  taskMaxRetries: envInt("TASK_MAX_RETRIES", 2),
  /** Enrichment queue */
  enrichmentQueueConcurrency: envInt("ENRICHMENT_QUEUE_CONCURRENCY", 1),
  enrichmentMaxRetries: envInt("ENRICHMENT_MAX_RETRIES", 2),
  enrichmentRetryDelayMs: envInt("ENRICHMENT_RETRY_DELAY_MS", 10000),
```

**Step 2 (extraction-service/src/types.ts)** — أضف داخل الملف (جديد، لا يعدل الموجود):

```typescript
export interface SessionHealthSnapshot {
  session_id: string;
  state: "healthy" | "degraded" | "unavailable" | "recovery";
  failures: number;
  last_failure_kind?: string;
  last_failure_detail?: string;
}

export interface SourceProgressSnapshot {
  users: number;
  rate_per_min: number;
  duration_ms: number;
  errors: number;
  requests: number;
  stop_reason: string | null;
}

export interface OrchestratorCheckpoint {
  sources_done: string[];
  seen_count: number;
  posts_done?: number;
  saved_at: string;
}
```

**Step 3 (src/lib/extraction/types.ts)** — وسّع `ExtractionJobProgress` بحقول اختيارية فقط (لا كسر):

```typescript
  duplicates_skipped?: number;
  requests_count?: number;
  per_source?: Record<string, { users: number; rate_per_min: number; duration_ms: number; errors: number; requests: number; stop_reason?: string | null }>;
  session_health?: Array<{ session_id: string; state: string; failures: number; last_failure_kind?: string }>;
  next_strategy?: string;
```

**Step 4:** `cd extraction-service && npm run typecheck && cd .. && npm run typecheck` → PASS
**Step 5:** Commit `feat: orchestrator config knobs + progress/checkpoint types`

---

## Task 5: دمج LeasedTaskQueue + SessionHealth في cascade

**Objective:** يعالج **R1 + R2** داخل `runGroupCascade` بأقل تعديل ممكن. الـ worker loop الحالي (`group-cascade-core.ts:328-402`) يتحول من `postQueue[nextIdx++]` إلى `queue.claim(sessionId)`.

**Files:**
- Modify: `extraction-service/src/services/group-cascade-core.ts`
- Modify: `extraction-service/src/services/group-members-core.ts` (callback إحصائيات فقط)

**التعديلات:**

1. **استبدال post queue** (الأسطر 108-109, 175-179, 344-346):
```typescript
// قبل: const postQueue: string[] = []; const queuedPosts = new Set<string>();
const postQueue = new LeasedTaskQueue<string>(config.taskLeaseMs, config.taskMaxRetries);
// queuePost(permalink) → postQueue.enqueue([permalink])
// queuedPosts.size → postQueue.size()
// worker: const idx = nextIdx; nextIdx++; ...
// بعد:
const leased = postQueue.claim(wp.sessionId);
if (!leased) { /* نفس منطق queue-drained الحالي: rediscovery/sleep/return */ }
try {
  const res = await opts.extractEngagers(wp.page, permalink);
  postQueue.complete(leased.id);
  health.recordSuccess(wp.sessionId);
} catch (err) {
  const info = classifyFailure(err);
  health.recordFailure(wp.sessionId, info);
  log.warn("GroupCascade", `worker ${wp.sessionId.slice(0,8)} post failed (${info.kind}): ${info.detail.substring(0, 100)}`);
  postQueue.fail(leased.id);            // requeue فوراً لworker آخر
  if (!health.available(wp.sessionId)) {
    log.warn("GroupCascade", `worker ${wp.sessionId.slice(0,8)} UNAVAILABLE (${health.lastFailure(wp.sessionId)?.kind}) — removing from pool`);
    return;                              // بدل consecutiveErrors>=8 الأعمى
  }
  await sleep(health.backoffMs(wp.sessionId, /*attempt*/ failures)); // backoff بدل sleep ثابت
}
```

2. **Lease renewal heartbeat:** قبل `extractEngagers` الطويلة، وبعد كل scroll داخلها لا نلمسها — يكفي `postQueue.renew(leased.id, wp.sessionId)` بعد انتهاء الـ extract (renew-before-complete لا معنى؛ الهدف: lease طويلة كفاية `TASK_LEASE_MS=120s` تغطي post واحد — إن استغرق أكثر فالـ claim التالي سيعيده).

3. **consecutiveErrors يبقى كـ safety** لكن بقرار الصحة: `if (!health.available(...)) return;` (يستبدل شرط 8).

4. **onProgress** يضيف: `deadLettered: postQueue.deadLetters().length`, `queueSize: postQueue.pending()`.

5. **Discovery/rediscovery كما هي** — تستخدم `postQueue.enqueue`.

6. **group-members-core.ts:** أضف `onSessionEvent?: (sessionId: string, event: "nav_failed" | "auth_failed" | "idle_exhausted") => void` إلى `MultiSessionGroupOptions` واستدعِه في المواضع الثلاثة الموجودة (177-189, 245-247) — بلا تغيير سلوك.

**Verification:**
```bash
cd extraction-service && npm run typecheck && npm run build
node --import tsx --test src/services/__tests__/*.test.ts
```

**Commit:** `feat: cascade on leased task queue + session health — lost posts requeued, dead sessions removed with classified reason`

---

## Task 6: ربط Orchestrator في `group-members.ts` + checkpoint

**Objective:** يعالج **R4 + R8**. استبدال التسلسل الثابت بقرار `decideNextSource` + حفظ حالة الاستئناف.

**Files:**
- Modify: `extraction-service/src/extractors/group-members.ts`
- Modify: `extraction-service/src/services/supabase.ts` (لا شيء — `updateJob` يكفي، checkpoint يُخزن في `config.orchestrator_state`)

**التعديلات:**

1. **بناء الـ stats** في أعلى `extract()`:
```typescript
const stats = new SourceStats();
const health = new SessionHealthMonitor();
for (const p of allPages) health.register(p.sessionId);
```

2. **تحويل المراحل الحالية إلى دوال مسجلة**: `runMembersList()`, `runShards()`, `runCascade()` (نفس الأجسام الحالية 168-297، بلا إعادة كتابة — فقط تغليف) ثم:
```typescript
const runners: Array<[SourceKey, () => Promise<void>]> = [
  ["members_list", runMembersList],
  ["members_search", runShards],
  ["feed_cascade", runCascade],
];
let phaseIdx = checkpoint?.sources_done?.length ?? 0;   // استئناف من checkpoint
while (phaseIdx < runners.length && total < targetCount && this.timeRemainingSec > 90 && !(await this.throttledCanceled())) {
  const [key, run] = runners[phaseIdx];
  stats.start(key);
  await run();
  stats.finish(key, lastStopReasonFor(key));
  await this.persistCheckpoint({ sources_done: [...done, key], seen_count: seen.size, posts_done: ..., saved_at: new Date().toISOString() });
  const next = decideNextSource(stats, { minRatePerMin: config.orchMinRatePerMin, evalWindowMs: config.orchEvalWindowMs, minPhaseMs: config.orchMinPhaseMs });
  if (next) phaseIdx = runners.findIndex(([k]) => k === next);
  else phaseIdx++;  // المصدر منتج/منتهي طبيعياً → التالي بالترتيب
}
```
ملاحظة: low-yield/stall الداخلية في `multiSessionGroupMembers` تبقى كما هي (early-exit للـ phase) — الـ orchestrator فوقها يقرر "لا عودة لمصدر مستنزف" ويسجل الإنتاجية. **وضع overlap متعدد الجلسات الحالي (193-248) يُحافظ عليه**: في وضع overlap يظل members+cascade متوازيين والـ orchestrator يجمع stats منهما فقط (لا يعيد جدولتهما — فقد أثبت كفاءته).

3. **persistCheckpoint** (خاصية جديدة بجوار `persistMembersCount`):
```typescript
private async persistCheckpoint(cp: OrchestratorCheckpoint): Promise<void> {
  const job = await supabaseService.getJob(this.ctx.jobId);
  await supabaseService.updateJob(this.ctx.jobId, {
    config: { ...(job.config || {}), orchestrator_state: cp },
  });
}
```
وفي بداية `extract()`: اقرأ `jobConfig.orchestrator_state` — إن وُجد `sources_done` فتخطَّ تلك المراحل (resume بعد pause لا يعيد members list).

4. **duplicates counter (R5):** في `persistUsers` احسب `batch.length - persisted` (قبل الفلترة في processBatch) وراكم في `this.duplicatesSkipped`، وأرسله في `storeRich`.

5. **storeRich يضيف:** `per_source: stats.snapshot()`, `session_health: health.snapshot()`, `duplicates_skipped`, `requests_count` (عدّاد `pagesFetched` الموجود + engager calls), `next_strategy` (اسم المصدر التالي من decideNextSource أو "none").

**Verification:** typecheck + build + اختبار يدوي لمهمة groups على مجموعة صغيرة (راجع مصفوفة الاختبار في Task 9).
**Commit:** `feat: group extraction orchestrated by measured productivity + phase checkpoints`

---

## Task 7: `enrichment-queue.ts` — فصل Enrichment نهائياً

**Objective:** يعالج **R3**. المهمة تكتمل فور انتهاء الاستخراج؛ الـ enrichment يعمل في خلفية الطابور؛ المهمة التالية للمستخدم تبدأ فوراً.

**Files:**
- Create: `extraction-service/src/services/enrichment-queue.ts`
- Modify: `extraction-service/src/routes/extract.ts`
- Modify: `extraction-service/src/index.ts`

**Step 1: Implement queue:**

```typescript
import PQueue from "p-queue";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { enrichmentService } from "./enrichment-service.js";

const log = logger;

interface EnrichItem { jobId: string; attempt: number }

class EnrichmentQueueManager {
  private queue = new PQueue({ concurrency: config.enrichmentQueueConcurrency });
  private enqueued = new Set<string>();

  enqueue(jobId: string): void {
    if (this.enqueued.has(jobId)) return;
    this.enqueued.add(jobId);
    void this.queue.add(async () => {
      try {
        await enrichmentService.enrichJobResults(jobId);
      } catch (err) {
        const item: EnrichItem = { jobId, attempt: 1 };
        if (item.attempt <= config.enrichmentMaxRetries) {
          log.warn("EnrichQ", `job ${jobId} enrichment failed — retry ${item.attempt}/${config.enrichmentMaxRetries} in ${config.enrichmentRetryDelayMs}ms`);
          await new Promise(r => setTimeout(r, config.enrichmentRetryDelayMs * item.attempt)); // backoff خطي محدود
          this.enqueued.delete(jobId);
          this.enqueue(jobId);
          return;
        }
        log.error("EnrichQ", `job ${jobId} enrichment failed permanently: ${String(err).substring(0, 120)}`);
        await enrichmentService.recordEnrichmentSkip?.(jobId, "ENRICHMENT_FAILED").catch?.(() => {});
      } finally {
        this.enqueued.delete(jobId);
      }
    });
  }
}

export const enrichmentQueue = new EnrichmentQueueManager();
```
(عدّل التكرار ليكون حلقة محسوبة بلا recursion إن أثبتت الاختبارات مشكلة — الأهم: bounded by `enrichmentMaxRetries`.)

**Step 2 (routes/extract.ts):** استبدل كل `await runEnrichmentSafely(jobId)` (المواضع: 284, 303, 310, 326, 332) بـ:
```typescript
enrichmentQueue.enqueue(jobId);
```
احذف `runEnrichmentSafely` و`setEnrichingPhase` من مسار الاكتمال — نقل الـ `phase: "enriching"` يجري داخل `enrichJobResults` نفسها (موجود في enrichment-service.ts:418-421). المهمة تتحول `completed` فور انتهاء الاستخراج.
⚠️ احتفظ بـ `setEnrichingPhase` في مسار الـ watchdog فقط قبل enqueue (حتى لا تُقرأ المهمة كاملة قبل بدء الـ enrichment).
⚠️ **سلوك API محفوظ:** `POST /enrich` اليدوي كما هو؛ `progress.phase === "enriching"` يظهر في الداشبورد أثناء الخلفية (نفس المفاتيح).

**Step 3 (index.ts boot recovery):** بعد `cleanupOrphanedJobs`: أضف `resumeEnrichmentJobs()` في extract.ts — يستعلم المهام التي `progress->>phase = 'enriching'` وstatus نهائي (completed/paused) ويعيد enqueue لها (الخدمة التي أُعيد تشغيلها لا تفقد الـ enrichment):
```typescript
export async function resumeEnrichmentJobs(): Promise<void> {
  // supabaseService: select id from extraction_jobs where status in ('completed','paused') and progress->>'phase' = 'enriching'
  // enrichmentQueue.enqueue(id) لكل واحد
}
```
(أضف الدالة المساعدة في supabase.ts باستخدام نفس نمط `getQueuedJobUserIds` الموجود.)

**Step 4:** typecheck + build. **Step 5:** Commit `feat: enrichment decoupled — job completes immediately, enrichment runs in bounded-retry background queue`

---

## Task 8: Dashboard — Strategy Strip (Current Source → Active Sessions → Users/min → Errors → Progress → Next Strategy)

**Objective:** يعالج **R6**. صف واحد أعلى بطاقة التقدم في `ExtractMembersPage.tsx` (وضع running) يقرأ الحقول الجديدة من `jobAny.progress`، بلا مخططات — StatBox موجودة.

**Files:**
- Modify: `src/pages/dashboard/extraction/ExtractMembersPage.tsx:414-425`
- Modify: `src/i18n/locales/ar.json` + `src/i18n/locales/en.json` (قسم `extract.running`)

**Step 1 (i18n):**
```json
// ar.json
"strategySource": "المصدر الحالي",
"strategySessions": "الجلسات النشطة",
"strategyRate": "مستخدم/دقيقة",
"strategyErrors": "الأخطاء",
"strategyDuplicates": "المكرر المتجاهل",
"strategyNext": "الاستراتيجية التالية",
"source_members_list": "قائمة الأعضاء",
"source_members_search": "بحث الأسماء",
"source_feed_cascade": "تدفق المنشورات"
// en.json mirrored
```

**Step 2 (component)** — بعد بلوك posts_done (سطر 414-419) أضف شبكة ثانية:
```tsx
const p = (jobAny?.progress ?? {}) as Record<string, any>;
<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
  <StatBox icon={Layers} label={t("extract.running.strategySource")} value={p.source ? t(`extract.running.source_${p.source}`) : "—"} />
  <StatBox icon={Users} label={t("extract.running.strategySessions")} value={`${p.active_sessions ?? 1}`} />
  <StatBox icon={Gauge} label={t("extract.running.strategyRate")} value={p.rate_per_min ? `${Math.round(p.rate_per_min)}` : "0"} />
  <StatBox icon={AlertTriangle} label={t("extract.running.strategyErrors")} value={`${p.errors_count ?? 0}`} />
  <StatBox icon={RefreshCw} label={t("extract.running.strategyDuplicates")} value={`${p.duplicates_skipped ?? 0}`} />
  <StatBox icon={Navigation} label={t("extract.running.strategyNext")} value={p.next_strategy && p.next_strategy !== "none" ? t(`extract.running.source_${p.next_strategy}`) : "—"} />
</div>
```
(استورد `Layers, Gauge, Navigation` من lucide-react — موجودة في المشروع.) استخدم نفس `StatBox` المعرف في أسفل الملف (512-519). لا `rtl:` variant — النصوص من i18n تلقائياً.

**Step 3:** `npm run typecheck && npm run lint && npm run build` → PASS
**Step 4:** Commit `feat: live strategy strip — source, sessions, rate, errors, duplicates, next strategy`

---

## Task 9: مصفوفة الاختبار اليدوي + إصلاح fallback

**Objective:** التحقق النهائي بمعايير المستخدم + **R7**.

**Step 1 (R7 fix):** `routes/extract.ts:134` — `maxResults: (jobConfig.max_results as number) || 100000` (بدل 10000).

**Step 2 — مصفوفة الاختبار** (خدمة تعمل `cd extraction-service && npm run dev` + داشبورد `npm run dev`):

| # | الحالة | كيف | النجاح المتوقع |
|---|--------|-----|----------------|
| 1 | جلسة واحدة | مهمة groups بمجموعة صغيرة | members → (لو cap) shards → cascade؛ لا أخطاء؛ حفظ تدريجي (result_count يزيد أثناء التشغيل) |
| 2 | جلستان | نفس المهمة بجلسلتين (مع proxy) | active_sessions=2؛ لا بوست معالج مرتين (posts_done ≤ posts_total)؛ overlap mode في اللوج |
| 3 | مجموعة كبيرة | 100k+ members | التحويل members→search→cascade يظهر في strip بـ rate لكل مصدر؛ stop_reason نهائي منطقي |
| 4 | الانتقال Members→Posts | مجموعة members list فيها cap | next_strategy يتحول feed_cascade؛ rate_per_min للمصدر الجديد أعلى |
| 5 | التكرار | أعادة مهمة على نفس الـ workspace | duplicates_skipped يتزايد؛ لا صفوف مكررة في النتائج |
| 6 | فشل جلسة أثناء التنفيذ | أوقف/اقتل جلسة (logout يدوي) mid-run | الجلسة تظهر unavailable مع last_failure_kind=auth؛ worker يُزال؛ الباقي يكمل؛ البوستات المستأجرة تعود للـ queue |
| 7 | استكمال بعد فشل | pause (أو watchdog) ثم resume | تستأنف من checkpoint (تخطي sources_done)؛ النتائج السابقة محفوظة |
| 8 | Enrichment بعد الاستخراج | مهمة كاملة | status=completed فوراً + phase=enriching بالخلفية؛ مهمة ثانية في queue تبدأ فوراً |

**Step 3:** `cd extraction-service && npm run typecheck && npm run build && cd .. && npm run typecheck && npm run lint && npm run build`
**Step 4:** Commit `fix: max_results fallback 100k + manual test matrix verified`

---

## Files Changed Summary

| Action | Path |
|--------|------|
| Create | `extraction-service/src/services/orchestrator-core.ts` |
| Create | `extraction-service/src/services/task-queue.ts` |
| Create | `extraction-service/src/services/session-health.ts` |
| Create | `extraction-service/src/services/enrichment-queue.ts` |
| Create | `extraction-service/src/services/__tests__/{orchestrator-core,task-queue,session-health}.test.ts` |
| Modify | `extraction-service/src/config.ts` (knobs) |
| Modify | `extraction-service/src/types.ts` (snapshots) |
| Modify | `extraction-service/src/services/group-cascade-core.ts` (lease + health) |
| Modify | `extraction-service/src/services/group-members-core.ts` (onSessionEvent) |
| Modify | `extraction-service/src/extractors/group-members.ts` (orchestrator + checkpoint + metrics) |
| Modify | `extraction-service/src/routes/extract.ts` (enrichment queue + fallback + resumeEnrichmentJobs) |
| Modify | `extraction-service/src/index.ts` (boot: resumeEnrichmentJobs) |
| Modify | `src/lib/extraction/types.ts` (progress fields) |
| Modify | `src/pages/dashboard/extraction/ExtractMembersPage.tsx` (strategy strip) |
| Modify | `src/i18n/locales/ar.json`, `src/i18n/locales/en.json` |

**لا تُلمس:** page-followers، messenger، IG، WhatsApp، exports، broadcast، session import، RLS/policies، حذف المهام، types أخرى — كل أنواع الاستخراج غير `groups` تعمل بنفس مسارها (الـ Orchestrator مُفعَّل داخل GroupMembersExtractor فقط).

## Risks & Tradeoffs

- **Playwright requests غير قابلة للـ cancel نظيفاً**: lease expiry يعتمد على عودة worker للـ claim — بوست عالق فعلياً يُعاد معالجته فقط بعد انتهاء محاولة الـ worker. مقبول: التكرار مستحيل (claim حصري + dedup on insert).
- **Enrichment بالخلفية يعني أن النتيجة قد تكتمل بلا هاتف لبضع دقائق** — نفس سلوك اليوم تقريباً لكن الداشبورد يظهر phase=enriching؛ POST /enrich يدوي موجود كـ fallback.
- **checkpoint في job.config** يعني أن resume يتخطى المراحل المنتهية حتى لو أُعيد من صفر — مقصود، وdedup عند الإدخال يضمن عدم التكرار عبر workspace.
- **الاختبارات** جديدة على الخدمة (`node --import tsx --test`) — bلا تُضاف إلى CI الآن إن لم يوجد؛ تُشغَّل يدوياً في Task 1-3, 5.
- **لا زيادة معدل طلبات Facebook** — كل التحسين من إيقاف إهدار الوقت فقط؛ الـ delays البشرية الموجودة كما هي.

## Open Questions (defaults chosen, قابل للتغيير)

1. `ORCH_MIN_RATE_PER_MIN=5` — عتبة "غير منتج". قد تحتاج معاينة من بيانات حقيقية (Task 9 #3).
2. هل نعرض strategy strip في JobDetailsPage أيضاً؟ — الصفحة mock حالياً؛ خارج النطاق.
3. enqueue أولوية المصادر عند تعدد المهام المتزامنة (maxConcurrentJobs=2) — خارج نطاق هذه الخطة.
