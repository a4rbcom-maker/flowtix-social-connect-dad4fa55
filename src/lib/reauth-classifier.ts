const EXTERNAL_SESSION_ERROR_RE =
  /\b(?:facebook|meta|whatsapp|wa[-_\s]?bridge|bot|cookie|cookies|c_user|checkpoint)\b|SESSION_EXPIRED|session\s+(?:lost|not\s+logged\s+in)|redirected\s+to\s+login|login\s+required|cookies?\s+(?:rejected|invalid|expired)|Facebook rejected the stored session cookies/i;

const APP_AUTH_ERROR_MESSAGE_RE =
  /\b(?:unauthorized|auth_required|auth_invalid|not\s+authenticated|no\s+auth\s+session|jwt\s+expired|invalid\s+(?:jwt|access\s+token|authorization)|authorization\s+header|bearer\s+token)\b|\b401\b/i;

export function getErrorStatus(err: unknown): number | undefined {
  return err instanceof Response
    ? err.status
    : (err as { status?: number; statusCode?: number } | null)?.status ??
        (err as { statusCode?: number } | null)?.statusCode;
}

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const maybe = err as { message?: unknown; error?: unknown };
    if (typeof maybe.message === "string") return maybe.message;
    if (typeof maybe.error === "string") return maybe.error;
  }
  return "";
}

export function isExternalServiceSessionError(err: unknown): boolean {
  return EXTERNAL_SESSION_ERROR_RE.test(getErrorMessage(err));
}

export function isAppAuthError(err: unknown): boolean {
  if (isExternalServiceSessionError(err)) return false;

  const status = getErrorStatus(err);
  const message = getErrorMessage(err);
  if (status === 401) return true;
  if (status === 403) return APP_AUTH_ERROR_MESSAGE_RE.test(message);
  return APP_AUTH_ERROR_MESSAGE_RE.test(message);
}
