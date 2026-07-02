import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Guardrail: the inbox must never surface sync banners, toasts, or status
 * messages to end customers — not the "sync complete" banner, not the
 * "fetching all chats" progress bar, not any variant introduced by a future
 * refactor. This test locks that behavior across renames and rewrites.
 *
 * If this test fails, do NOT loosen it. Remove the offending UI instead.
 */
describe("inbox sync UI is invisible to customers", () => {
  const filePath = path.resolve(__dirname, "../dashboard.whatsapp.inbox.tsx");
  const source = readFileSync(filePath, "utf8");

  // Strip TS/JS comments so `// ...` or /* ... */ notes don't count as UI.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  // 1) Forbid every known banner label — Arabic + English, all statuses.
  const forbiddenLabels = [
    "اكتملت المزامنة",
    "Sync complete",
    "Sync completed",
    "تم تحديث المحادثات والرسائل",
    "Conversations and messages refreshed",
    "resyncDone",
    "جاري جلب كل المحادثات",
    "جارٍ جلب كل المحادثات",
    "Fetching all chats",
    "بانتظار بدء المزامنة",
    "Waiting to start",
  ];
  for (const label of forbiddenLabels) {
    it(`does not render the label "${label}"`, () => {
      expect(
        code.includes(label),
        `The label "${label}" must not appear in the inbox — sync completion indicators are forbidden and any variant of it counts as a regression.`,
      ).toBe(false);
    });
  }

  // 1b) Forbid any "done" completion state on syncState — completion must be silent.
  it("never transitions syncState to a 'done' status", () => {
    const doneTransition = /status:\s*["']done["']/;
    expect(
      doneTransition.test(code),
      "syncState must never be set to status 'done' — completion has to stay silent (transition straight to 'idle').",
    ).toBe(false);
  });

  // 2) Forbid any active JSX render branch keyed off syncState.status.
  //    Only allowed occurrences: reads inside effects / handlers / setState
  //    calls. A render branch looks like `{syncState.status ...` (JSX brace
  //    followed directly by the expression) — that must not exist.
  it("has no active JSX render branch driven by syncState.status", () => {
    const renderBranch = /\{\s*syncState\.status\s*(===|!==|&&)/g;
    const matches = [...code.matchAll(renderBranch)];
    expect(
      matches.map((m) => m[0]),
      "syncState.status must not be used as a JSX render condition — the sync banner must stay invisible to customers.",
    ).toEqual([]);
  });

  // 3) Forbid toast.* calls fired from the historySync mutation lifecycle.
  //    We scan the mutation body and reject any sonner toast inside it.
  it("historySyncMut never fires a toast", () => {
    const start = code.indexOf("historySyncMut = useMutation");
    if (start === -1) return; // mutation removed entirely — even better.
    // Grab a generous window covering the mutation config object.
    const window = code.slice(start, start + 4000);
    const toastCall = /\btoast\.(success|error|info|warning|message|loading)\s*\(/.exec(
      window,
    );
    expect(
      toastCall?.[0],
      "Do not call toast.* from historySyncMut — sync progress and failures must stay silent for end customers.",
    ).toBeUndefined();
  });

  // 4) The refresh button must not expose a "syncing" label to customers.
  it("refresh button does not show a 'Syncing…' label", () => {
    const syncingLabels = ["جارٍ المزامنة…", "جاري المزامنة…", "Syncing…", "Syncing..."];
    // These strings may still exist as translation entries (t.resyncing) —
    // what matters is that the button JSX doesn't read them.
    const buttonUsesResyncing = /\{[^}]*\bt\.resyncing\b[^}]*\}/.test(code);
    expect(
      buttonUsesResyncing,
      "The refresh button must not render t.resyncing — customers should only ever see the neutral resync label.",
    ).toBe(false);
    // Also reject any hardcoded syncing string appearing directly in JSX.
    for (const label of syncingLabels) {
      // Match only when the label sits directly as JSX text between `>` and `<`,
      // with no intervening quote or brace (which would indicate a string literal
      // or expression, not visible text).
      const escaped = label.replace(/[.…]/g, "\\$&");
      const inJsx = new RegExp(`>[^<"{}]*${escaped}[^<"{}]*<`).test(code);
      expect(inJsx, `Hardcoded "${label}" must not appear as visible JSX text.`).toBe(false);
    }
  });
});
