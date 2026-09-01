# خطة إصلاح: جهات اتصال ماسنجر (list-pages + استخراج + رسالة جماعية)

> **For Hermes:** نفّذ بعد موافقة Khaled ("اعتمد"). استخدم subagent-driven-development لو رغب، وإلا نفّذ مباشرة بالترتيب. كل تغيير يُثبت بـ DB/log حقيقي، ليس ادّعاء.

**Goal:** جعل جلب الصفحات المدارة سريعًا ودقيقًا (بدون إدخالات وهمية مثل "عدد الإشعارات غير المقروءة")، وإصلاح استخراج جهات اتصال ماسنجر بحيث لا يُسجّل خروج من فيسبوك ولا يعود بـ 0، وضمان ظهور خيار "إرسال رسالة جماعية" على النتائج الحقيقية.

**Architecture:** استبدال DOM‑scraping الهشّ في `/list-pages` باعتراض حمولة GraphQL لمبدّل الهوية (المصدر الحقيقي للصفحات المُدارة)، مع مسار DOM احتياطي مُشدّد التصفية. وتقليص عمليات التنقّل المتكررة في مستخرِج ماسنجر (السبب الرئيسي للبطء وتسجيل الخروج القسري) عبر إعادة استخدام سياق واحد ومسار GraphQL أولًا. وربط زر "رسالة جماعية" بالحالة الفعلية للنتائج.

**Tech Stack:** Express + Playwright (extraction-service, منفذ 3100)، React 19 + Vite (frontend)، Supabase (Postgres + RLS). النشر: push إلى `main` → GitHub Actions (`a4rbcom-maker/flowtix-social-connect-dad4fa55`) → التحقق على `https://api.flowtixtools.com`.

---

## Current context / evidence (تم التحقق منه فعليًا)

- آخر مهمة `messenger_contacts` نجحت فعليًا: `9cb17124-…` صفحة `xtramenucom`، `count=58`، `stop_reason=source_exhausted`، لكن `enrichment.coverage_percent=0` (`not_found=58`). أي أن 0 المذكورة ليست دائمة — المشكلة تظهر عند فشل حلّ الـ mailbox أو عند اختيار إدخال صفحة وهمي.
- **المشكلة 1 (بطء الجلب):** `routes/list-pages.ts` يفتح `facebook.com/pages/?category=your_pages` ثم ينتظر `3s + networkidle(8s) + 1.5s` قبل مسح كل `<a href>`. ملاحظة مُثبتة سابقًا (probe 2026‑08‑30): هذه الصفحة **لا تعرض بطاقات صفحات في DOM** على فيسبوك الحديث — فقط ~10 روابط تنقّل، وحمولات GraphQL عند التحميل لا تحمل كيانات الصفحات. النتيجة: انتظار طويل + نتائج غير موثوقة.
- **المشكلة 2 (إدخال "عدد الإشعارات غير المقروءة"):** المسح في `list-pages.ts:71‑135` يلتقط أي رابط بمقطع واحد `/xxx`، ويستخرج الاسم من أول سطر نصّي في البطاقة (`:109‑119`). فلتر تخطّي الإشعارات (`:113`) يشترط بدء السطر برقم **و** احتواءه على كلمة مثل "إشعار/رسالة"، لكن روابط الشريط الجانبي قد تُنتج بطاقة نصّها الأول عدّاد إشعارات بصيغة لا يلتقطها الفلتر، فيُسقَط إلى `name = username` ويظهر كـ"صفحة". السبب الجذري: الاعتماد على DOM heuristics بدل كيانات صفحات حقيقية.
- **المشكلة 3 (بطء الاستخراج + خروج من فيسبوك + 0):** في `extractors/messenger-contacts.ts`:
  - تنقّل متكرر ثقيل: حلقة `inboxUrls` بثلاث عناوين (`:228‑247`) كل واحدة `5s + networkidle(10s) + 5s` ≈ 45‑60s، ثم `resolveMailboxId` ملاحة إضافية لـ business.facebook.com (`:598‑646`) ≈ 17s، ثم `bootstrapAndPaginate` ملاحة أخرى لنفس الـ inbox (`:684‑689`). أي **3‑4 عمليات تنقّل ثقيلة** قبل أول نتيجة.
  - **الخروج القسري (خاصّ بماسنجر فقط):** السبب هنا هو **كثرة الملاحات الثقيلة لصندوق Business Suite (`business.facebook.com/inbox`) وإنشاء السياقات المتكررة** — وليس نقص البروكسي. ملاحظة Khaled الحاسمة: استخراج التفاعلات/التعليقات من أي بوست **لا يحتاج بروكسي إطلاقًا** لأنه يعمل على بيانات بوست عامة بجلسة واحدة بلا مسار inbox. إذن هذه المشكلة مقصورة على مسار ماسنجر بسبب التنقّل المكثّف، والحل هو تقليصه (Task 3) لا البروكسي. عند تدهور الجلسة إلى guest أثناء التشغيل تعود النتائج 0.
  - **0 نتيجة:** لو تعذّر حلّ `mailboxId` يُتخطّى محرّك GraphQL بالكامل (`:659‑662`) ولا يتبقّى إلا الاعتراض/DOM على صفحة البروفايل — وهي تعطي 0 غالبًا. وإذا كان `source_url` هو سلَگ إدخال وهمي (المشكلة 2) يفشل الاستخراج من الأساس.
