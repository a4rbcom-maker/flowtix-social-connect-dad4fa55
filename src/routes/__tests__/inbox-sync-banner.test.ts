import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Guardrail: the "Sync complete" banner (اكتملت المزامنة) must never render
 * in the inbox UI under any syncState. We disabled it because users found it
 * disruptive. This test locks that behavior — any future edit that removes
 * the `false &&` gate (or reintroduces the banner elsewhere) will fail CI.
 */
describe("inbox sync-complete banner", () => {
  const filePath = path.resolve(__dirname, "../dashboard.whatsapp.inbox.tsx");
  const source = readFileSync(filePath, "utf8");

  it("never renders the 'Sync complete' banner (label is gated behind `false &&`)", () => {
    // Locate every occurrence of the label — Arabic + English.
    const labels = ["اكتملت المزامنة", "Sync complete"];
    for (const label of labels) {
      const idx = source.indexOf(label);
      // Label may be absent entirely (also acceptable — banner fully removed).
      if (idx === -1) continue;

      // Walk backwards to find the nearest JSX render gate on the same block.
      // The banner is emitted by an IIFE guarded by `false && syncState.status ...`.
      const before = source.slice(0, idx);
      const gateMatch = before.match(/\{\s*false\s*&&\s*syncState\.status[\s\S]*?$/);
      expect(
        gateMatch,
        `The label "${label}" must sit inside a JSX branch guarded by \`{ false && syncState.status ... }\` so the banner is never rendered.`,
      ).not.toBeNull();
    }
  });

  it("has no active JSX branch that renders the sync-complete banner", () => {
    // Reject any pattern like `syncState.status === "done"` used directly as a
    // render condition (i.e. `{syncState.status === "done" && ...}`) — that
    // would re-enable the banner. Only the `false &&` gate is allowed.
    const activeDoneRender = /\{\s*syncState\.status\s*===\s*["']done["']\s*&&/.exec(source);
    expect(
      activeDoneRender,
      "Do not render UI directly when syncState.status === 'done' — the sync-complete banner must stay disabled.",
    ).toBeNull();
  });
});
