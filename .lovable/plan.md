
# ميزة: حملات النشر الجماعي على فيسبوك (Facebook Bulk Campaigns)

## فهم الفكرة من صورة المنافس

المستخدم ينشئ "حملة" تتكون من:
1. **اسم الحملة** (للأرشفة والمتابعة)
2. **اختيار القناة** (حساب فيسبوك من حساباته المربوطة بالبوت)
3. **اختيار المجموعة/الوجهات** (جروبات أو صفحات — متعدد الاختيار)
4. **نوع المحتوى**: نص فقط / وسائط (صور أو فيديو) + نص اختياري
5. **القالب النصي** (Saved Text — مكتبة قوالب قابلة لإعادة الاستخدام مثل "لوفا")
6. **الوسائط** (من مكتبة الوسائط المرفوعة مسبقاً)
7. **الفاصل الزمني العشوائي**: حد أدنى (60 ث) وحد أقصى (120 ث) — لتجنّب حظر الحساب
8. **حفظ الحملة** → تشغيل البوت في الخلفية وتسجيل نتائج كل عملية نشر

العنصر الجوهري: **فاصل زمني عشوائي بين كل نشر والذي يليه** + متابعة لايف لحالة كل وجهة.

---

## الحالة الحالية للمشروع

البنية التحتية موجودة بالفعل:
- `fb_jobs` + `fb_job_results` (جداول المهام والنتائج)
- `fb_bot_accounts` (حسابات الفيسبوك المربوطة)
- `dashboard.facebook.groups.tsx` (إدارة الجروبات)
- `bot-worker/` (الـ worker اللي بينفّذ الـ jobs)

الناقص: طبقة الحملات (Campaigns) + مكتبة القوالب + مكتبة الوسائط + واجهة الإنشاء + ربطها بالـ worker.

---

## التغييرات المقترحة

### 1) قاعدة البيانات (Migration)

ثلاثة جداول جديدة + توسعة `fb_jobs`:

- **`fb_text_templates`**: مكتبة قوالب نصية قابلة لإعادة الاستخدام
  - حقول: `user_id`, `name` (مثل "لوفا"), `content`, `tags[]`
- **`fb_media_assets`**: مكتبة وسائط (صور/فيديو) مرفوعة على Lovable Cloud Storage
  - حقول: `user_id`, `kind` ('image'|'video'), `url`, `name`, `size`
- **`fb_campaigns`**: تعريف الحملة (مستقل عن الـ job)
  - حقول: `user_id`, `account_id`, `name`, `content_type` ('text'|'media'), `template_id`, `media_ids[]`, `target_kind` ('groups'|'pages'), `target_ids[]`, `delay_min`, `delay_max`, `status` ('draft'|'running'|'paused'|'completed')
- **توسعة `fb_jobs`**: إضافة `campaign_id` (FK اختياري) لربط كل تشغيل بالحملة الأم
- **Bucket تخزين** `fb-media` (خاص بكل مستخدم — RLS على المسار `{user_id}/...`)
- **RLS**: كل المستخدم يرى/يعدّل بياناته فقط

### 2) Server Functions (`src/lib/fb-campaigns.functions.ts`)

كلها `createServerFn` مع `requireSupabaseAuth`:
- `listTemplates / saveTemplate / deleteTemplate`
- `listMediaAssets / deleteMediaAsset` (الرفع مباشرة من المتصفح للـ bucket)
- `listCampaigns / getCampaign / createCampaign / updateCampaign / deleteCampaign`
- `startCampaign(campaignId)` → ينشئ `fb_job` بنوع `bulk_post` ويُدخل وجهة لكل عنصر في `fb_job_results`
- `pauseCampaign / resumeCampaign`
- `getCampaignProgress(campaignId)` → ملخّص (نجح/فشل/قيد الانتظار)

### 3) الـ Worker (`bot-worker/actions/bulk-post.js`)

