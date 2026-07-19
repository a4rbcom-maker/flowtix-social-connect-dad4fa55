// Human-friendly Arabic messages for common Facebook Graph API errors.
// Keeps UI clean: no PDT timestamps, no English stack traces.

export function humanizeFbError(raw: unknown): string {
  const msg = typeof raw === "string" ? raw : raw instanceof Error ? raw.message : String(raw ?? "");
  const s = msg.toLowerCase();

  // Token expired / invalid
  if (
    s.includes("session has expired") ||
    s.includes("access token") ||
    s.includes("oauthexception") ||
    s.includes("token is invalid") ||
    s.includes("invalid oauth") ||
    s.includes("error validating")
  ) {
    return "انتهت صلاحية جلسة فيسبوك. برجاء إعادة ربط الحساب من صفحة الربط.";
  }

  if (s.includes("permission") || s.includes("scope")) {
    return "الصلاحيات غير كافية. أعد ربط الحساب مع الموافقة على جميع الصلاحيات المطلوبة.";
  }

  if (s.includes("rate limit") || s.includes("too many")) {
    return "تم تجاوز الحد المسموح من الطلبات. برجاء المحاولة بعد قليل.";
  }

  if (s.includes("network") || s.includes("fetch failed") || s.includes("timeout")) {
    return "تعذر الاتصال بخوادم فيسبوك. تحقق من الاتصال وحاول مجددًا.";
  }

  if (!msg.trim()) return "حدث خطأ غير متوقع. برجاء المحاولة مرة أخرى.";

  // Fallback: if raw message is pure English/tech, hide it behind a generic line.
  const hasArabic = /[\u0600-\u06FF]/.test(msg);
  return hasArabic ? msg : "تعذر إتمام العملية. برجاء إعادة ربط الحساب أو المحاولة لاحقًا.";
}
