
## الهدف
بناء نظام نشر تلقائي على جروبات فيسبوك واستخراج صفحات/أعضاء **بدون أي توثيق من فيسبوك**، عن طريق Browser Automation Bot يشتغل على VPS الخاص بك. النظام مصمم بحيث لما تيجي توثيق فيسبوك لاحقاً، نبدّل المصدر برمجياً (switch واحد) دون تغيير الواجهة.

---

## المهام المطلوبة (3 ميزات)

1. **النشر التلقائي على جروبات فيسبوك** بمحتوى متغير + جدولة + فواصل زمنية
2. **استخراج صفحات فيسبوك** اللي المستخدم بيديرها أو بيعملها follow
3. **استخراج أعضاء من تعليقات بوست معين** (الاسم + ID + رابط الحساب)

---

## المعمارية العامة

```text
┌────────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Lovable Frontend  │───▶│  Lovable Backend │───▶│  Bot Worker     │
│  (UI + Forms)      │    │  (API + DB +     │    │  (Puppeteer     │
│                    │◀───│   Job Queue)     │◀───│   على VPS)      │
└────────────────────┘    └──────────────────┘    └─────────────────┘
                                  │
                                  ▼
                          ┌──────────────────┐
                          │  Supabase DB     │
                          │  - fb_accounts   │
                          │  - fb_jobs       │
                          │  - fb_results    │
                          └──────────────────┘
```

**كيف يعمل:**
1. المستخدم يربط حسابه (Cookies أو ID/Pass) من الواجهة → نخزن مشفّر في DB
2. المستخدم يطلب مهمة (نشر/استخراج) → نخزنها في `fb_jobs` بحالة `pending`
3. الـ Bot Worker على VPS بيعمل polling كل 10 ثواني على Endpoint محمي → يجيب المهمة → ينفذها بـ Puppeteer → يبعت النتيجة
4. الواجهة تتحدث live (Supabase Realtime) لما تكون النتيجة جاهزة

---

## قاعدة البيانات (3 جداول جديدة)

### 1. `fb_bot_accounts` — حسابات فيسبوك المربوطة
```text
id (uuid, PK)
user_id (uuid, FK→auth.users, ON DELETE CASCADE)
display_name (text)            — اسم الحساب اللي المستخدم بيعرفه بيه
auth_method (enum: 'cookies' | 'credentials')
encrypted_payload (text)       — Cookies JSON أو {email,password,2fa} مشفر AES-256
status (enum: 'active' | 'invalid' | 'checkpoint' | 'disabled')
last_check_at (timestamptz)
last_error (text)
created_at, updated_at
```
**RLS:** المستخدم يقرأ/يكتب صفوفه فقط.

### 2. `fb_jobs` — قائمة المهام
```text
id (uuid, PK)
user_id (uuid, FK)
account_id (uuid, FK→fb_bot_accounts)
job_type (enum: 'post_to_groups' | 'extract_pages' | 'extract_commenters')
payload (jsonb)                — تفاصيل المهمة (المحتوى، الجروبات، رابط البوست…)
status (enum: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled')
progress (int 0-100)
total_items, processed_items (int)
scheduled_at (timestamptz)     — للجدولة
started_at, completed_at
error_message (text)
created_at, updated_at
```

### 3. `fb_job_results` — نتائج كل خطوة
```text
id (uuid, PK)
job_id (uuid, FK→fb_jobs ON DELETE CASCADE)
target (text)                  — اسم/ID الجروب أو البوست
status (enum: 'success' | 'failed' | 'skipped')
data (jsonb)                   — البيانات المستخرجة أو رابط البوست المنشور
error (text)
created_at
```
**RLS عبر join مع fb_jobs.user_id.**

تفعيل Realtime على `fb_jobs` و`fb_job_results`.

---

## الواجهات الجديدة (UI)

### 1. صفحة "حسابات فيسبوك" `/dashboard/facebook/accounts`
- زر **"ربط حساب جديد"** يفتح Modal فيه تابين:
  - **تاب Cookies (موصى به):** شرح + رابط تحميل إضافة Chrome (نوفرها لاحقاً) + textarea للصق JSON
  - **تاب Email/Password:** حقول email + password + 2FA secret (اختياري) — مع تنبيه أحمر بمخاطر الحظر
- جدول الحسابات المربوطة + حالة كل حساب + زر "اختبار" + "حذف"

### 2. صفحة "النشر على الجروبات" `/dashboard/facebook/post`
- اختيار الحساب
- **Textarea للمحتوى** + دعم متغيرات (`{{spin:نص1|نص2|نص3}}`) للمحتوى المتغير
- اختيار جروبات (نجيبهم من آخر استخراج أو يدخلهم يدوياً)
- إعدادات: فاصل زمني بين البوستات (دقايق) + جدولة (الآن أو وقت محدد)
- زر "ابدأ" → ينشئ Job ويحوّل لصفحة التقدم

### 3. صفحة "استخراج البيانات" `/dashboard/facebook/extract`
- تابين:
  - **استخراج صفحاتي**: زر واحد "ابدأ" → يجيب كل الصفحات اللي الحساب بيديرها
  - **استخراج معلقين على بوست**: حقل رابط البوست + زر "ابدأ"
