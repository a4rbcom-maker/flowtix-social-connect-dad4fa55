export const ErrorCodes = {
  SESSION_EXPIRED: "SESSION_EXPIRED",
  AUTH_FAILED: "AUTH_FAILED",
  TIMEOUT: "TIMEOUT",
  NETWORK_ERROR: "NETWORK_ERROR",
  QUEUE_FULL: "QUEUE_FULL",
  BROWSER_CRASH: "BROWSER_CRASH",
  INVALID_INPUT: "INVALID_INPUT",
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
  SESSION_NOT_CONNECTED: "SESSION_NOT_CONNECTED",
  NO_COOKIES: "NO_COOKIES",
  EXTRACTION_FAILED: "EXTRACTION_FAILED",
  JOB_ALREADY_ACTIVE: "JOB_ALREADY_ACTIVE",
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

const RETRYABLE_CODES = new Set<ErrorCode>([
  ErrorCodes.TIMEOUT,
  ErrorCodes.NETWORK_ERROR,
  ErrorCodes.BROWSER_CRASH,
]);

export function isRetryable(code: ErrorCode): boolean {
  return RETRYABLE_CODES.has(code);
}

export class ExtractionError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "ExtractionError";
    this.code = code;
  }
}
