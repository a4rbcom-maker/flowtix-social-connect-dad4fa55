# خطة فحص وإصلاح ميزة "جهات ماسنجر" (Messenger Contacts)

> **لـ Hermes:** هذا ملف تشخيص + خطة إصلاح فقط. **لا تنفيذ.** بعد اعتماد Khaled، نفّذ المهام واحدة تلو الأخرى مع إثبات DB/DOM حقيقي حسب `flowtix-extraction-service` skill.

**الهدف:** فحص المسار الكامل لـ Messenger Contacts من اختيار الجلسة حتى حفظ النتائج، توثيق كل مشكلة بجذرها وحلّها وطريقة إثباتها.

**النطاق:** Messenger Contacts فقط. لا تُمَس مسارات Groups / Pages / Post / Instagram.

**تاريخ الفحص:** 2026-08-30

---

## 1) المسار الكامل كما هو مُنفَّذ فعلياً (Traced)

| المرحلة | الملف / السطر | ماذا يحدث |
|---|---|---|
| اختيار الجلسة | `src/pages/dashboard/extraction/ExtractContactsPage.tsx:273` | `FbSessionSelector` → `selectedSessionId` |
| جلب الصفحات | `ExtractContactsPage.tsx:76-100` → `POST /list-pages` | fetch إلى `extraction-service` |
| استخراج الصفحات | `extraction-service/src/routes/list-pages.ts:41-138` | يفتح `facebook.com/pages/?category=your_pages` ويكشط كل `<a href>` بـ heuristics |
| عرض الصفحات | `ExtractContactsPage.tsx:352-409` | Grid cards |
| اختيار صفحة → إعدادات | `ExtractContactsPage.tsx:126-130` | `selectedPage` |
| بدء الاستخراج | `ExtractContactsPage.tsx:132-156` → `POST /extract` | يمرّر `source_url = pageId` (بعد إزالة بادئة `id_`) |
| تشغيل المهمة | `routes/extract.ts:145-279` → `createExtractor("messenger_contacts", …)` | `MessengerContactsExtractor` |
| الاستخراج | `extractors/messenger-contacts.ts:44-360` | 4 استراتيجيات (interception + bootstrap/paginate + mbasic + scroll) |
| الحفظ | `base.ts:660-701` `processBatch` → `supabase.storeResults` | إلى `extraction_results` |

---

## 2) المشاكل المكتشفة (مرتبة بالخطورة)

### 🔴 مشكلة #1 (حرجة — تنتهك عزل المستأجر ودقة النتائج): `mailboxId` و `pageIdNum` قيم ثابتة hardcoded

**الوصف:** المحرك الأساسي `bootstrapAndPaginate` — الذي يجلب معظم النتائج عبر GraphQL pagination — لا يشتق mailbox من الصفحة المختارة إطلاقاً.