- جدول النتائج + زر تصدير CSV

### 4. صفحة "المهام" `/dashboard/facebook/jobs`
- جدول كل المهام مع: النوع، الحالة، Progress bar، التاريخ
- ضغط على مهمة → تفاصيل + النتائج التفصيلية

### 5. تحديث Sidebar
إضافة عناصر فرعية تحت "Facebook":
- الحسابات (Accounts)
- النشر (Post)
- الاستخراج (Extract)
- المهام (Jobs)

كل العناصر بنفس design system الحالي (gradient violet, Cairo/Inter, RTL).

---

## Backend: Server Functions الجديدة

في `src/server/fb-bot.functions.ts`:
- `addBotAccount({ method, payload, displayName })` — يشفّر ويخزن
- `listBotAccounts()` — يرجع حسابات المستخدم (بدون البيانات المشفرة)
- `deleteBotAccount(id)`
- `testBotAccount(id)` — ينشئ job نوع `test_account`
- `createPostJob({ accountId, content, groupIds, intervalMinutes, scheduledAt })`
- `createExtractPagesJob({ accountId })`
- `createExtractCommentersJob({ accountId, postUrl })`
- `listJobs()`, `getJob(id)`, `cancelJob(id)`

**التشفير:** AES-256-GCM بمفتاح من `BOT_ENCRYPTION_KEY` (سنطلبه كـ secret).

---

## Bot Worker API (للـ VPS)

Server Routes تحت `/api/bot/*` محمية بـ `Authorization: Bearer <BOT_WORKER_SECRET>`:

- **`GET /api/bot/next-job`** — يرجع أقدم job بحالة `pending` ويغيّرها لـ `running` (مع account credentials المفكوكة من التشفير)
- **`POST /api/bot/job-progress`** — `{ jobId, progress, processedItems }`
- **`POST /api/bot/job-result`** — `{ jobId, target, status, data, error }` — يضيف صف في `fb_job_results`
- **`POST /api/bot/job-complete`** — `{ jobId, status, errorMessage? }`
- **`POST /api/bot/account-status`** — `{ accountId, status, error? }` — لتحديث حالة الحساب لو detected checkpoint

كل route يتحقق من signature ويستخدم `supabaseAdmin`.

---

## سكريبت VPS الجاهز (هنوفره لك)

ملف `bot-worker/` في الريبو يحتوي على:
- `package.json` — Puppeteer + puppeteer-extra-plugin-stealth + axios
- `index.js` — Polling loop + handlers لكل job_type
- `actions/login.js` — تسجيل دخول بـ cookies أو credentials + handle 2FA
- `actions/post-to-group.js` — فتح الجروب + كتابة المنشور + النشر
- `actions/extract-pages.js` — يفتح صفحة Pages ويسحب القائمة
- `actions/extract-commenters.js` — يفتح البوست + يـ scroll للتعليقات + يستخرج
- `README.md` — خطوات التثبيت على VPS بالظبط (ssh, install node, pm2 start)

تشغّله بأمر واحد على VPS، يربط نفسه بالموقع تلقائياً.

---

## الجاهزية للتحويل لـ Graph API لاحقاً

كل server function بتروح للـ Bot دلوقتي مكتوبة بـ pattern موحد:
```ts
const provider = await getActiveProvider(userId); // 'bot' | 'graph_api'
if (provider === 'graph_api') return graphApiHandler(...);
return botJobHandler(...);
```
لما تيجي توثيق فيسبوك، نضيف `graph_api` provider ونغيّر setting واحد لكل مستخدم — والواجهة لا تتغير.

---

## الأمان

- **التشفير:** كل cookies/passwords مشفرة AES-256-GCM، المفتاح في secrets
- **RLS صارمة** على كل الجداول
- **Worker secret** منفصل مش معروض للمستخدم
- **Rate limiting** داخلي في الـ Bot (delays عشوائية بين الإجراءات)
- **تنبيه واضح** للمستخدم: "استخدام تلقائي قد يؤدي لحظر الحساب من فيسبوك"
- **عدم تسجيل** كلمات المرور في logs أبداً

---

## الخطوات بالترتيب (تنفيذ في loop واحد)

1. Migration: إنشاء enums + 3 جداول + RLS + realtime + indexes
2. طلب secrets: `BOT_ENCRYPTION_KEY` + `BOT_WORKER_SECRET` (هنولّدهم لك)
3. helpers التشفير في `src/server/crypto.server.ts`
4. server functions في `src/server/fb-bot.functions.ts`
5. server routes في `src/routes/api/bot/*`
6. UI: صفحات Accounts / Post / Extract / Jobs + تحديث Sidebar
7. سكريبت VPS كامل في مجلد `bot-worker/` + README بالعربي
8. اختبار كل صفحة بصرياً + فحص الفلو

---

## خارج النطاق

- App Review من فيسبوك (مؤجل لحين توثيق حسابك)
- نشر تلقائي على الصفحات (Pages) — Graph API فقط بيدعمه بشكل موثوق
- Live streaming أو Stories
