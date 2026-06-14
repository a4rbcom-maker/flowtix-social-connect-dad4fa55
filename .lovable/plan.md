## ما يحدث الآن

- PM2 يعمل ويُحمِّل ملف SSR من `dist/server/*` بنجاح (وإلا لظهر `SSR entry missing`).
- كل الطلبات ترجع `500 text/plain`. هذا ليس رد `renderErrorPage()` لدينا (الذي يُرسل `text/html`)، إذن الخطأ يحدث **داخل** SSR handler وh3 يحوّله إلى نص عادي ثم wrapper الـ `src/server.ts` لا يحوّله إلى HTML لأن `content-type` ليس `application/json` — فحاليًا الرسالة الحقيقية مكتومة.
- معنى ذلك: السبب الجذري ليس Nginx ولا المنفذ ولا الـ build — بل استثناء داخل SSR يتم ابتلاعه.

## السبب الأرجح

`vite.config.ts` يستخدم Override لمدخل السيرفر إلى `src/server.ts`. هذا الـ wrapper مكتوب لبيئة Cloudflare Worker (يستورد `@tanstack/react-start/server-entry` لازم Vite plugin). عند البناء لهدف Node + التشغيل عبر `scripts/tanstack-node-server.mjs`، الـ import الديناميكي قد لا يُحلّ، فيرفض الـ promise مع كل طلب → 500 نظيف بلا تفاصيل.

`optimizeDeps.exclude: ["@tanstack/react-start", "zod"]` أيضًا يفسّر دائرة 504 في معاينة Vite (إعادة تحسين مستمرة تُسقط chunks).

## الخطوات

1) **اقرأ الخطأ الفعلي** على VPS (بدون أي تعديل بعد):
   ```bash
   pm2 logs flowtixtools-web --lines 80 --nostream
   ```
   والصق آخر stack trace.

2) **إصلاح إعداد Vite** (إزالة الـ overrides التي تضرّ Node target وحلقة الـ deps):
   - حذف `tanstackStart.server.entry` من `vite.config.ts` والاعتماد على المدخل الافتراضي.
   - حذف `optimizeDeps.exclude` (سبب 504 في المعاينة).
   - الإبقاء على `src/lib/error-capture.ts` و `src/lib/error-page.ts` و `src/server.ts` كملفات احتياطية فقط — لكن لا نوجّه TanStack إليها.

3) **تحديث `scripts/tanstack-node-server.mjs`** ليكشف الخطأ بدلًا من ابتلاعه:
   - عند `status >= 500`، طباعة `body` كاملًا في `console.error` قبل إرساله للعميل.

4) **إعادة البناء والتشغيل** على VPS:
   ```bash
   git pull && bun install && bun run build
   ls dist/server   # تأكد من وجود ملف الإدخال
   pm2 restart flowtixtools-web --update-env
   curl -i http://127.0.0.1:3100/api/public/health
   ```

5) **التحقق**:
   - `/api/public/health` → 200
   - `/api/public/bot/next-job` POST → 401 (بدون السر) أو 200 (مع السر)
   - الصفحة الرئيسية → 200 HTML

## أحتاج منك قبل التنفيذ

ألصق ناتج:
```bash
pm2 logs flowtixtools-web --lines 80 --nostream
```

هذا يحدد إن كان السبب فعلًا هو wrapper المدخل أم استثناء آخر (متغير بيئة ناقص، Supabase client، إلخ) فأطبّق الإصلاح الدقيق بدل التخمين.
