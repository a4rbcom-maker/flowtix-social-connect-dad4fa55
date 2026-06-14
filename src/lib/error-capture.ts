let lastCapturedError: { error: unknown; at: number } | undefined;
const TTL_MS = 5_000;

function record(error: unknown) {
  lastCapturedError = { error, at: Date.now() };
}

const globalWithEvents = globalThis as typeof globalThis & {
  addEventListener?: (type: string, listener: (event: Event) => void) => void;
};

if (typeof globalWithEvents.addEventListener === "function") {
  globalWithEvents.addEventListener("error", (event) => {
    record((event as ErrorEvent).error ?? event);
  });
  globalWithEvents.addEventListener("unhandledrejection", (event) => {
    record((event as PromiseRejectionEvent).reason ?? event);
  });
}

export function consumeLastCapturedError(): unknown {
  if (!lastCapturedError) return undefined;
  if (Date.now() - lastCapturedError.at > TTL_MS) {
    lastCapturedError = undefined;
    return undefined;
  }

  const { error } = lastCapturedError;
  lastCapturedError = undefined;
  return error;
}