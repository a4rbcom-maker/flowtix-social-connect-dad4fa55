# Contract: AI Compose API

**Feature**: `008-wa-inbox-redesign` | **Date**: 2026-08-08

## Endpoint: POST /ai/compose

يُضاف إلى `extraction-service/src/ai/routes.ts` بجانب `POST /ai/test` الموجود.

### Request

```
POST /ai/compose
Headers:
  Content-Type: application/json
  X-API-Key: <VITE_EXTRACTION_API_KEY>

Body:
{
  "workspace_id": "uuid",
  "action": "rephrase" | "fix_grammar" | "professional" | "casual" | "shorten" | "expand" | "translate" | "suggest_reply",
  "text": "النص المراد معالجته (مطلوب لكل الإجراءات ما عدا suggest_reply)",
  "context": "سياق المحادثة - آخر 5 رسائل منسقة (مطلوب لـ suggest_reply)"
}
```

### Response

#### نجاح
```json
{
  "success": true,
  "content": "النص المعالَج أو المقترح",
  "latency_ms": 1200
}
```

#### فشل
```json
{
  "success": false,
  "error": "وصف الخطأ بالعربية",
  "code": "AI_UNAVAILABLE" | "INVALID_INPUT" | "TIMEOUT"
}
```

### System Prompts حسب Action

| Action | System Prompt |
|---|---|
| `rephrase` | "أعد صياغة النص التالي بأسلوب أفضل مع الحفاظ على المعنى" |
| `fix_grammar` | "صحّح الأخطاء الإملائية والنحوية في النص التالي" |
| `professional` | "أعد كتابة النص التالي بأسلوب احترافي ورسمي" |
| `casual` | "أعد كتابة النص التالي بأسلوب ودي وغير رسمي" |
| `shorten` | "اختصر النص التالي مع الحفاظ على المعنى الأساسي" |
| `expand` | "وسّع النص التالي وأضف تفاصيل مناسبة" |
| `translate` | "ترجم النص التالي — إذا كان عربياً فإلى الإنجليزية والعكس" |
| `suggest_reply` | "بناءً على سياق المحادثة التالي، اقترح رداً مناسباً ومهذباً" |

### الاستخدام من الواجهة

```typescript
// src/lib/inbox-ai.ts
import { waInboxConfig } from "@/lib/wa-inbox";

export async function composeWithAi(params: {
  workspaceId: string;
  action: AiAction;
  text?: string;
  context?: string;
}): Promise<{ success: boolean; content: string; error?: string }> {
  const apiUrl = import.meta.env.VITE_EXTRACTION_API_URL || "http://localhost:3100";
  const apiKey = import.meta.env.VITE_EXTRACTION_API_KEY || "local-dev-key-change-in-production";

  const res = await fetch(`${apiUrl}/ai/compose`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
    body: JSON.stringify({
      workspace_id: params.workspaceId,
      action: params.action,
      text: params.text,
      context: params.context,
    }),
  });

  const json = await res.json().catch(() => ({}));
  return {
    success: json.success ?? false,
    content: json.content ?? "",
    error: json.success ? undefined : (json.error ?? `HTTP ${res.status}`),
  };
}
```

### الأمان
- الـ API Key للـ extraction-service يُرسل في الـ header `X-API-Key`
- مفاتيح Kie.ai محفوظة في `ai_provider_configs` في الخادم ولا تُكشف للواجهة
- الـ endpoint يتحقق من `workspace_id` قبل المعالجة
- timeout: 30 ثانية (موروث من `kieChat`)

### معدل الطلبات (Rate Limiting)
- لا rate limiting إضافي في v1 — يعتمد على rate limit الخاص بـ Kie.ai
- الـ UI يمنع تكرار الطلب أثناء pending (disabled state)
