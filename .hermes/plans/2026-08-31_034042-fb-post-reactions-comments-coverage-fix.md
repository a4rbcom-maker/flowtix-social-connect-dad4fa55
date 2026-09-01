# خطة إصلاح استخراج تعليقات + تفاعلات منشور Facebook (تغطية عالية)

> **For Hermes:** هذه خطة تحقيق-أولاً (`systematic-debugging`) ثم إصلاح مشروط. **NO FIX BEFORE ROOT CAUSE.** لا تُنفَّذ أي مهمة تعديل كود قبل إكمال المرحلة 1 وإثبات السبب بالأرقام، والحصول على موافقة "اعتمد" من المستخدم على السبب + الإصلاح المقترح.

**الهدف:** جعل ميزتَي `post_comments` و `post_reactions` (FB) تستخرجان أكبر عدد فعلي متاح من التعليقات والمتفاعلين، مع استهداف ≥70% تغطية عند الإمكان، وإثبات ذلك بالأرقام لكل مسار على حدة.

**البنية الحالية (كما هي في الكود اليوم):** كلا الـ extractor يلتقط طلب GraphQL الذي يُطلقه FB نفسه عبر `GraphQLInterceptor` ثم يعيد تشغيله بـ cursor (`replayWithCursor`)، مع DOM dialog كـ fallback. الالتقاط يتم بـ `page.on("request"/"response")`.

**Tech Stack:** Express + Playwright (extraction-service، port 3100)، Supabase (Postgres + RLS)، جلسات FB في `fb_browser_profiles`/`fb_sessions`.

---

## السياق / الافتراضات الحرجة (مستخلصة من قراءة الكود + skills)

1. **تناقض موثَّق داخل الـ skill:**
   - `references/fb-graphql-interception.md` (2026-08-29، الأحدث): "`page.on` يفشل صامتاً داخل الـ extractors → `capturedRequests.length === 0`. الحل: `page.route()`."
   - `references/fb-post-reactions-comments.md` (2026-08-26، الأقدم): "حد منصّة، 70% غير ممكن" — **لكن استُنتج من تجارب التقط فيها الـ interceptor صفر طلبات**، أي بأداة معطوبة.
2. **الـ interceptor لم يُرحَّل بعد إلى `page.route`** — تحقّقت: `grep "page.route" graphql-interceptor.ts` = لا شيء. لا يزال `page.on`.
3. **مسار IG يعمل بأسلوب مختلف تماماً** (`ig-post-users.ts`): `fetch()` مباشر داخل الصفحة لـ GraphQL API بـ doc_id ثابت + `after` cursor. هذا الأسلوب لا يعتمد على "التقاط ثم إعادة تشغيل" وبالتالي محصّن ضد فشل الالتقاط. مسار FB لا يستخدمه.
4. **قاعدة الجلسة:** جلسة `guest`/`disconnected` تُرفض عند `POST /extract`؛ لا يمكن اختبار كود جديد بدون جلسة `connected` حيّة فعلاً (حتى لو قال DB `connected`، قد يكون FB خفّضها لـ guest بعد فتح عدة contexts من نفس IP). إعادة استيراد الكوكيز مطلوبة قبل أي تشغيل حيّ.
5. **فخ الخدمة الميتة على 3100:** لا تُشغّل probe service على 3100. استخدم `PORT=3200`، واقتل بالـ port لا بالـ pattern.
6. **تمرير JS للصفحة كـ template string** لا كدالة (tsx يحقن `__name`).

---

## المرحلة 0: تجهيز حلقة تغذية راجعة قابلة للاحمرار (Feedback Loop)

**الهدف:** أمر واحد يحمرّ على العَرَض الحقيقي (عدد ضئيل ثم إنهاء) ويخضرّ عند الإصلاح — قبل بناء أي نظرية.

### الخطوة 0.1: تأكيد جلسة FB حيّة قابلة للاستخدام
- استعلم عن الجلسات المتصلة:
  ```sql
  select session_id, status, updated_at from fb_sessions where status='connected' order by updated_at desc limit 5;
  ```
- إن لم توجد جلسة حديثة موثوقة → **توقّف واطلب من المستخدم إعادة استيراد كوكيز / تسجيل دخول** قبل المتابعة (لا يمكن إثبات شيء بدونها). لا تخمّن.

### الخطوة 0.2: اختيار منشورَي اختبار معلومَي العدد
- منشور تعليقات معروف عدده تقريباً (مثلاً ~25 و منشور آخر أكبر ~200+).
- منشور تفاعلات معروف عدده (صغير ~13 وكبير آلاف).
- سجّل: `العدد الحقيقي المعروض على FB` لكل منشور (هذا هو مقام التغطية).