- **المشكلة 4 (خيار الرسالة الجماعية):** الزر موجود فعلًا في `ExtractContactsPage.tsx:630‑638` لكنه مُقيّد بـ `disabled={!stats.hasMessage}` أي `count>0` فقط. عند رجوع 0 لا يظهر — فإصلاح الاستخراج يحلّه. مسار البثّ نفسه جاهز (`routes/messages.ts` + `message-worker.ts`).

## Assumptions
- الجلسة المستخدمة `connected` وفعليًا مُسجّلة الدخول (وإلا يُرفض الطلب عند submit — سلوك حارس، ليس عيبًا).
- لا يوجد بروكسي مُهيّأ حاليًا (سبب رئيسي للخروج) — يُطرح كتوصية لا كإلزام في هذه الخطة.
- التصميم يجب ألا يكشف للمستخدم النهائي أي آليات داخلية (mailbox/doc_id/عدّادات).

---

## Proposed approach (المعمارية المقترحة)

1. **`/list-pages` — مصدر حقيقي بدل DOM scraping.** المصدر الموثوق للصفحات المُدارة هو حمولة **مبدّل الهوية** (`profile_for_intent_switching` / `COMET_IDENTITY_SWITCHER`) التي يعرضها فيسبوك عند فتح قائمة "التبديل بين الملفات" — تحمل كيانات صفحات حقيقية (`id` رقمي + `name` + صورة + نوع). نعترضها عبر `page.on("response")` أثناء ملاحة واحدة، ونستخرج فقط الكيانات ذات `__typename`/نوع = صفحة. هذا سريع (ملاحة واحدة) ودقيق (لا إدخالات وهمية). نُبقي مسار DOM كـ fallback لكن بتصفية مُشدّدة (رقم/عدّاد إشعارات = استبعاد قاطع، ورفض أي إدخال بلا `id` رقمي حقيقي).

2. **مستخرِج ماسنجر — تنقّل أقل، GraphQL أولًا، سياق واحد.**
   - إزالة حلقة `inboxUrls` الثلاثية والاكتفاء بملاحة واحدة إلى inbox الصفحة المحلولة.
   - دمج `resolveMailboxId` مع أول ملاحة (استخراج `mailbox_id`/`asset_id` من نفس الحمولة/URL بدل ملاحة منفصلة).
   - تشغيل `bootstrapAndPaginate` (مسار GraphQL) مباشرة بعد حلّ الـ mailbox، وجعل حلقات السكرول آخر ملاذ فقط عند 0 من GraphQL.
   - **منع الخروج القسري:** تمرير `pageId` الرقمي الحقيقي من `/list-pages` (كيان مبدّل الهوية) إلى `/extract` كـ `source_url` بدل السلَگ، وتقليل عدد الملاحات إلى business.facebook.com إلى واحدة. الخروج هنا سببه التنقّل المكثّف لا نقص البروكسي (التفاعلات/التعليقات لا تحتاج بروكسي إطلاقًا) — فالحل تقليص الملاحات، لا إضافة بروكسي.

