# خطة التنفيذ: دقة بيانات جهات ماسنجر

**Branch**: `002-messenger-data-accuracy` | **Date**: 2026-07-29 | **Spec**: [spec.md](./spec.md)

---

## ملخص

إصلاح جذري لدقة استخراج جهات اتصال الماسنجر. المشكلة أن `walkJSON` تستخرج أي كائن فيه `id` + `name` من **جميع** GraphQL responses — بما في ذلك timeline, profile switching, suggested pages. الحل: **تحديد أي GraphQL response هو Messenger response قبل الاستخراج**، واستبعاد الباقي تماماً. + إضافة فلترة قوية للـ `__typename` وأسماء auto-generated.

---

## السياق التقني

**Language/Version**: TypeScript 5.6.3  
**Primary Dependencies**: Playwright 1.48, Express 4.21, Supabase JS 2.45  
**Storage**: Supabase PostgreSQL — `extraction_results` (النتائج)  
**Testing**: لا يوجد test framework — اختبار يدوي عبر quickstart  
**Target Platform**: Node.js 22 على Windows، headless Chromium  
**Project Type**: Web service (Express API) + React frontend  
**Performance Goals**: تصفية 100+ GraphQL response في أقل من 5 ثوانٍ  
**Constraints**: لا تكسر أي ميزة موجودة، لا تؤثر على استخراج WhatsApp  
**Scale/Scope**: صفحات فيسبوك تحتوي على 50 إلى 50,000 محادثة

---

## فحص الدستور

*GATE: يجب أن يمر قبل Phase 0. يُعاد الفحص بعد Phase 1.*

| المبدأ | الحالة | ملاحظة |
|--------|--------|--------|
| عدم كسر الميزات الحالية | ✅ PASS | التغيير في `handleResponse` فقط |
| دقة البيانات | ✅ PASS | الهدف الأساسي |
| سجل واضح للأخطاء | ✅ PASS | FR-6 يوجب تسجيل كل response |
| البساطة | ✅ PASS | الفلتر بسيط: messenger vs non-messenger |

**النتيجة**: ALL PASS — المتابعة.

---

## هيكل المشروع

### التوثيق (لهذه الميزة)

```text
specs/002-messenger-data-accuracy/
├── plan.md              # هذا الملف
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1
└── tasks.md             # Phase 2
```

### الكود المصدري

```text
extraction-service/
└── src/
    └── extractors/
        └── messenger-contacts.ts    # الملف المستهدف (~800 سطر)
            ├── handleResponse()     # التعديل الرئيسي — فلترة الـ responses
            ├── walkJSON()           # فلترة إضافية للـ __typename
            └── deepParse()          # لا تغيير
```

**هيكل القرار**: Single file change في `messenger-contacts.ts`. لا حاجة لتغيير أي ملف آخر.

---

## تتبع التعقيد

> لا توجد مخالفات — جميع الـ gates pass.