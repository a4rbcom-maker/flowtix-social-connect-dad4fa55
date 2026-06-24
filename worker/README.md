# Flowtix Facebook Worker

> هذا البرنامج هو **القلب التنفيذي** للبوت. السيرفر السحابي يُنشئ المهام
> فقط؛ هذا الـ Worker هو الذي يفتح المتصفح فعلياً ويُنفّذها على فيسبوك.

## لماذا أحتاجه؟

فيسبوك يحجب طلبات النشر/الاستخراج القادمة من مراكز البيانات
(Cloudflare/AWS/…). علشان كده الحل الوحيد المضمون هو تشغيل متصفح حقيقي
على IP منزلي:

- **جهازك الشخصي** (مجاناً) — مناسب للتجربة وللاستخدام الخفيف.
- **VPS منزلي / Residential VPS** (5–15$/شهر) — للتشغيل 24/7.

## التشغيل في 5 دقائق

### 1) متطلبات

- Node.js 18 أو أحدث: https://nodejs.org

### 2) تثبيت

```bash
cd worker
npm install
npx playwright install chromium
```

### 3) إعداد متغيرات البيئة

انسخ `.env.example` إلى `.env` وعدّل القيم:

```bash
cp .env.example .env
```

- `BASE_URL` = رابط مشروعك على Lovable (افتراضي مضبوط مسبقاً).
- `BOT_WORKER_SECRET` = نفس قيمة الـ secret المخزّنة في
  Lovable Cloud → Settings → Secrets باسم `BOT_WORKER_SECRET`.
  إذا لم تكن تعرفها، افتح المشروع واسأل المساعد:
  «اعمل rotate لـ BOT_WORKER_SECRET وعطني القيمة الجديدة».

### 4) شغّل

```bash
npm start
```

ستظهر رسالة:

```
[worker] up · base=… · headless=true · poll=5000ms
```

ومن تلك اللحظة ستبدأ المهام المعلّقة في التنفيذ تلقائياً.

## كيف يعمل

1. كل 5 ثوانٍ يستدعي `/api/public/bot/next-job` ليأخذ أقدم مهمة معلّقة.
2. يفتح Chromium بكوكيز الحساب المرتبطة بالمهمة.
3. يتحقق من صلاحية الجلسة → يحدّث حالة الحساب (`active` / `invalid` /
   `checkpoint`).
4. ينفّذ المهمة (نشر في الجروبات، استخراج الجروبات، …) ويرسل التحديثات
   عبر `/api/public/bot/job-update`.

## مشاكل شائعة

| المشكلة | الحل |
|---|---|
| `401 Unauthorized` عند بدء التشغيل | قيمة `BOT_WORKER_SECRET` لا تطابق المخزّنة في Lovable Cloud. |
| الحساب يصبح `checkpoint` فوراً | فيسبوك يطلب تحقق إضافي — سجّل دخول يدوياً، أكمل التحقق، ثم أعد تصدير الكوكيز من إضافة Cookie Editor. |
| `Account invalid` | الكوكيز منتهية — صدّرها من جديد من المتصفح. |
| المهام لا تظهر | تأكد من إنشاء المهمة من واجهة Flowtix أولاً، وأن `BASE_URL` صحيح. |

## التشغيل الدائم (24/7)

### على ويندوز
استخدم [PM2](https://pm2.keymetrics.io/) أو NSSM لتسجيل العملية كخدمة.

```bash
npm i -g pm2
pm2 start index.mjs --name flowtix-worker
pm2 startup
pm2 save
```

### على Linux/VPS

```bash
pm2 start index.mjs --name flowtix-worker
pm2 startup
pm2 save
```

> **هام:** لو شغّلت Worker على VPS عادي بـ IP مركز بيانات، فيسبوك
> سيرفض الطلبات. اختر مزوّداً يقدّم Residential IP أو شغّله من بيتك.