3. **خيار "رسالة جماعية".** إبقاء البوابة على `count>0` (سلوك صحيح)، والتأكد أن إصلاح الاستخراج يعيد النتائج الحقيقية فيظهر الزر. لا كشف لأي آلية داخلية. (اختياري، بموافقة صريحة: إظهار الزر مُعطّلًا مع تلميح "لا نتائج بعد" بدل إخفائه.)

---

## Step-by-step plan

### Task 1: probe حيّ لمصدر الصفحات المُدارة (قبل أي تعديل)
**Objective:** إثبات الشكل الحقيقي لحمولة مبدّل الهوية قبل كتابة أي selector (قاعدة المهارة: probe قبل selectors).

**Files:**
- Create (مؤقت): `extraction-service/src/debug-managed-pages-probe.ts`

**Step 1:** كتابة probe يفتح `https://www.facebook.com/`، يفتح قائمة التبديل (نقر عنصر "Switch"/"التبديل بين الملفات") ويعترض كل استجابات graphql التي نصّها يحتوي `profile_for_intent_switching` أو `identity_switcher`، ويطبع أول كيان صفحة (id/name/typename/صورة). يجب `await browserPool.init()` أولًا (سياق مستقل) واستخدام `page.evaluate(\`...\`)` كـ template string لتجنّب حقن `__name` من tsx.

**Step 2:** التشغيل بجلسة `connected` حقيقية عبر `getSessionAndCookies`. Run:
`cd extraction-service && npx tsx src/debug-managed-pages-probe.ts <session_id>`
Expected: طباعة ≥1 كيان صفحة حقيقي بـ `id` رقمي، وعدم ظهور أي "عدد الإشعارات".

**Step 3:** توثيق الشكل في `flowtix-extraction-service/references/messenger-contacts-extraction.md` (قسم جديد "managed-pages source"). حذف ملف الـ probe بعد التوثيق.

**Verification:** الـ probe يطبع كيانات صفحات فقط، لا عدّادات إشعارات.

---

### Task 2: إعادة كتابة `/list-pages` على أساس اعتراض GraphQL + fallback DOM مُشدّد
**Objective:** جلب سريع ودقيق للصفحات المُدارة بدون إدخالات وهمية.

**Files:**
- Modify: `extraction-service/src/routes/list-pages.ts:40‑141`

**Step 1 (RED):** إضافة اختبار وحدة نقي لدالة تصفية الكيانات (تُستخرج كـ pure function `isManagedPageEntity(entity)`), يتحقق أن كيان `{name:"عدد الإشعارات غير المقروءة"}` أو أي اسم يبدأ برقم/عدّاد يُرفض، وأن كيان صفحة حقيقي بـ id رقمي يُقبل.
- Create: `extraction-service/src/routes/__tests__/list-pages-filter.test.ts`
Run: `npx tsx --test 'src/routes/__tests__/list-pages-filter.test.ts'` → Expected: FAIL (الدالة غير موجودة).

**Step 2 (GREEN):** تنفيذ `isManagedPageEntity`: يقبل فقط كيانًا بـ `id` رقمي `\d{5,}` واسم طوله 2‑80 لا يبدأ برقم ولا يحتوي كلمات عدّاد ("إشعار"، "رسالة غير مقروءة"، "notification"، "unread")، ونوع ليس ضمن مجموعة الاستبعاد. ثم إعادة صياغة `/list-pages` ليعترض حمولة مبدّل الهوية أثناء ملاحة واحدة (`goto www.facebook.com` + فتح مبدّل الهوية)، يجمع كيانات الصفحات عبر deep‑walk (نفس أسلوب `walkJSON` في messenger‑contacts) ويمرّرها عبر `isManagedPageEntity`. إبقاء DOM scraping القديم كـ fallback فقط عند 0 كيانات من الاعتراض، مع تمرير نتائجه هي أيضًا عبر `isManagedPageEntity` (رفض أي إدخال بلا id رقمي).
Run الاختبار → Expected: PASS.

