## السبب الجذري (مؤكد بالشبكة)

- الطلب `GET https://flowtixtools.com/dashboard/facebook/bot` يرجع **502 من Cloudflare** والـ Origin هو الـ VPS (`cf-ray: 9fdb84f10871cb73-PDX`, `cfOrigin;dur=546ms`, `cf-host-status: Error`).
- `/` و `/api/public/health` يردّان 200 → المشكلة **مقصورة على SSR لهذا المسار** على الـ VPS، أي أن رندرة الصفحة على الخادم ترمي استثناء قبل ما يلتقطه `RootErrorComponent` فيرد الخادم 5xx ثم Cloudflare يحوّله 502.
- النسخة المنشورة فعليًا على الإنتاج هي `29f09cf` (لأن آخر 4 deploys للـ VPS فشلت — منفصل عن هذا الإصلاح).
- مسار `/dashboard/*` لا يحتاج SSR إطلاقًا: محتواه خاص بالمستخدم، غير قابل للأرشفة، ولا يحتاج SEO أو OG. تشغيله SSR يفتح بابًا للأخطاء (auth provider يقرأ session، استدعاء `useAuth` قبل hydrate، أي import يتفجّر في بيئة Node بدون env) — وأي خطأ منها = 502.

## الإصلاح (تعديل بسيط ومستهدف)

### 1) تعطيل SSR لكل راوتس لوحة التحكم
لكل ملف تحت `src/routes/dashboard*.tsx` نضيف `ssr: false` داخل `createFileRoute({...})`. هذا يجعل الخادم يرسل غلاف HTML فقط ويتم الرندر بالكامل على العميل، فيستحيل أن يفشل SSR على هذه المسارات.

الملفات المعنية (12 ملف):
```
dashboard.tsx, dashboard.activity.tsx, dashboard.bulk.tsx, dashboard.control.tsx,
dashboard.facebook.tsx, dashboard.facebook.bot.tsx, dashboard.facebook.groups.tsx,
dashboard.facebook.history.tsx, dashboard.facebook.jobs.tsx, dashboard.facebook.status.tsx,
dashboard.profile.tsx, dashboard.whatsapp.tsx
```

### 2) errorComponent محلي لراوت البوت
بدلًا من ترك أي استثناء يصعد للجذر، نضيف `errorComponent` خاص بـ `dashboard.facebook.bot.tsx` يعرض بطاقة خطأ عربية وزر "إعادة المحاولة" يستدعي `router.invalidate()` + `reset()`. هذا يضمن أن أسوأ حالة على العميل = UI ودود، لا شاشة بيضاء.

### 3) تنظيف `beforeLoad`
الحالي يستورد `supabase` ديناميكيًا ويستدعي `getSession()` بلا فائدة. مع `ssr: false` يصبح غير ضروري — نحذفه (`AuthProvider` في الجذر يتولى السيشن).

## ما لن أغيره

- **لن أمس** أي ملف server-fn، أو الـ middleware، أو ملفات SSR/Worker/`server.ts`.
- **لن أعدل** الـ pipeline أو إعدادات VPS — هذا مسار منفصل (الـ 4 deploys الفاشلة موضوع آخر).
- **لن أمس** صفحات عامة (`/`, `/login`, ...) — تبقى SSR لمصلحة SEO/OG.

## ملاحظة مهمة عن النشر

التعديل سيبقى في إصدار Lovable فورًا (preview + lovable.app)، لكنه **لن يظهر على `www.flowtixtools.com` إلا بعد نجاح Deploy to VPS**. آخر 4 محاولات فشلت. لو رضيت، بعد ما أنفّذ هذا التعديل وأتأكد أنه يحلّ المشكلة على Lovable، نفتح موضوع منفصل لإصلاح الـ pipeline (يحتاج logs الـ GitHub Actions).

## التحقق بعد التنفيذ

1. `curl -i https://flowtix-social-connect.lovable.app/dashboard/facebook/bot` → 200 + HTML غلاف.
2. فتح الرابط في المتصفح → الصفحة تشتغل بدون "Something went wrong".
3. لما الـ pipeline يعدّي: نفس الاختبارين على `www.flowtixtools.com`.
