// Debounced invalidation scheduler used by the WhatsApp inbox realtime handler.
// Bursts of realtime events (INSERT/UPDATE on wa_messages/wa_conversations)
// must collapse into ONE query invalidation per key, so a batch of 100 incoming
// rows never triggers 100 refetches.
//
// The tests in src/lib/__tests__/wa-inbox-invalidation.test.ts pin this
// contract and count the actual invalidate() calls.

export interface DebouncedInvalidator {
  /** Schedule an invalidate; repeated calls within the window are coalesced. */
  schedule: () => void;
  /** Cancel a pending invalidate (used on cleanup). */
  cancel: () => void;
  /** True while a call is pending. */
  isPending: () => boolean;
}

export function createDebouncedInvalidator(
  invalidate: () => void,
  waitMs: number,
  timers: {
    setTimeout: (fn: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
  } = {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms) as unknown,
    clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
  },
): DebouncedInvalidator {
  let handle: unknown = undefined;
  return {
    schedule() {
      if (handle !== undefined) return; // burst → collapse
      handle = timers.setTimeout(() => {
        handle = undefined;
        invalidate();
      }, waitMs);
    },
    cancel() {
      if (handle !== undefined) {
        timers.clearTimeout(handle);
        handle = undefined;
      }
    },
    isPending() {
      return handle !== undefined;
    },
  };
}