action جديد `bulk_post`:
- يقرأ الحملة + قائمة الوجهات
- يفتح المتصفح بحساب الفيسبوك (إعادة استخدام `login.js`)
- لكل وجهة: ينشر المنشور (نص أو نص+وسائط) → يسجّل النتيجة في `fb_job_results` → ينتظر `random(delay_min, delay_max)` ثانية قبل الوجهة التالية
- يحدّث `processed_items` و `progress` بعد كل خطوة (للايف مونيتورنج)
- يدعم Pause: لو حالة الحملة تغيّرت لـ `paused` يخرج بأمان

### 4) الواجهة (4 ملفات routes جديدة)

- **`dashboard.facebook.campaigns.tsx`** — قائمة كل الحملات + إنشاء جديد + بدء/إيقاف/حذف
- **`dashboard.facebook.campaigns.new.tsx`** — نموذج الإنشاء (مطابق لصورة المنافس بالضبط: اسم → قناة → وجهات → نوع → قالب/وسائط → فواصل → حفظ)
- **`dashboard.facebook.campaigns.$id.tsx`** — تفاصيل الحملة + شاشة لايف لكل وجهة (نجح/فشل/قيد التنفيذ) مع Realtime subscription على `fb_job_results`
- **`dashboard.facebook.templates.tsx`** — مكتبة القوالب النصية (CRUD)
- **`dashboard.facebook.media.tsx`** — مكتبة الوسائط (رفع/حذف)

### 5) التنقل

إضافة قسم "النشر الجماعي" داخل قائمة فيسبوك بالـ Sidebar مع 3 روابط فرعية:
- الحملات
- القوالب النصية
- مكتبة الوسائط

---

## التفاصيل التقنية

### تدفّق التشغيل
```text
المستخدم ينشئ حملة (draft)
   ↓
يضغط "بدء" → startCampaign
   ↓
يُنشأ fb_job (status=pending, job_type=bulk_post, campaign_id=...)
   ↓ (في كل وجهة)
يُدخَل صف فارغ في fb_job_results (status=pending, target=group_id)
   ↓
الـ Worker يلتقط الـ job (يدعم Pull الموجود حالياً)
   ↓
ينشر → يحدّث الصف (success/failed) → ينتظر عشوائي → التالي
   ↓
عند الانتهاء: campaign.status = completed
```

### الأمان والحدود
- التحقق من ملكية `account_id` و `template_id` و `media_ids` تنتمي للـ `user_id` في `createCampaign`
- Zod validation لكل الـ inputs (حدود طول للاسم، `delay_min >= 30`, `delay_max <= 3600`, `delay_max >= delay_min`, عدد الوجهات ≤ 50)
- RLS على كل الجداول الجديدة + Storage bucket
- لا تخزين لكلمات مرور أو tokens إضافية — نعتمد على `fb_bot_accounts` الموجود

### الـ Realtime
- تفعيل `supabase_realtime` على `fb_job_results` و `fb_jobs`
- شاشة التفاصيل تشترك في التحديثات لعرض تقدّم لايف بدون refresh

### i18n
- كل النصوص بالعربية والإنجليزية عبر `useI18n()` (نفس النمط الموجود)
- RTL كامل في كل الصفحات الجديدة

### تصميم UI
- يطابق هوية Flowtix (Botxtra palette البنفسجي) — مش نسخة من المنافس
- بطاقات نظيفة، animations خفيفة، شارات حالة ملوّنة (pending/running/done/failed)

---

## ما لن يُغيَّر

- ملفات Supabase المُولّدة (`client.ts`, `types.ts`, `.env`)
- البنية الحالية للمصادقة والـ Dashboard Layout
- صفحات الفيسبوك الأخرى (groups, bot, status) — هتبقى كما هي

---

## خطة التنفيذ بالترتيب

1. Migration للجداول الثلاثة + bucket + RLS + توسعة `fb_jobs`
2. Server functions (templates, media, campaigns)
3. صفحات القوالب والوسائط (الأبسط أولاً)
4. صفحة إنشاء الحملة (النموذج الرئيسي — مطابق لصورة المنافس)
5. صفحة قائمة الحملات + صفحة التفاصيل مع Realtime
6. تحديث الـ worker بإضافة `bulk-post.js`
7. تحديث Sidebar للتنقل
8. اختبار end-to-end من الإنشاء حتى ظهور النتائج لايف

هل أبدأ التنفيذ؟
