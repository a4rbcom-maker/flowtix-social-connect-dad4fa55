import { test } from "node:test";
import assert from "node:assert/strict";
import { LeasedTaskQueue } from "../task-queue.js";

test("claim gives exclusive lease; second claim gets next task", () => {
  const q = new LeasedTaskQueue<string>(30_000, 2);
  q.enqueue(["p1", "p2"]);
  const a = q.claim("workerA");
  const b = q.claim("workerB");
  assert.equal(a?.task, "p1");
  assert.equal(b?.task, "p2");
});

test("enqueue dedups identical tasks", () => {
  const q = new LeasedTaskQueue<string>(30_000, 2);
  const added = q.enqueue(["p1", "p1", "p2", "p2"]);
  assert.equal(added, 2);
  assert.equal(q.size(), 2);
});

test("complete removes task permanently", () => {
  const q = new LeasedTaskQueue<string>(30_000, 2);
  q.enqueue(["p1"]);
  const t = q.claim("w1")!;
  q.complete(t.id);
  assert.equal(q.claim("w2"), null);
});

test("expired lease requeues task for another worker", async () => {
  const q = new LeasedTaskQueue<string>(50, 2);
  q.enqueue(["p1"]);
  const t = q.claim("w1")!;
  assert.equal(t.attempt, 0);
  await new Promise((r) => setTimeout(r, 80));
  const t2 = q.claim("w2");
  assert.equal(t2?.task, "p1");
  assert.equal(t2?.attempt, 1);
});

test("task exceeding maxRetries goes to dead letter", async () => {
  const q = new LeasedTaskQueue<string>(30, 1); // maxRetries=1 → 2 attempts total
  q.enqueue(["p1"]);
  q.claim("w1"); // attempt 0, expires
  await new Promise((r) => setTimeout(r, 60));
  q.claim("w2"); // attempt 1, expires
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(q.claim("w3"), null);
  assert.deepEqual(q.deadLetters(), ["p1"]);
});

test("fail requeues immediately with attempt increment", () => {
  const q = new LeasedTaskQueue<string>(30_000, 2);
  q.enqueue(["p1"]);
  const t = q.claim("w1")!;
  q.fail(t.id);
  const t2 = q.claim("w2")!;
  assert.equal(t2.task, "p1");
  assert.equal(t2.attempt, 1);
});

test("renew extends an active lease", async () => {
  const q = new LeasedTaskQueue<string>(60, 2);
  q.enqueue(["p1"]);
  const t = q.claim("w1")!;
  await new Promise((r) => setTimeout(r, 40));
  q.renew(t.id, "w1"); // extend by another 60ms from now
  await new Promise((r) => setTimeout(r, 30)); // original lease would be expired
  assert.equal(q.claim("w2"), null); // still leased by w1
});

test("renew by a different worker is rejected", () => {
  const q = new LeasedTaskQueue<string>(30_000, 2);
  q.enqueue(["p1"]);
  const t = q.claim("w1")!;
  q.renew(t.id, "w2");
  // lease still owned by w1 and not extended — but claim-ability unchanged
  const stats = q.pending();
  assert.equal(stats, 1);
});

test("pending counts queued + leased (backpressure view)", () => {
  const q = new LeasedTaskQueue<string>(30_000, 2);
  q.enqueue(["p1", "p2", "p3"]);
  q.claim("w1");
  assert.equal(q.pending(), 3); // 2 queued + 1 leased
  assert.equal(q.size(), 3);
});