**Step 3:** إرجاع `pages[]` بحقل `id` = **المعرّف الرقمي الحقيقي** للصفحة (وليس السلَگ)، مع `username` منفصل للعرض. هذا يمنع تمرير سلَگ وهمي إلى `/extract`.

**Step 4:** `npm run build` (يشمل tsc على `*.test.ts`) → Expected: 0 أخطاء.

**Verification:** استدعاء حيّ:
`curl -s -X POST localhost:3100/list-pages -H "X-API-Key: $KEY" -H 'Content-Type: application/json' -d '{"session_id":"<id>"}' | jq '.pages | length, (.[].name)'`
Expected: قائمة صفحات حقيقية فقط، زمن الاستجابة أقل من السابق، لا "عدد الإشعارات".

---

### Task 3: تقليص التنقّل في مستخرِج ماسنجر (بطء + خروج قسري)
**Objective:** أول نتيجة أسرع، وعدد ملاحات أقل يقلّل إشارة الخروج القسري.

**Files:**
- Modify: `extraction-service/src/extractors/messenger-contacts.ts:228‑255` (حلقة inboxUrls + استدعاء bootstrap)
- Modify: `extraction-service/src/extractors/messenger-contacts.ts:598‑689` (دمج resolveMailbox مع أول ملاحة)

**Step 1:** إزالة حلقة `inboxUrls` الثلاثية (`:228‑247`) والاكتفاء بملاحة inbox واحدة تُشتق من `pageId` الرقمي القادم من `source_url`.

**Step 2:** دمج `resolveMailboxId`: بدل ملاحة منفصلة، قراءة `mailbox_id`/`asset_id` من الحمولة المعترَضة أثناء ملاحة الـ inbox الأولى أو من `page.url()` بعدها. إبقاء الإرجاع الآمن `""` عند التعذّر (بلا fallback ثابت — قاعدة عزل المستأجرين).

**Step 3:** تشغيل `bootstrapAndPaginate` مباشرة، وجعل Phase‑0/Phase‑3 السكرول تعمل فقط لو `contacts.size === 0` بعد GraphQL (آخر ملاذ)، مع خفض ميزانية السكرول لكل دورة (`25_000`/`30_000` → قيمة أقل) لتفادي دورات طويلة عديمة الحصيلة.

**Step 4:** عند رصد guest/انتهاء الجلسة أثناء التشغيل، إنهاء متدرّج (paused + enrich الموجود) مع رسالة عربية مفهومة للمستخدم لا تكشف الآلية. (لا توصية بالبروكسي — المشكلة تنقّل مكثّف يُحلّ بتقليصه، لا نقص بروكسي.)

**Step 5:** `npm run build` → 0 أخطاء.

**Verification (real run):** إنشاء مهمة حقيقية عبر `POST /extract` type `messenger_contacts` بصفحة حقيقية وجلسة `connected`، ومراقبة `extraction_jobs` عبر `scripts/monitor-job.mjs`:
- أول تحديث تقدّم أسرع من قبل (ملاحة واحدة).
- `result_count > 0` عند وجود محادثات حقيقية.
- الجلسة تبقى `connected` بعد المهمة (فحص `fb_sessions.status` + محاولة `/health`).

---

### Task 4: التأكد من مسار "رسالة جماعية" على النتائج الحقيقية
**Objective:** ظهور الزر وعمل البثّ بعد استخراج ناجح.

**Files:**
- Read‑only: `src/pages/dashboard/extraction/ExtractContactsPage.tsx:630‑638`, `extraction-service/src/routes/messages.ts`, `services/message-worker.ts`
- Modify (اختياري بموافقة صريحة فقط): `ExtractContactsPage.tsx:633` لإظهار الزر مُعطّلًا مع تلميح بدل الإخفاء.

**Step 1:** بعد مهمة Task 3 الناجحة، التحقق أن `stats.hasMessage` = true (count>0) والزر ظاهر.

