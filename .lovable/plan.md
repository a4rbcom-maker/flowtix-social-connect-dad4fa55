# خطة: استخراج أعضاء الجروبات وأعضاء/متابعي الصفحات

## الوضع الحالي (تحليل)
البوت يدعم حالياً 3 مهام فقط:
- `post_to_groups` — نشر تلقائي
- `extract_pages` — جلب صفحاتي
- `extract_commenters` — معلقي بوست

**سحب أعضاء الجروبات / أعضاء الصفحات غير موجود**. لازم نضيف نوعين جديدين من المهام مع منطق scraping مختلف لكل واحد.

## القيود الواقعية (مهم تعرفيها)
- **الجروبات**: فيسبوك بيخفي قائمة الأعضاء الكاملة. الـ scraper بيقدر يجيب اللي ظاهرين فعلاً في `/groups/{id}/members` (عادة 1000–5000 من الأكتر تفاعلاً، مش كل الأعضاء).
- **الصفحات**: مفيش "قائمة أعضاء". اللي ينفع سحبه هو **المتابعين الظاهرين علناً** + **اللي عملوا Like للصفحة** (من تبويب People) + **اللي تفاعلوا مع آخر البوستات**.
- لازم خمول/ديلاي طويل بين الـ scrolls لتفادي الحظر.

## المعمارية المقترحة

### 1) نوعان جديدان من المهام (`fb_jobs.job_type`)
```
extract_group_members   →  payload: { groupId, maxMembers, filterKeywords? }
extract_page_audience   →  payload: { pageId, sources: ["followers"|"likers"|"engagers"], maxItems }
```

### 2) Worker Actions (bot-worker/actions/)
```
extract-group-members.js   ← يفتح /groups/{id}/members، scroll + parse
extract-page-audience.js   ← يفتح People tab + يستخرج reactors من البوستات
```

كل action يبعث Results عبر `report({ result: { target, data } })` (نفس النمط الحالي).

### 3) شكل الـ Result (موحّد للاثنين)
```ts
{
  fb_user_id: string,
  name: string,
  profile_url: string,
  avatar_url?: string,
  bio_snippet?: string,        // أول سطر من البايو لو ظاهر
  source: "group" | "page_followers" | "page_likers" | "page_engagers",
  source_id: string             // group/page id
}
```

### 4) الإثراء التلقائي (إعادة استخدام موجود)
بعد ما النتائج تترفع في `fb_job_results`، تشغّل `enrichLines()` من `src/lib/egypt-enrich.ts` على `name + bio_snippet` لاستخراج:
- موبايل مصري (لو حد كاتبه في الاسم/البايو)
- المحافظة والمدينة

### 5) واجهة المستخدم
في `src/routes/dashboard.facebook.jobs.tsx` أضيف تابين جداد للـ Tabs:
- **سحب أعضاء جروب** — input: Group ID/URL + max + كلمات فلترة اختيارية
- **سحب جمهور صفحة** — Page picker (من اللي اتسحبوا قبل كده) + Checkboxes للمصادر + max

في `dashboard.facebook.history.tsx` (موجود فعلاً نمط جاهز):
- عرض النتائج بأعمدة: الاسم، رابط البروفايل، الموبايل، المحافظة، المدينة، المصدر
- زر CSV (مع BOM للعربي — موجود بالفعل)

### 6) Storage & Dedup
- Index فريد على `(user_id, fb_user_id, source_id)` في `fb_job_results` (لو مش موجود) لتفادي التكرار عند تكرار السحب.
- زر "دمج كل نتائج هذا المصدر في ملف واحد" في History.

### 7) تدابير الأمان من الحظر
- ديلاي عشوائي 2–5 ثوان بين الـ scrolls
- توقف نهائي بعد `maxMembers` أو لما يلاقي 3 scrolls بدون عناصر جديدة
- حد أقصى صارم: 5000/مهمة للجروب، 3000/مهمة للصفحة
- مهمة واحدة فعّالة لكل حساب في نفس الوقت

## ملفات هتتعدّل/تتعمل
**جديد:**
- `bot-worker/actions/extract-group-members.js`
- `bot-worker/actions/extract-page-audience.js`

**تعديل:**
- `bot-worker/index.js` — route للنوعين الجداد
- `src/lib/fb-bot.functions.ts` — `createExtractGroupMembersJob`, `createExtractPageAudienceJob`
- `src/routes/dashboard.facebook.jobs.tsx` — تابين جداد في الـ Tabs
- `src/routes/dashboard.facebook.history.tsx` — أعمدة نتائج للنوع الجديد + إثراء تلقائي
- `src/routes/api/public/bot/next-job.ts` — يمرر النوعين الجداد للـ payload (لو محتاج تعديل)
- Migration: index فريد على `fb_job_results` (اختياري لكن مُستحسن)

## سؤال قبل التنفيذ
عايزة أبدأ بأي طريقة؟
- **(أ)** الاتنين مع بعض (جروبات + صفحات) — أطول لكن متكامل
- **(ب)** أبدأ بسحب أعضاء الجروبات الأول (الأكثر طلباً)، وبعدين الصفحات
- **(ج)** أبدأ بسحب جمهور الصفحات الأول
