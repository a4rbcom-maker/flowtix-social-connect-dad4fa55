// Classifies a WhatsApp send failure into a human-friendly reason and a
// short list of retry steps, so the UI can render one inline alert instead
// of a raw toast with a cryptic bridge/socket message.
export type SendErrorKind =
  | "session_disconnected"
  | "bridge_unreachable"
  | "timeout"
  | "rate_limited"
  | "media_too_large"
  | "media_unsupported"
  | "invalid_recipient"
  | "unauthorized"
  | "unknown";

export type SendErrorInfo = {
  kind: SendErrorKind;
  title: { ar: string; en: string };
  reason: { ar: string; en: string };
  steps: { ar: string; en: string }[];
  /** True when a plain "retry" button will likely succeed without user action. */
  retryable: boolean;
};

function m(s: string): string {
  return (s || "").toLowerCase();
}

export function classifySendError(err: unknown): SendErrorInfo {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const t = m(raw);

  // Session / socket down on the bridge side (WA logged out, phone offline, socket closed).
  if (
    /session.*(not.?found|closed|logged.?out|disconnected)/.test(t) ||
    /\b401\b|unauthorized/.test(t) && /session|whatsapp|bridge/.test(t) ||
    /wa.*not.*connected|phone.*offline|no.*active.*session/.test(t)
  ) {
    return {
      kind: "session_disconnected",
      title: { ar: "جلسة واتساب غير متصلة", en: "WhatsApp session offline" },
      reason: {
        ar: "الجلسة على الخادم غير متصلة الآن، فلن يستطيع البوت إرسال الرسالة.",
        en: "The WhatsApp session on the bridge is not connected right now, so the message cannot be sent.",
      },
      steps: [
        {
          ar: "افتح صفحة «الحسابات المربوطة» وتأكد أن الحالة «متصل».",
          en: "Open the Linked Accounts page and confirm the status is “Connected”.",
        },
        {
          ar: "تأكد أن هاتفك متصل بالإنترنت وواتساب مفتوح.",
          en: "Make sure your phone is online and WhatsApp is open.",
        },
        {
          ar: "لو الحالة غير متصلة، اضغط «توليد كود QR جديد» وأعد الربط ثم أعد الإرسال.",
          en: "If disconnected, generate a fresh QR, re-link, then retry sending.",
        },
      ],
      retryable: false,
    };
  }

  // Bridge network layer
  if (/bridge.*(network|unreachable|timed?.?out)|econnrefused|econnreset|network|fetch.*failed/.test(t)) {
    if (/timed?.?out|timeout|504/.test(t)) {
      return {
        kind: "timeout",
        title: { ar: "انتهت مهلة الإرسال", en: "Send timed out" },
        reason: {
          ar: "استغرق الخادم وقتاً أطول من المسموح للرد. الرسالة قد تكون وصلت أو لا.",
          en: "The bridge took too long to respond. The message may or may not have been delivered.",
        },
        steps: [
          {
            ar: "انتظر 5-10 ثوانٍ ثم اضغط «إعادة المحاولة».",
            en: "Wait 5-10 seconds then click “Retry”.",
          },
          {
            ar: "افتح المحادثة على هاتفك وتحقق من وصول الرسالة قبل إعادة الإرسال.",
            en: "Open the chat on your phone and check whether the message arrived before resending.",
          },
        ],
        retryable: true,
      };
    }
    return {
      kind: "bridge_unreachable",
      title: { ar: "تعذر الوصول إلى خدمة الإرسال", en: "Send service unreachable" },
      reason: {
        ar: "الاتصال بخادم الإرسال فشل مؤقتاً (شبكة أو صيانة).",
        en: "Could not reach the bridge service (network issue or brief maintenance).",
      },
      steps: [
        { ar: "تحقق من اتصالك بالإنترنت.", en: "Check your internet connection." },
        {
          ar: "أعد المحاولة بعد لحظات — الاتصال يعود عادةً خلال ثوانٍ.",
          en: "Retry in a moment — the service usually recovers within seconds.",
        },
      ],
      retryable: true,
    };
  }

  if (/rate.?limit|429|too.?many.?requests|throttle/.test(t)) {
    return {
      kind: "rate_limited",
      title: { ar: "تجاوز حدّ الإرسال المسموح", en: "Send rate limit reached" },
      reason: {
        ar: "تم تجاوز حد الإرسال لحماية الرقم من الحظر.",
        en: "You reached the send rate limit designed to protect the number from bans.",
      },
      steps: [
        { ar: "انتظر دقيقة ثم أعد المحاولة.", en: "Wait a minute, then retry." },
        {
          ar: "لو كانت هناك حملة جماعية شغّالة، خفض التوازي أو أوقفها مؤقتاً.",
          en: "If a bulk campaign is running, lower its concurrency or pause it.",
        },
      ],
      retryable: false,
    };
  }

  if (/(too|max).*(large|size)|file.*(too.*large|size)|payload.*large|413|16 ?mb/.test(t)) {
    return {
      kind: "media_too_large",
      title: { ar: "الملف كبير جداً", en: "File is too large" },
      reason: {
        ar: "واتساب يقبل حتى 16 ميجابايت للصور والفيديو.",
        en: "WhatsApp accepts up to 16 MB for images and video.",
      },
      steps: [
        { ar: "اضغط الصورة/الفيديو أو أعد ترميزه بجودة أقل.", en: "Compress the media or re-encode it at a lower quality." },
        { ar: "أعد المحاولة بملف أصغر.", en: "Retry with a smaller file." },
      ],
      retryable: false,
    };
  }

  if (/unsupported.*media|mime|content.?type/.test(t)) {
    return {
      kind: "media_unsupported",
      title: { ar: "نوع الملف غير مدعوم", en: "Unsupported media type" },
      reason: {
        ar: "واتساب لم يقبل صيغة هذا الملف.",
        en: "WhatsApp did not accept this file format.",
      },
      steps: [
        { ar: "استخدم JPG/PNG للصور أو MP4 للفيديو أو PDF للمستندات.", en: "Use JPG/PNG for images, MP4 for video, PDF for documents." },
      ],
      retryable: false,
    };
  }

  if (/invalid.*(jid|recipient|number|phone)|not.*whatsapp.*user|no.?such.?user/.test(t)) {
    return {
      kind: "invalid_recipient",
      title: { ar: "المستلم غير صالح", en: "Invalid recipient" },
      reason: {
        ar: "هذا المستلم ليس رقم واتساب صالحاً أو لا يمكن التواصل معه من هذا الحساب.",
        en: "This recipient is not a valid WhatsApp number or cannot be contacted from this account.",
      },
      steps: [
        { ar: "تأكد من الرقم بالكامل مع كود الدولة.", en: "Verify the full number with country code." },
      ],
      retryable: false,
    };
  }

  if (/\b401\b|unauthorized|forbidden|\b403\b/.test(t)) {
    return {
      kind: "unauthorized",
      title: { ar: "صلاحية غير كافية", en: "Not authorized" },
      reason: {
        ar: "الطلب رُفض بسبب انتهاء الجلسة أو صلاحيات ناقصة.",
        en: "The request was rejected due to an expired session or missing permission.",
      },
      steps: [
        { ar: "سجّل الخروج وسجّل الدخول مرة أخرى.", en: "Sign out and sign in again." },
        { ar: "لو استمرت المشكلة، أعد ربط جلسة واتساب.", en: "If it persists, re-link the WhatsApp session." },
      ],
      retryable: false,
    };
  }

  return {
    kind: "unknown",
    title: { ar: "تعذر إرسال الرسالة", en: "Could not send the message" },
    reason: {
      ar: raw ? `السبب التقني: ${raw.slice(0, 200)}` : "حدث خطأ غير متوقع أثناء الإرسال.",
      en: raw ? `Technical reason: ${raw.slice(0, 200)}` : "An unexpected error occurred while sending.",
    },
    steps: [
      { ar: "اضغط «إعادة المحاولة».", en: "Click “Retry”." },
      {
        ar: "لو تكرر الخطأ، افتح صفحة «الحسابات المربوطة» وتأكد من حالة الجلسة.",
        en: "If it repeats, open Linked Accounts and confirm the session status.",
      },
    ],
    retryable: true,
  };
}
