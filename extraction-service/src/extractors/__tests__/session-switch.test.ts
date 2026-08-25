import { test } from "node:test";
import assert from "node:assert/strict";
import { BaseExtractor } from "../base.js";
import type { Page, JobContext } from "../../types.js";

// Minimal Page stub — only what switchToNextSession touches.
function fakePage(closed: boolean, id: string): Page {
  return {
    isClosed: () => closed,
    // the rest are unused by switchToNextSession
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
    workspaceId: null,
    userId: "u",
    sessionId,
    type: "post_reactions" as any,
    sourceUrl: "https://facebook.com/photo/?fbid=1",
    maxResults: 100,
    skipDuplicates: true,
    cursor: undefined,
  }) as JobContext;

test("switchToNextSession skips a DEAD secondary and lands on a live one", async () => {
  const primary = fakePage(false, "primary");
  const dead = fakePage(true, "dead-sec");
  const live = fakePage(false, "live-sec");
  const h = new SwitchHarness(primary, baseCtx("primary"), [
    { sessionId: "dead-sec", page: dead },
    { sessionId: "live-sec", id: "live-sec" } as any,
  ]);
  // replace second entry page with the live one
  (h as any).secondarySessionPages[1].page = live;

  const switched = await (h as any).testSwitch();
  assert.equal(switched, true);
  assert.equal((h as any).activeSession, "live-sec");
});

test("switchToNextSession returns to PRIMARY when all secondaries are closed", async () => {
  const primary = fakePage(false, "primary");
  const dead1 = fakePage(true, "d1");
  const dead2 = fakePage(true, "d2");
  const h = new SwitchHarness(primary, baseCtx("primary"), [
    { sessionId: "d1", page: dead1 },
    { sessionId: "d2", page: dead2 },
  ]);
  // active starts on a secondary that is now dead
  (h as any).activeSessionIndex = 1;
  (h as any).ctx.sessionId = "d1";

  const switched = await (h as any).testSwitch();
  assert.equal(switched, true);
  assert.equal((h as any).activeSession, "primary");
});

test("switchToNextSession returns false when EVERYTHING is closed", async () => {
  const deadPrimary = fakePage(true, "primary");
  const deadSec = fakePage(true, "d1");
  const h = new SwitchHarness(deadPrimary, baseCtx("d1"), [
    { sessionId: "d1", page: deadSec },
  ]);
  const switched = await (h as any).testSwitch();
  assert.equal(switched, false);
});

test("switchToNextSession returns false when there are no secondaries", async () => {
  const primary = fakePage(false, "primary");
  const h = new SwitchHarness(primary, baseCtx("primary"), []);
  const switched = await (h as any).testSwitch();
  assert.equal(switched, false);
});
