## فحص شامل لصفحة ربط فيسبوك — تشخيص وإصلاح ومعمارية احترافية

### ما تم فحصه

قرأت الملفات التالية بعمق:
- `src/routes/dashboard.facebook.tsx` (1630 سطر — ضخم وتراكمي)
- `src/server/facebook.functions.ts` (server functions + Graph API)
- `src/integrations/supabase/auth-middleware.ts` (مصادقة)
- `src/components/shared/ExternalLinkButton.tsx` (فتح الروابط الخارجية)
- توقيعات `@tanstack/react-start` للتحقق من `headers` في server fn calls

### التشخيص

البنية التقنية سليمة في الجذور (server functions، middleware، تمرير Bearer token مدعوم رسمياً)، لكن هناك عدة مشاكل عملية تجعل الصفحة تبدو "لا تعمل":

1. **هشاشة `callServerFn`**: نمط `fn({ data, headers } as never)` متناثر في 3 مواضع داخل الملف، ولا يلتقط الأخطاء بشكل موحّد. أي خطأ شبكي صامت = تجمد UI بدون رسالة.
2. **عدم وجود route loader مع beforeLoad**: الصفحة تعتمد على `useEffect` لجلب الجلسة بعد التحميل — هذا يسبب سباقاً (race) مع hydration الجلسة، والنتيجة أحياناً 401 صامت.
3. **الروابط الخارجية**: المنطق سليم (anchor → window.open → top.location)، لكن داخل iframe الـ preview، المتصفح يحجب popups صامتاً. لا توجد رسالة واضحة ودائمة للمستخدم بأن الحل هو "افتح في تبويب جديد عبر زر النسخ".
4. **ملف 1630 سطراً**: كل المنطق (i18n، sync log، debug log، scopes، token expiry، testing، connection، groups, pages, guide) مدمج في component واحد. صعب اختباره وصيانته.
5. **عدم وجود اختبار end-to-end**: لم يتم التحقق فعلياً عبر browser tool أن مسار "لصق توكن → اختبار → ربط → تحميل" يعمل.

### الحل: 3 محاور

#### المحور 1 — إصلاح فعلي وقابل للتحقق

- توحيد استدعاءات server fn في hook واحد `useFacebookApi()` يتعامل مع:
  - جلب الجلسة، تمرير Bearer header.
  - timeout (10s).
  - تصنيف الأخطاء (auth/network/permission) ورسائل عربية واضحة.
  - retry تلقائي مرة واحدة عند 401 بعد refresh الجلسة.
- إضافة `beforeLoad` في route لـ `/dashboard/facebook` يضمن hydration الجلسة قبل تشغيل الـ component (يحل مشكلة 401 على أول تحميل).
- تحسين `openExternalUrl`: عند الفشل في iframe، عرض dialog واضح بـ "انقر هنا للفتح" بدل toast فقط (anchor click من user gesture مباشر يتجاوز popup blocker بشكل أفضل).

#### المحور 2 — إعادة هيكلة معمارية

تقسيم `dashboard.facebook.tsx` إلى:

```text
src/routes/dashboard.facebook.tsx          (200 سطر — composition فقط)
src/features/facebook/
├── api.ts                                 (useFacebookApi hook موحّد)
├── i18n.ts                                (نصوص ar/en منفصلة)
├── constants.ts                           (REQUIRED_SCOPES, EXPIRY_WARN_DAYS)
├── useSyncLog.ts                          (هوك سجل المزامنة)
├── useTokenExpiry.ts                      (هوك مراقبة انتهاء التوكن)
└── components/
    ├── TokenExpiryBanner.tsx
    ├── QuickStartStrip.tsx
    ├── RequiredScopesCard.tsx
    ├── ConnectionGuide.tsx
    ├── TokenInputCard.tsx                 (إدخال + اختبار + ربط)
    ├── ConnectedCard.tsx                  (الحالة بعد الربط + قطع الاتصال)
    └── SyncHistoryPanel.tsx
```

ملاحظات:
- `src/server/facebook.functions.ts` يبقى كما هو (سليم).
- لا تغيير في schema قاعدة البيانات.
- نفس السلوك الوظيفي بالضبط، فقط إعادة تنظيم + إصلاحات.

#### المحور 3 — اختبار وتأكيد

بعد التطبيق، سأشغّل browser tool:
1. تسجيل دخول.
2. فتح `/dashboard/facebook`.
3. التقاط screenshot.
4. التحقق من ظهور: Quick Start، Required Scopes، Guide، حقل التوكن.
5. اختبار زر فتح Graph Explorer (يجب أن ينسخ + يفتح أو يعرض dialog واضح).
6. اختبار زر نسخ الـ scopes.
7. لصق توكن وهمي قصير → التحقق من ظهور رسالة "Token قصير جداً".
8. مراجعة console logs و network requests.
أي خطأ يظهر → إصلاحه ثم إعادة الاختبار.

### ما لن يتغير

- معمارية server functions و middleware (سليمة).
- منطق Graph API (`fbGet`, `ensurePermissions`, تصنيف الأخطاء).
- سياسات RLS وقاعدة البيانات.
- صفحة `dashboard.facebook.groups` (منفصلة).

### الخطوات بترتيب التنفيذ

1. إنشاء `src/features/facebook/` بكل الملفات.
2. تحديث `dashboard.facebook.tsx` ليكون composition + beforeLoad فقط.
3. تحسين `ExternalLinkButton` بـ fallback dialog واضح.
4. اختبار شامل عبر browser tool.
5. إصلاح أي مشاكل تظهر.
