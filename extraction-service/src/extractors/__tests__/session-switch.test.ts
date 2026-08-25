import { test } from "node:test";
import assert from "node:assert/strict";
import { BaseExtractor } from "../base.js";
import type { Page } from "playwright";
import type { JobContext } from "../../types.js";

// Minimal Page stub — only what switchToNextSession touches.
function fakePage(closed: boolean): Page {
  return {
    isClosed: () => closed,
  } as unknown as Page;
}

class SwitchHarness extends BaseExtractor {
  constructor(
    primary: Page,
    ctx: JobContext,
    secondaries: Array<{ sessionId: string; page: Page }>,
  ) {
    super(primary, ctx, secondaries);
  }
  async extract() {
    return { extracted: 0, done: true, authState: "authenticated" as const };
  }
  async testSwitch(): Promise<boolean> {
    return this.switchToNextSession();
  }
  get activeSession() {
    return this.ctx.sessionId;
  }
}

const baseCtx = (sessionId: string): JobContext =>
  ({
    jobId: "test-job",
    workspaceId: "",
    userId: "u",
    sessionId,
    type: "post_reactions" as any,
    sourceUrl: "https://facebook.com/photo/?fbid=1",
    maxResults: 100,
    skipDuplicates: true,
    cursor: undefined,
  }) as JobContext;

test("switchToNextSession skips a DEAD secondary and lands on a live one", async () => {
  const primary = fakePage(false);
  const dead = fakePage(true);
  const live = fakePage(false);
  const h = new SwitchHarness(primary, baseCtx("primary"), [
    { sessionId: "dead-sec", page: dead },
    { sessionId: "live-sec", page: live },
  ]);

  const switched = await h.testSwitch();
  assert.equal(switched, true);
  assert.equal(h.activeSession, "live-sec");
});

test("switchToNextSession returns to PRIMARY when all secondaries are closed", async () => {
  const primary = fakePage(false);
  const dead1 = fakePage(true);
  const dead2 = fakePage(true);
  const h = new SwitchHarness(primary, baseCtx("primary"), [
    { sessionId: "d1", page: dead1 },
    { sessionId: "d2", page: dead2 },
  ]);
  // active starts on a secondary that is now dead
  (h as any).activeSessionIndex = 1;
  (h as any).ctx.sessionId = "d1";

  const switched = await h.testSwitch();
  assert.equal(switched, true);
  assert.equal(h.activeSession, "primary");
});

test("switchToNextSession returns false when EVERYTHING is closed", async () => {
  const deadPrimary = fakePage(true);
  const deadSec = fakePage(true);
  const h = new SwitchHarness(deadPrimary, baseCtx("d1"), [
    { sessionId: "d1", page: deadSec },
  ]);
  const switched = await h.testSwitch();
  assert.equal(switched, false);
});

test("switchToNextSession returns false when there are no secondaries", async () => {
  const primary = fakePage(false);
  const h = new SwitchHarness(primary, baseCtx("primary"), []);
  const switched = await h.testSwitch();
  assert.equal(switched, false);
});