**مكان الحدوث:** `extractors/messenger-contacts.ts:579-580` و `:601`
```ts
const mailboxId = "551321368296102";          // ثابت
const pageIdNum = pageId || "100092451731675"; // fallback ثابت
const bizUrl = `https://business.facebook.com/latest/inbox/all?asset_id=${mailboxId}&mailbox_id=${mailboxId}`;
```
كل استدعاءات GraphQL في هذا المحرك تستخدم `mailbox_id = 551321368296102` مهما كانت الصفحة المختارة، ويُبحَر إلى inbox حساب/صفحة ثابتة، ثم تُدمج جهات اتصال هذا الـ mailbox في نفس `contacts` Map مع نتائج مرحلة الـ interception الخاصة بالصفحة الصحيحة.

**Root Cause:** قيمة تطوير/اختبار تُركت hardcoded؛ لا يوجد أي منطق لاكتشاف `mailbox_id`/`asset_id` الحقيقي للصفحة المختارة. (regex الوحيد لـ `asset_id` في `:169` مستخدَم لاستخراج `pageId` فقط، ولا يُعيد mailbox.)

**الأثر:**
- النتائج **لا تخص الصفحة المختارة** بالضرورة — تختلط بجهات mailbox أجنبي ثابت.
- تسريب بيانات بين حسابات (Zero Trust / Tenant isolation violation — أولوية #1 في AGENTS.md).
- إن كانت الصفحة المختارة ليست صاحبة الـ mailbox الثابت، تُحفظ جهات لا علاقة لها بها.

**الحل المقترح:**
1. اشتقاق `mailbox_id`/`asset_id` الحقيقي بعد الوصول إلى inbox الصفحة المختارة، من:
   - URL النهائي لصفحة `business.facebook.com/latest/inbox/all?...asset_id=<X>&mailbox_id=<Y>` (اقرأ `this.page.url()` بعد الملاحة بدل تثبيت قيمة)، أو
   - HTML/`__isMailbox`/`viewer_mailbox_id`/`page_id` من payload أول GraphQL response للـ inbox، أو
   - اشتقاقه من `pageId` المُستخرَج فعلاً في `extract()` (`:190`).
2. إذا تعذّر اكتشاف mailbox → **أوقف المحرك الأساسي بأمان** (`stop_reason` = `source_exhausted`) واعتمد على مرحلة الـ interception الخاصة بالصفحة فقط — **لا** تستخدم أي قيمة ثابتة إطلاقاً.
3. مرّر `pageId` الحقيقي (من `extract()`) إلى `bootstrapAndPaginate` كـ required، واحذف الـ fallback الثابت `100092451731675`.

**أفضل Architecture:** إضافة دالة `private async resolveMailboxId(pageId: string): Promise<string | null>` تُرجع mailbox حقيقي أو `null`؛ و`bootstrapAndPaginate` يعود فوراً عند `null`. تمرير `pageId` عبر توقيع الدالة كـ non-optional. لا قيم سحرية.

**طريقة الاختبار:**
- شغّل job على صفحة A المتصلة بجلسة معروفة، وjob آخر على صفحة B مختلفة لنفس الحساب.
- تأكد أن لا mailbox_id ثابت في اللوج (grep على `551321368296102` في service-run-out.txt → يجب أن يختفي).

**طريقة الإثبات:**
```sql
-- كل نتيجة يجب أن ترتبط بالصفحة المختارة فعلاً
select fb_id, data->>'name' from extraction_results where job_id='<JOB_A>' limit 20;
```
- قارن عدد/عيّنة نتائج A مقابل B: يجب أن تختلفا وتطابقا محتوى inbox كل صفحة يدوياً.
- تحقق من اللوج أن `mailbox_id` المستخدَم يساوي mailbox الصفحة A (وليس القيمة الثابتة).

---

### 🔴 مشكلة #2 (عالية — منطق معطّل صامت): `skip_duplicates` بلا مفعول عبر الـ jobs للـ Facebook

**الوصف:** خانة "إزالة التكرار" في الواجهة (`ExtractContactsPage.tsx:441`) تُمرَّر إلى الخدمة لكن الفلترة العابرة للـ jobs لا تعمل.

**مكان الحدوث:** `base.ts:671` → `supabase.getExistingIds(this.ctx.workspaceId, …)` ثم `supabase.ts:423-432`:
```ts
.eq("workspace_id", workspaceId)  // workspaceId = NULL (العمود ميت)
```

**Root Cause:** عمود `workspace_id` مُسقَط فعلياً (migration 2026072716، كل القيم NULL — موثّق في skill). المسار FB لا يزال يفلتر عليه، فيُرجع set فارغ دائماً → لا dedup عابر للـ jobs. (الـ `seen` Set يمنع التكرار **داخل** الـ job فقط.)

**الأثر:** إعادة تشغيل نفس الصفحة تُنتج نسخاً مكررة في `extraction_results` عبر jobs مختلفة رغم تفعيل الخانة.

**الحل المقترح:** نفس نمط IG المُثبَّت (`getExistingIgIds`): فلترة على `user_id` + `platform='facebook'` بدل `workspace_id`، مع chunking للـ `.in()`. أضف دالة `getExistingFbIds(userId, fbIds)` أو عمّم `getExistingIds` لتقبل `userId`/`platform`.
**قرار مطلوب من Khaled:** dedup على مستوى الـ user عبر كل التاريخ (مثل IG الحالي) أم dedup لكل job فقط؟ (اختيار تصميمي له أثر على التصدير — لا تُغيّر السلوك بصمت.)

**طريقة الاختبار:** شغّل نفس الصفحة مرتين بفارق دقائق مع `skip_duplicates=true`.
**طريقة الإثبات:**
```sql
select fb_id, count(*) from extraction_results
where user_id='<UID>' and platform='facebook' and fb_type='messenger_contact'
group by fb_id having count(*)>1;   -- يجب أن يكون فارغاً بعد الإصلاح
```

---

### 🟠 مشكلة #3 (متوسطة — هشاشة جلب الصفحات): `/list-pages` كشط DOM heuristic بلا Graph API

**الوصف:** يكشط كل `<a href>` من `facebook.com/pages/?category=your_pages` ويستبعد بقائمة SKIP ثابتة، ويستنتج الاسم من أول سطر نصي، والمتابعين بـ regex.

**مكان الحدوث:** `routes/list-pages.ts:54-138`.

**Root Cause:** لا توجد واجهة رسمية مستخدَمة؛ الاعتماد على بنية DOM متغيّرة + قائمة كلمات SKIP لغوية.

**الأثر المحتمل:**
- صفحات مُدارة قد تُفوَّت (روابط بأشكال غير متوقَّعة) أو تُدرَج كيانات ليست صفحات (روابط أشخاص/تنقّل).
- `name` قد يكون خاطئاً (يقع على `username` عند فشل الاستدلال — `:119`)، `category` دائماً فارغ، `followers` غير موثوق.
- تعتمد الدقة على اللغة (عربي/إنجليزي فقط في الكلمات المستبعَدة).

**الحل المقترح:**
1. Probe حيّ (tsx standalone) لبنية `pages/?category=your_pages` الحالية قبل أي تعديل (نمط `debug-ig-dialog.ts`).
2. الأفضل: التقاط GraphQL response الخاص بقائمة الصفحات المُدارة (interception كما في messenger) لاستخراج `{id, name, followers, category}` من payload منظَّم بدل كشط DOM.
3. كحد أدنى: تضييق الكشط على حاوية بطاقات الصفحات فقط + التحقق أن الرابط صفحة فعلاً (وجود `page_id`/بنية بطاقة) قبل الإدراج.

**طريقة الاختبار/الإثبات:** قارن ناتج `/list-pages` مع قائمة الصفحات الظاهرة يدوياً في حساب اختبار (تطابق العدد والأسماء 1:1).

---

### 🟠 مشكلة #4 (متوسطة — قد يقصّ inbox كبير): `maxExecutionMs` ثابت 9 دقائق

**مكان الحدوث:** `messenger-contacts.ts:39` `protected maxExecutionMs = 540_000;` بينما `config.jobTimeoutMs = 2700000` (45 دقيقة) و`base.ts:462` يشتق budget من jobTimeout.

**Root Cause:** المستخرِج يتجاوز budget القاعدة بقيمة ثابتة أقل بكثير.

**الأثر:** inbox كبير يتوقف عند 9 دقائق بـ `stop_reason` بينما الميزانية المتاحة 45 دقيقة → تغطية ناقصة تبدو كأنها "اكتملت".

**الحل المقترح:** اشتقاق `maxExecutionMs` من `config.jobTimeoutMs` (مثل القاعدة) أو رفعه بوعي، مع الحفاظ على هامش الـ enrichment. راجع مع Khaled الحد المطلوب.

**الإثبات:** job على صفحة بـ inbox كبير: قارن `progress.discovered` مع العدد التقريبي في Business Suite؛ راقب `stop_reason` و`runtimeSec` في اللوج.

---

### 🟡 مشكلة #5 (منخفضة — خطر انكسار صامت مستقبلي): `doc_id` ثابت للـ GraphQL

**مكان الحدوث:** `messenger-contacts.ts:615` `workingDocId = "27615938851434506";`

**Root Cause:** doc_id مثبَّت؛ فيسبوك يغيّرها بصمت.

**الأثر:** عند تغيير FB للـ doc_id ينكسر المحرك الأساسي بصمت ويسقط للـ mbasic (المرجّح أنه معطّل — مشكلة #6).

**الحل المقترح:** التقاط الـ doc_id الحيّ من أول thread-list request مُلتقَط عبر الـ interception (المتغير `graphqlReqs` يجمعها بالفعل في `:78-80` لكنها لا تُستخدَم لاشتقاق doc_id) بدل التثبيت، مع الثابت كـ fallback أخير.

**الإثبات:** تأكد من اللوج أن doc_id المستخدَم مأخوذ من request حيّ؛ اختبر بعد أي فشل مفاجئ في `[bootstrap] no working pattern`.

---

### 🟡 مشكلة #6 (منخفضة — مسار احتياطي ميّت غالباً): `mbasic.facebook.com`

**مكان الحدوث:** `messenger-contacts.ts:717-814` `tryMbasic`.

**Root Cause:** `mbasic.facebook.com` أوقفته Meta فعلياً ويعيد توجيهاً عادةً.

**الأثر:** المرحلة تستهلك وقتاً بلا فائدة. ليست عطلاً حرجاً لكنها dead-ish path.

**الحل المقترح:** إما التحقق الحيّ أن mbasic لا يزال يُرجع قائمة محادثات (probe)، أو تقليم المرحلة إذا ثبت أنها ميتة. **قرار Khaled** قبل الحذف.

**الإثبات:** probe حيّ لـ mbasic URLs الثلاثة → عدّ `/messages/t/\d+`.

---

## 3) ما يعمل بشكل صحيح (لا تغيير)

- **اختيار الجلسة والتمرير:** `session_id` يُمرَّر سليماً عبر `/list-pages` و`/extract`؛ التحميل من `getSessionAndCookies` مع storageState سليم.
- **مرحلة الـ interception الخاصة بالصفحة (`:67-147`):** تلتقط GraphQL responses أثناء الملاحة إلى inbox الصفحة المختارة وتفلتر timeline/profile بشكل صحيح — هذه المرحلة **page-specific** وصحيحة.
- **فلترة الكيانات غير-المستخدِمين (`walkJSON` :415-490):** `__typename`/`__isMessagingActor`/auto-gen/self-ref — منطق تصفية جيّد ومغطّى بسيناريوهات `specs/002`.
- **الحفظ التدريجي:** `flushContacts` عبر `processBatch` مع `seen` Set (dedup داخل الـ job) + إعادة محاولة 3× + تسجيل `lost_batches`.
- **إيقاف/إلغاء:** `checkCanceled()` مُستدعى في كل حلقة؛ `shouldStop` عبر budget؛ watchdog على مستوى المهمة (`extract.ts:293-301`).
- **Progress/Phases:** `storeExtractionProgress` مع debounce 10s وphase transitions سليمة، والواجهة تعالج running/completed/failed/paused/canceled.

---

## 4) خطة التنفيذ المقترحة (بعد "اعتمد" فقط)

> TDD حيثما أمكن، لكن الأولوية للإثبات الحيّ (DB/DOM/API) حسب طبيعة الاستخراج.

**المهمة 1 — إصلاح #1 (mailbox الثابت):** probe حيّ لاشتقاق mailbox من inbox الصفحة → `resolveMailboxId(pageId)` → حذف الثوابت → return آمن عند `null`. إثبات: jobان لصفحتين مختلفتين، لا `551321368296102` في اللوج.

**المهمة 2 — إصلاح #2 (dedup):** `getExistingFbIds(userId, fbIds)` بنمط IG + توصيل في `processBatch`. إثبات: SQL count>1 فارغ.

**المهمة 3 — إصلاح #4 (budget):** اشتقاق `maxExecutionMs` من config. إثبات: تغطية أعلى على inbox كبير.

**المهمة 4 — إصلاح #5 (doc_id ديناميكي):** استخدام `graphqlReqs` الملتقَطة. إثبات: doc_id من request حيّ في اللوج.

**المهمة 5 — إصلاح #3 (list-pages):** probe → interception أو تضييق الكشط. إثبات: تطابق 1:1 مع القائمة اليدوية.

**المهمة 6 — قرار #6 (mbasic):** probe → إبقاء/تقليم حسب قرار Khaled.

**التحقق النهائي لكل تعديل:**
```bash
cd extraction-service && npm run build   # tsc يشمل *.test.ts
cd .. && npm run typecheck && npm run lint
```
ثم job حقيقي عبر `POST /extract` (session متصلة) → مراقبة `scripts/monitor-job.mjs` → إثبات بالأرقام (unique, coverage, duplicates, stop_reason, runtime) → تنظيف jobs الاختبار من DB.

---

## 5) جدول الإثبات المطلوب لكل مرحلة (كما طلب Khaled)

| المرحلة | كيف نثبتها |
|---|---|
| Session | اللوج `session loaded: <name> (status: connected)` + رفض `guest` عند submit |
| Pages | `POST /list-pages` count == القائمة اليدوية؛ الأسماء صحيحة |
| Selected Page | `source_url` في `extraction_jobs.config` == pageId المختار |
| Available Messenger Contacts | عدّ يدوي تقريبي من Business Suite inbox للصفحة |
| Extracted Contacts | `select count(*) from extraction_results where job_id=…` |
| نسبة التغطية | extracted / available؛ للصفحات الكبيرة احكم بـ unique count |
| الأخطاء | `progress.stop_reason` + `error` + grep على `EADDRINUSE`/`session switch`/`request_failed` |
| النتيجة النهائية | عيّنة 20 صفاً تخص الصفحة المختارة فعلاً + صفر تكرار + صفر mailbox أجنبي |

---

## 6) أخطار وملاحظات تنفيذ (من skill)

- **STALE SERVICE على 3100:** اقتل بالـ port لا بالـ pattern؛ تأكد `health=DOWN` قبل الإطلاق؛ grep `EADDRINUSE` بعده. استخدم `PORT=3200` للـ probe.
- **`tsx watch` يفشل jobs الجارية:** لا تعدّل ملفات الخدمة أثناء job حيّ.
- **cache المتصفح بعد deploy:** أخبر Khaled بـ `Ctrl+Shift+R`.
- **الجلسة المتصلة إلزامية:** `guest/disconnected` تُرفض عند submit — لا اختبار بدونها.
- **probe عبر `page.evaluate(template string)`** لتفادي حقن `__name` من tsx.
- **النشر:** `git push origin main` إلى `a4rbcom-maker/flowtix-social-connect-dad4fa55` → انتظر `conclusion: success` على نفس `head_sha`.