### الخطوة 0.3: أمر الحلقة (real API path، ليس قراءة كود)
- شغّل الخدمة على `PORT=3200` (بعد قتل أي listener على 3200 بالـ port، وتأكيد `curl localhost:3200/health` = DOWN قبل الإطلاق).
- أنشئ مهمة حقيقية:
  ```bash
  curl -s -X POST localhost:3200/extract \
    -H "X-API-Key: $(grep '^API_KEY=' extraction-service/.env | cut -d= -f2 | tr -d '\r')" \
    -H "Content-Type: application/json" \
    -d '{"session_id":"<UUID>","type":"post_comments","source_url":"<POST_URL>","max_results":100000}'
  ```
- راقب المهمة عبر DB (نمط `scripts/monitor-job.mjs`) حتى `status != 'running'`، وسجّل: `progress.discovered`, `result_count`, `progress.stop_reason`, `progress.coverage_rate`, المدة، أي `error`.
- **المعيار:** الحلقة حمراء إذا استخرجت عدداً ضئيلاً (مثلاً 3-6) رغم عدد حقيقي كبير. خضراء إذا بلغت تغطية معقولة.

---

## المرحلة 1: إثبات السبب الجذري (probe حيّ — قبل أي تعديل)

**لا انتقال للمرحلة 2 قبل إثبات أيٍّ من الفرضيات التالية بالأرقام.**

### الفرضيات المرتّبة (falsifiable)

| # | الفرضية | التنبؤ القابل للاختبار | الرخص/الأولوية |
|---|---------|------------------------|-----------------|
| H1 | **الـ interceptor (`page.on`) يلتقط صفر/قليل جداً من طلبات FB داخل الـ extractor** → `findReactionsRequest`/`findCommentsRequest` يفشلان → لا مسار GraphQL أصلاً، فقط DOM facepile الثابت. | probe يقارن `page.on` مقابل `page.route` على نفس المنشور: إن التقط `page.route` طلبات تحمل edges/page_info بينما `page.on` التقط صفر → H1 مثبتة. | **الأعلى** — موثّقة في الـ skill نفسه، ورخيصة الاختبار. |
| H2 | **FB فعلاً يكشف قائمة مُصفَّحة عبر fetch مباشر** (مثل IG) بـ doc_id ثابت + cursor، والكود الحالي لا يستغلها إطلاقاً. | probe يستدعي `fetch` داخل الصفحة لطلب التعليقات/التفاعلات الذي التقطه `page.route`، ويُصفِّح عبر `end_cursor` → يجمع أضعاف الـ facepile. | عالية — يثبت أن "حد المنصّة" استنتاج خاطئ. |
| H3 | **استنتاج "حد المنصّة" صحيح** (لا cursor حقيقي، الرد payload المنشور لا قائمة). | حتى مع `page.route` + fetch مباشر، لا يوجد `page_info.has_next_page=true` ولا edges للمتفاعلين → عدد ثابت مهما صفّحنا. | متوسطة — إن ثبتت، الإصلاح = تقرير صادق لا bypass. |
| H4 | **الالتقاط يعمل لكن `replayWithCursor` يضع الـ cursor في مكان خاطئ** فيرجع صفحة فارغة → توقّف مبكر. | replay يدوي بأسماء حقول cursor مختلفة يرجع مستخدمين جدد بينما الحالي يرجع 0. | أقل. |
| H5 | **مشكلة حفظ/dedup** (`getExistingIds(workspaceId,...)` — و workspace_id ميت/NULL) تُسقط النتائج بصمت. | `progress.discovered` مرتفع لكن `result_count` منخفض → dedup/حفظ. FB path يستخدم `getExistingIds(workspaceId)` وهو no-op اليوم (workspace_id ميت) — لا يُسقط شيئاً فعلياً، لذا مستبعد لكن يُتحقق منه. | منخفضة — تحقّق سريع فقط. |

### الخطوة 1.1: probe التقاط تفاضلي (page.on مقابل page.route)
- استخدم/وسّع `src/debug-fb-graphql-capture.ts` (موجود) ليُشغّل **كلا** الآليتين على نفس تحميل الصفحة ونفس نقرات "المزيد من التعليقات" + فتح dialog التفاعلات:
  - عدّاد طلبات `page.on` مقابل `page.route`.
  - لكل طلب: `doc_id`, مفاتيح `variables`, هل الرد يحمل `profile.php?id=`, `edges`, `page_info.has_next_page`, `end_cursor`.
- شغّل بـ `PROBE_SESSION=<UUID>` على `PORT=3200` (أو standalone probe، مع `browserPool.init()` إن لزم).
- **مخرج مطلوب:** جدول لكل منشور: `capturedByOn` / `capturedByRoute` / `docIdsWithPageInfo` / `sampleEndCursor`.
- **قرار:** إن `route > on` وطلبات route تحمل page_info → **H1 مثبتة** والانتقال لـ 1.2. إن كلاهما صفر لطلبات تحمل متفاعلين → اختبر H3 مباشرة.

