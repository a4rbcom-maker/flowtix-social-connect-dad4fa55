/**
 * Normalizes errors thrown by TanStack server functions into a typed,
 * UI-friendly shape. The auth middleware throws raw `Response` objects
 * (status 401/403/500 …) — passing those directly to React renders them
 * as `[object Response]`. Use `normalizeServerFnError(err)` in any
 * `errorComponent` or `try/catch` around `useServerFn(...)` calls.
 */

export type ServerFnErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "NETWORK"
  | "UNKNOWN";

export interface NormalizedServerFnError {
  code: ServerFnErrorCode;
  status: number | null;
  /** Short Arabic title suited for headings / toasts. */
  title: string;
  /** Longer Arabic explanation suited for descriptions. */
  message: string;
  /** Original raw text body if we managed to read one (debug only). */
  rawBody?: string;
  /** The original thrown value, preserved for logging. */
  cause: unknown;
}

const STATUS_MAP: Record<number, { code: ServerFnErrorCode; title: string; message: string }> = {
  400: {
    code: "VALIDATION",
    title: "بيانات غير صحيحة",
    message: "تحقّق من الحقول وحاول مرة أخرى.",
  },
  401: {
    code: "UNAUTHORIZED",
    title: "يلزم تسجيل الدخول",
    message: "انتهت الجلسة أو لم يتم تسجيل الدخول. سجّل الدخول مجدداً للمتابعة.",
  },
  403: {
    code: "FORBIDDEN",
    title: "غير مصرّح",
    message: "ليس لديك صلاحية للوصول إلى هذا المورد.",
  },
  404: {
    code: "NOT_FOUND",
    title: "غير موجود",
    message: "المورد المطلوب غير موجود أو تم حذفه.",
  },
  408: {
    code: "NETWORK",
    title: "انتهت المهلة",
    message: "تأخر الخادم في الرد. حاول مرة أخرى.",
  },
  429: {
    code: "RATE_LIMITED",
    title: "محاولات كثيرة",
    message: "أرسلت طلبات كثيرة في وقت قصير. انتظر قليلاً ثم أعد المحاولة.",
  },
  500: {
    code: "SERVER_ERROR",
    title: "خطأ في الخادم",
    message: "حدث خطأ غير متوقع على الخادم. حاول مرة أخرى بعد قليل.",
  },
  502: {
    code: "SERVER_ERROR",
    title: "خطأ في البوابة",
    message: "تعذّر الوصول للخدمة المطلوبة حالياً.",
  },
  503: {
    code: "SERVER_ERROR",
    title: "الخدمة غير متاحة",
    message: "الخدمة متوقفة مؤقتاً. حاول مرة أخرى بعد قليل.",
  },
  504: {
    code: "NETWORK",
    title: "انتهت مهلة البوابة",
    message: "تأخر الخادم البعيد في الرد. حاول مرة أخرى.",
  },
};

function fromStatus(status: number, rawBody?: string, cause?: unknown): NormalizedServerFnError {
  const entry =
    STATUS_MAP[status] ??
    (status >= 500
      ? STATUS_MAP[500]
      : status >= 400
      ? STATUS_MAP[400]
      : {
          code: "UNKNOWN" as ServerFnErrorCode,
          title: "حدث خطأ",
          message: "تعذّر إكمال العملية. حاول مجدداً.",
        });

  return {
    code: entry.code,
    status,
    title: entry.title,
    message: rawBody && rawBody.length < 240 && /[\u0600-\u06FF]/.test(rawBody)
      ? rawBody // server returned an Arabic message — surface it
      : entry.message,
    rawBody,
    cause,
  };
}

/**
 * Reads a `Response` body safely without throwing. Returns `undefined`
 * if the body has already been consumed or the read fails.
 */
async function safeReadBody(response: Response): Promise<string | undefined> {
  try {
    return await response.clone().text();
  } catch {
    return undefined;
  }
}

/**
 * Synchronous normalization — use inside `errorComponent` where you
 * cannot await. The body of a `Response` won't be read; status drives
 * the message.
 */
export function normalizeServerFnError(error: unknown): NormalizedServerFnError {
  if (error instanceof Response) {
    return fromStatus(error.status, undefined, error);
  }

  // TanStack/Start sometimes wraps the response as { status, body, ... }
  if (typeof error === "object" && error !== null) {
    const e = error as { status?: number; statusCode?: number; message?: string; name?: string };
    const status = typeof e.status === "number"
      ? e.status
      : typeof e.statusCode === "number"
      ? e.statusCode
      : undefined;
    if (typeof status === "number") {
      return fromStatus(status, e.message, error);
    }

    if (typeof e.message === "string") {
      // Network/abort errors from fetch
      if (e.name === "AbortError" || /network|failed to fetch/i.test(e.message)) {
        return {
          code: "NETWORK",
          status: null,
          title: "تعذّر الاتصال",
          message: "تحقّق من الاتصال بالإنترنت وحاول مجدداً.",
          cause: error,
        };
      }

      return {
        code: "UNKNOWN",
        status: null,
        title: "حدث خطأ",
        message: e.message,
        cause: error,
      };
    }
  }

  if (typeof error === "string") {
    return {
      code: "UNKNOWN",
      status: null,
      title: "حدث خطأ",
      message: error,
      cause: error,
    };
  }

  return {
    code: "UNKNOWN",
    status: null,
    title: "حدث خطأ",
    message: "تعذّر إكمال العملية. حاول مجدداً.",
    cause: error,
  };
}

/**
 * Async variant — reads `Response` body so server-provided Arabic
 * messages surface verbatim. Prefer this in try/catch blocks where you
 * have access to await.
 */
export async function normalizeServerFnErrorAsync(
  error: unknown,
): Promise<NormalizedServerFnError> {
  if (error instanceof Response) {
    const body = await safeReadBody(error);
    return fromStatus(error.status, body, error);
  }
  return normalizeServerFnError(error);
}

export function isUnauthorized(error: NormalizedServerFnError): boolean {
  return error.code === "UNAUTHORIZED";
}

export function isForbidden(error: NormalizedServerFnError): boolean {
  return error.code === "FORBIDDEN";
}
