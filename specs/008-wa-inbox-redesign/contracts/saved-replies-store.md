# Contract: Saved Replies Store

**Feature**: `008-wa-inbox-redesign` | **Date**: 2026-08-08

## التخزين

- **الموقع**: `localStorage` في المتصفح
- **المفتاح**: `flowtix_saved_replies`
- **الصيغة**: JSON array من `SavedReply`

## الـ Hook: useSavedReplies

```typescript
// src/hooks/useSavedReplies.ts

interface SavedReply {
  id: string;
  name: string;
  shortcut: string;
  body: string;
  category: SavedReplyCategory;
  created_at: number;
  updated_at: number;
}

type SavedReplyCategory = "greeting" | "follow_up" | "offer" | "reminder" | "thanks" | "survey";

interface UseSavedReplies {
  replies: SavedReply[];
  isLoading: boolean;
  addReply: (input: Omit<SavedReply, "id" | "created_at" | "updated_at">) => SavedReply;
  updateReply: (id: string, updates: Partial<Omit<SavedReply, "id" | "created_at">>) => void;
  deleteReply: (id: string) => void;
  searchReplies: (query: string) => SavedReply[];
  getByShortcut: (shortcut: string) => SavedReply | undefined;
  categories: SavedReplyCategory[];
}
```

## قواعد الاختصارات (Shortcuts)

- تُكتب في صندوق الكتابة بدون `/` (مثال: كتابة `/welcome` → البحث عن `welcome`)
- عند كتابة `/` يظهر popover بقائمة كل الردود المحفوظة
- البحث فوري في `name` + `shortcut` + `body`
- اختصار رد → يُدرج `body` في مكان المؤشر (يستبدل النص من `/` حتى نهاية الكلمة)

## التحقق (Validation)

| الحقل | القاعدة |
|---|---|
| `name` | مطلوب، 1-50 حرف |
| `shortcut` | مطلوب، `^[a-z0-9_]+$`، 2-30 حرف، فريد |
| `body` | مطلوب، 1-4096 حرف |
| `category` | واحد من القيم المسموحة |

## تصنيفات الردود (Categories)

| القيمة | الاسم العربي | اللون المقترح |
|---|---|---|
| `greeting` | ترحيب | أخضر (`green`) |
| `follow_up` | متابعة | أزرق (`blue`) |
| `offer` | عروض | برتقالي (`amber`) |
| `reminder` | تذكير | بنفسجي (`violet`) |
| `thanks` | شكر | وردي (`pink`) |
| `survey` | استبيان | سماوي (`cyan`) |

## أمثلة افتراضية (Seeded on first use)

عند أول استخدام (لا توجد ردود محفوظة)، يتم إنشاء 3 ردود افتراضية:

```json
[
  {
    "id": "default-welcome",
    "name": "ترحيب",
    "shortcut": "welcome",
    "body": "أهلاً وسهلاً بك! 👋 كيف يمكنني مساعدتك اليوم؟",
    "category": "greeting"
  },
  {
    "id": "default-thanks",
    "name": "شكر",
    "shortcut": "thanks",
    "body": "شكراً جزيلاً لتواصلك معنا! 🙏 هل هناك أي شيء آخر يمكنني مساعدتك به؟",
    "category": "thanks"
  },
  {
    "id": "default-reminder",
    "name": "تذكير",
    "shortcut": "reminder",
    "body": "نتذكر أنك أبديت اهتمامك بخدماتنا. هل لديك أي استفسارات؟",
    "category": "reminder"
  }
]
```