### الخطوة 1.2: probe fetch مباشر مُصفَّح (اختبار H2)
- من داخل الصفحة (template string، `credentials:"include"`)، أعِد تشغيل طلب التعليقات/التفاعلات الذي التقطه route، مع `after=<end_cursor>` عبر عدة صفحات (سقف 10 صفحات للـ probe).
- سجّل لكل صفحة: `+usersجدد`, `hasNext`, `end_cursor`.
- **قرار:**
  - إن جمع أضعاف الـ facepile مع `hasNext=true` متكرر → **H2 مثبتة**، والإصلاح = تبنّي أسلوب IG (fetch مباشر مُصفَّح) لمسار FB.
  - إن ثبت عند عدد صغير مع `hasNext=false` من أول صفحة → **H3 مثبتة** (حد منصّة حقيقي)، والإصلاح = تقرير صادق + تحسين الـ facepile/DOM فقط لأقصى متاح.

### الخطوة 1.3: تحقق حفظ/dedup (اختبار H5 — سريع)
- من مهمة الحلقة (0.3): قارن `progress.discovered` بـ `result_count`.
- إن `discovered >> result_count` → افحص مسار `processBatch` (FB يستخدم `getExistingIds(workspaceId)` و workspace_id NULL؛ نظرياً no-op يرجع Set فارغ فلا يُسقط شيئاً — أكّد ذلك بقراءة الاستعلام الفعلي وربطه بعدّاد `existing.size` في اللوج).

### قائمة إكمال المرحلة 1
- [ ] جلسة FB متصلة حيّة مؤكَّدة.
- [ ] الحلقة الحمراء أُعيد إنتاجها عبر `POST /extract` الحقيقي (ليس قراءة كود) لكلا النوعين مستقلّين.
- [ ] probe التقاط تفاضلي أنتج أرقاماً تحسم H1.
- [ ] probe fetch مباشر أنتج أرقاماً تحسم H2 مقابل H3.
- [ ] تحقّق H5 (discovered مقابل result_count).
- [ ] **السبب الجذري مُثبَت بالأرقام لكل مسار (تعليقات/تفاعلات) على حدة، مكتوب صراحةً.**

**توقّف:** اكتب السبب الجذري + الإصلاح الأدنى المقترح، وانتظر "اعتمد" قبل المرحلة 2.

---

## المرحلة 2: الإصلاح الأدنى الآمن (مشروط بنتيجة المرحلة 1)

> تُنفَّذ **فقط** المهمة المطابقة للسبب المُثبت. كل مهمة 2-5 دقائق، TDD حيث ينطبق، commit بعد كل مهمة.

### المسار A — إذا ثبتت H1 (+ غالباً H2): الالتقاط معطوب + غياب fetch مباشر

الملفات المرشّحة للتغيير:
- Modify: `extraction-service/src/services/graphql-interceptor.ts` — ترحيل `attach()`/`detach()` إلى `page.route("**/api/graphql/**", ...)` مع `route.fetch()` + `route.fulfill()` لالتقاط الرد، والحفاظ على توقيع `getCapturedRequests()`/`getInterceptedTexts()` كما هو (backward-compatible) — النمط الحرفي في `references/fb-graphql-interception.md`.
- (إن ثبتت H2) Modify: `extraction-service/src/extractors/post-comments.ts` و `post-reactions.ts` — إضافة مسار fetch مباشر مُصفَّح على غرار `fetchLikersViaApi`/`fetchCommentsViaApi` في `ig-post-users.ts` (نفس نمط `after`/`end_cursor`/pacing 1.2s/سقف صفحات)، مع الإبقاء على DOM dialog كـ fallback. **لا يُعاد كتابة كود يعمل بلا سبب.**

خطوات المسار A (نموذج TDD لكل تعديل):
1. **اختبار فاشل:** أضف/وسّع اختباراً في `src/extractors/__tests__/` أو `src/services/__tests__/` يثبت أن الـ parser يُخرج المستخدمين + page_info من عيّنة رد FB حقيقية (dump من probe: `probe-response-*.json`). شغّله ليفشل أولاً.
2. **التحقق من الفشل:** `npx tsx --test 'src/services/__tests__/*.test.ts'` → FAIL متوقّع.
3. **التنفيذ الأدنى:** طبّق ترحيل `page.route` (و/أو مسار fetch المباشر).
4. **التحقق من النجاح:** أعِد الاختبار → PASS.
5. **`npm run build`** (service — يشمل `*.test.ts` في tsc) → أخضر.
6. **commit.**