**Step 2:** اختبار بثّ حقيقي مقيّد: `POST /messages/start` مع `max_recipients:2` وتأخيرات قصيرة، مراقبة سطور `MsgWorker`، ثم التحقق عبر REST من حالات `message_recipients` + صف `message_send_counters` + بقاء الجلسة `connected`. تنظيف: `DELETE` على `message_jobs` التجريبية.

**Step 3:** التأكد من عدم كشف أي آلية داخلية في واجهة المستخدم (نصوص عربية بسيطة فقط).

**Verification:** رسالتان تظهران كـ `You:` في الخيط، `sent=2`، الجلسة سليمة.

---

### Task 5: النشر والتحقق الإنتاجي
**Objective:** إثبات أن الإصلاح حيّ في الإنتاج.

**Step 1:** `npm run build` (service) + `npm run typecheck` (frontend) + تشغيل اختبارات الوحدة.
**Step 2:** commit + `git push origin main` (الريبو الرسمي لـ FlowTix — push مباشر إلى main، بلا gh CLI).
**Step 3:** انتظار GitHub Actions حتى `conclusion: success` على نفس `head_sha` عبر
`api.github.com/repos/a4rbcom-maker/flowtix-social-connect-dad4fa55/actions/runs`.
**Step 4:** إعادة اختبار على `https://api.flowtixtools.com` بجلسة حقيقية، وتذكير Khaled بـ `Ctrl+Shift+R` (كاش Vite سنة كاملة) قبل إعادة الاختبار في المتصفح.
**Verification:** جلب صفحات سريع/نظيف + استخراج > 0 + زر الرسالة الجماعية يعمل، كلها على الدومين الإنتاجي.

---

## Files likely to change
- `extraction-service/src/routes/list-pages.ts` (إعادة كتابة رئيسية)
- `extraction-service/src/routes/__tests__/list-pages-filter.test.ts` (جديد)
- `extraction-service/src/extractors/messenger-contacts.ts` (تقليص التنقّل + دمج resolveMailbox)
- `extraction-service/src/debug-managed-pages-probe.ts` (مؤقت، يُحذف بعد التوثيق)
- `src/pages/dashboard/extraction/ExtractContactsPage.tsx` (اختياري: حالة الزر المُعطّل)
- `flowtix-extraction-service/references/messenger-contacts-extraction.md` (توثيق مصدر الصفحات)

## Tests / validation
- وحدة: `npx tsx --test 'src/routes/__tests__/list-pages-filter.test.ts'`
- بناء: `npm run build` (service, يشمل tsc على test files) + `npm run typecheck` (frontend)
- حيّ: `POST /list-pages` (زمن + نظافة القائمة)، `POST /extract` messenger_contacts (count>0، الجلسة connected)، `POST /messages/start` مقيّد.
- DB proof: قراءة `extraction_jobs` + `extraction_results` + `message_recipients`/`message_send_counters` بأرقام فعلية.

## Risks, tradeoffs, open questions
- **خطر:** فيسبوك يُدوّر شكل حمولة مبدّل الهوية بصمت → التخفيف: fallback DOM مُشدّد + probe موثّق + اعتماد doc_id/كيانات حيّة لا ثابتة.
- **الخروج القسري خاصّ بماسنجر بسبب التنقّل المكثّف** — يُحلّ بتقليص الملاحات (Task 3). ملاحظة مؤكَّدة من Khaled: استخراج التفاعلات/التعليقات من أي بوست لا يحتاج بروكسي إطلاقًا، فلا نُدرج البروكسي كحلّ هنا.
- **enrichment=0 (coverage_percent=0):** خارج نطاق هذه الشكاوى الأربع لكنه ملاحَظ على المهمة 58 — سؤال مفتوح: هل نعالجه في خطة منفصلة؟
- **تراجع محتمل:** أي تعديل في list-pages/messenger يجب ألّا يكسر مسارات FB/Groups/Pages الأخرى — الاختبار الحيّ إلزامي قبل النشر.
- **قرار سلوك الزر:** إظهاره مُعطّلًا عند 0 مقابل إخفائه — يحتاج تأكيد Khaled (لا نغيّر السلوك صامتين).