### المسار B — إذا ثبتت H3 (حد منصّة حقيقي)
- Modify: `post-reactions.ts`/`post-comments.ts` — لا bypass. حسّن جمع الـ facepile/DOM لأقصى متاح فعلاً، واضبط `stop_reason` = `source_exhausted` بصدق، واحسب `coverage_rate` مقابل العدد الحقيقي.
- حدّث `references/fb-post-reactions-comments.md` بالأرقام الجديدة المُثبتة (مع تصحيح أن الاستنتاج القديم بُني على interceptor معطوب).
- **أبلغ المستخدم أن ≥70% غير ممكن لهذا النوع من المنشورات مع الأرقام التي تثبته.**

### المسار C — إذا ثبتت H4 (cursor placement)
- Modify: `graphql-interceptor.ts` `replayWithCursor` — صحّح موضع حقل الـ cursor ليطابق شكل الاستعلام المُثبت في probe.

### المسار D — إذا ثبتت H5 (dedup/حفظ)
- عالج السبب في مسار الحفظ (لا تُغيّر سلوك dedup عبر المهام بصمت — قرار تصميمي يُناقَش مع المستخدم).

---

## المرحلة 3: منع تكرار الفئة (Class fix)

- افحص كل مسار يستخدم `GraphQLInterceptor` (بحث: `new GraphQLInterceptor` عبر `src/`) — أي إصلاح للالتقاط يجب أن ينفع كل مستهلكيه لا موضع البلاغ فقط.
- تأكّد ألا يكسر التغيير مسارات groups/pages التي قد تعتمد نفس الـ interceptor.

---

## المرحلة 4: الاختبارات + التحقق

- `cd extraction-service && npm run build` (يشمل test files في tsc — إلزامي بعد أي تعديل اختبار).
- `npm run typecheck` (الواجهة، إن لزم).
- `npx tsx --test 'src/extractors/__tests__/*.test.ts' 'src/services/__tests__/*.test.ts'` — يجب أن تمر كلها، وألا يزيد عدد الإخفاقات عن خط الأساس (baseline diff بـ git stash إن لزم).
- **إعادة تشغيل حلقة المرحلة 0.3 الحقيقية** على نفس منشورَي الاختبار بعد الإصلاح.

---

## الإثبات النهائي (إلزامي — لكل مسار مستقلاً)

جدول لكل من `post_comments` و `post_reactions`:

| المسار | العدد المتاح | العدد المستخرج | نسبة التغطية | المدة | الأخطاء | سبب أي بيانات لم تُدرك |
|--------|--------------|----------------|--------------|-------|---------|------------------------|
| تعليقات (منشور صغير) | | | | | | |
| تعليقات (منشور كبير) | | | | | | |
| تفاعلات (منشور صغير) | | | | | | |
| تفاعلات (منشور كبير) | | | | | | |

- نظّف مهام الاختبار من DB بعد الإثبات (`update status='canceled'` — لا حذف بسبب فخ enum `activity_action`).

---

## المرحلة 5: مراجعة الكود (`requesting-code-review`)

- راجع الـ diff كاملاً بحثاً عن: Regression, Bugs, Security, Performance, تغييرات غير ضرورية, منطق مكرر, حلول مؤقتة.
- أصلح أي مشكلة حقيقية، أعِد الاختبارات، ثم تحقّق من المشكلة الأصلية تحديداً.

---

## المخاطر والمقايضات والأسئلة المفتوحة

- **خطر:** ترحيل `page.route` قد يتداخل مع `replayWithCursor` (الذي يستخدم `page.evaluate`+fetch) أو يبطئ التحميل — راقب زمن التحميل في probe.
- **خطر:** أي تعديل على ملف خدمة أثناء تشغيل مهمة يُفشلها (tsx watch)؛ نفّذ التعديلات والخدمة متوقفة.
- **مقايضة:** إن ثبتت H3، النتيجة الصادقة قد تكون أقل من 70% — وهذا هو الصواب لا الفشل.
- **سؤال مفتوح للمستخدم (بعد probe):** إن ثبت حد منصّة على منشورات كبيرة بينما ينجح على الصغيرة، هل يقبل تغطية عالية على الصغيرة + تقرير حد صريح على الكبيرة؟
- **قاعدة صارمة:** `NO FIX BEFORE ROOT CAUSE` — لا انتقال للمرحلة 2 قبل probe يحسم H1/H2/H3 بالأرقام + موافقة "اعتمد".

**معيار النجاح:** Root Cause مُثبت بالأرقام + إصلاح مستقر + نتائج تحسّنت فعلاً (أو حد منصّة مُثبت بصدق) + اختبارات ناجحة + Code Review ناجح + المشكلة الأصلية انتهت لكل مسار مستقلاً.
