# خطة إصلاح: قائمة الجروبات (10 فقط) + تدقيق خدمة النشر

**التاريخ:** 2026-09-01
**النطاق:** `extraction-service/src/routes/list-groups.ts`، `src/pages/dashboard/groups/*`، `extraction-service/src/services/publish-worker.ts`
**الحالة:** خطة فقط — لا تنفيذ قبل "اعتمد"

---

## 1. الإثبات (أرقام حقيقية، لا نظريات)

### 1.1 مصدر البيانات الحالي في الكود
`list-groups.ts:64-91` لا يستخدم GraphQL ولا أي API. هو يفتح `facebook.com/groups/feed/`
ثم يمسح وسوم `<a>` في الـ DOM بهذا الشرط:

```
href.match(/\/groups\/(\d+)/)   ← أرقام فقط
```

أي أن كل ما يُعرض في الواجهة = عدد الروابط التي رسمها فيسبوك في الشريط الجانبي في تلك اللحظة.
الشريط الجانبي في Comet لا يرسم كل جروباتك — يرسم **قائمة اختصارات قصيرة للجروبات النشطة حديثاً**
(حجمها ثابت تقريباً ~10). لا يوجد في الكود: تمرير (scroll)، ولا مؤشر صفحات (cursor)،
ولا انتقال إلى تبويب "كل الجروبات". لذلك **الـ 10 ليست حداً في فيسبوك بل هي سقف الشريط الجانبي**.

### 1.2 مشاكل إضافية مؤكدة في نفس الدالة
- `\d+` فقط ⇒ أي جروب رابطه vanity slug (`/groups/kafr-sakr`) **يُحذف بصمت**.
- الاسم يُقرأ من `link.innerText` كاملاً ⇒ يحتوي أسطراً إضافية (لهذا ظهر "آخر نشاط منذ ساعتين" ملتصقاً بالاسم في الصورة).
- الحقول التالية **قيم ثابتة مكتوبة يدوياً** وليست بيانات حقيقية (`list-groups.ts:87`):
  `privacy: ""`, `member_count: ""`, `role: "عضو"`, `can_post: true`.
  وفي الواجهة `MyGroupsTab.tsx:241-249` أي `privacy !== "Public"` يُرسم "خاص"، و`can_post` دائماً true ⇒
  **شارات "خاص / عضو / يمكن النشر" في الصورة معلومات غير حقيقية**. هذه مشكلة سلامة بيانات:
  المستخدم يُخبَر "يمكن النشر" في جروب قد يرفض النشر فعلياً.

### 1.3 نتائج الفحص الحي (probes مؤقتة، حُذفت بعد الفحص)
جلسة `000b1002` (متصلة، تحقّق `verified = logged_in`, `authState=authenticated`):

| ما فُحص | النتيجة |
|---|---|
| `POST https://api.flowtixtools.com/list-groups` (الإنتاج) | `{"groups":[]}` — **صفر** |
| `/groups/feed/` عدد روابط `/groups/<id>` في الـ DOM | 0 (إجمالي الروابط في الصفحة 11) |
| بعد نقر "Your groups" (نفس ما يفعله الكود) | 0 |
| `/groups/joins/` قبل وبعد 8 عمليات scroll | 0 و 0 |
| HTML الكامل للصفحة (2,242,746 بايت) | `"__typename":"Group"` = **0** مرة، ولا أي `facebook.com/groups/<id>` |
| ردود GraphQL أثناء التحميل | 12 رداً، ولا واحد يحمل جروبات (الأسماء: `FBYRPTimeLimitsEnforcementQuery`, `CometSearchBootstrapKeywordsDataSourceQuery`, …) |
| `m.facebook.com/groups/?seemore` و `joins` بـ UA موبايل | يُحوَّل إلى shell فقط، 0 جروب |
| `/bookmarks/groups/` | يُحوَّل إلى `/groups/feed/`، 0 جروب |

الجلسة الأخرى `71ee0847` (المعروضة كـ connected في الـ DB) ردّت:
`SESSION_EXPIRED — Session 71ee0847 is NOT logged in (guest)`.
⇒ **`fb_sessions.status = connected` لا يعني أن الجلسة مسجّلة دخول فعلاً** (مطبّة معروفة).

**استنتاج قاطع:** المعمارية الحالية (كشط DOM) لا تعطي قائمة مضمونة أبداً — تعطي 10 في أفضل الحالات
و**صفر** في الحالة السائدة اليوم. الرقم 10 الذي رآه المستخدم كان أفضل حالة لهذا الأسلوب، لا سقفاً من فيسبوك.

### 1.4 حدود ما لم أستطع إثباته
لم أستطع إعادة إنتاج لقطة الـ10 حياً لأن الجلسة التي أنتجتها أصبحت guest.
لذلك: "الـ10 = سقف الشريط الجانبي" استنتاج من الكود + من كون كل مصادر الـDOM الأخرى تعطي 0،
وليس مقياساً مأخوذاً من نفس الجلسة الأصلية.

---

## 2. تدقيق خدمة النشر (`publish-worker.ts` + الواجهة)

### 2.1 ما هو سليم فعلاً
- تحقق حقيقي بعد النشر: `waitForPublishConfirmation` يبحث عن نص المنشور في `div[role="feed"]` — لا "نجاح كاذب".
- كتابة بلوحة مفاتيح حقيقية (`focus` + `keyboard.type`) وليس `innerText` — النمط المثبت في messenger.
- Idempotency: `postedGroupIds(results)` يمنع النشر مرتين في نفس الجروب عند الاستئناف.
- Checkpoints + `computeFinalStatus` + حماية من ترك المهمة "running" عند الانهيار.
- تباطؤ عشوائي 60–180 ث + دفعات (5 لكل 50 ث) — سلوك آمن ضد الحظر.

### 2.2 عيوب مؤكدة
| # | العيب | الموضع | الأثر |
|---|---|---|---|
| P1 | سجل النشاط يقارن `r.status === "ok"` بينما الـworker يكتب `"posted"` | `ProgressDashboard.tsx:116-122` | كل نشر ناجح يظهر في السجل بلا أيقونة ويُسمّى "تخطي" |
| P2 | خيار "تخطي الجروبات التي لا تسمح بالنشر" لا يفعل شيئاً | `publish-worker.ts:190` البارامتر `_skipOnMissingComposer` غير مستخدم | الإعداد وهمي؛ السلوك دائماً skip |
| P3 | لا استئناف للنشر عند إعادة تشغيل الخدمة | `index.ts:93-96` يستأنف extract/message/ig فقط | مهمة نشر تبقى `running` للأبد وتحجب أي مهمة جديدة عبر حارس `JOB_ALREADY_ACTIVE` |
| P4 | الواجهة تأخذ أول جلسة بلا فحص حالتها | `PublishTab.tsx:14` + `useActiveSessionsForSelect` (لا فلترة على connected) | بدء نشر بجلسة منتهية ⇒ رفض من السيرفر بعد الضغط |
| P5 | `can_post` وهمي قادم من list-groups | `list-groups.ts:87` | المستخدم يختار جروبات "يمكن النشر" ثم تُحتسب skip |
| P6 | لم تُختبر الميزة على نطاق حقيقي | جدول `publish_jobs`: 3 مهام فقط، كل واحدة **جروب واحد**، آخرها 2026-07-23 | لا دليل تشغيلي على النشر الجماعي |

---

## 3. المعمارية المقترحة للحل

**المبدأ:** لا نبني على الـDOM. القائمة تُقرأ من نفس المصدر الذي يستخدمه فيسبوك نفسه: GraphQL،
مع pagination حتى النفاد، وبكيانات حقيقية (`__typename:"Group"` + `id` + `name` + خصوصية + دور العضوية).
وهذا نفس النمط المثبت في المشروع مرتين (`managed-pages-filter.ts` للصفحات، `graphql-interceptor.ts` للتفاعلات).

الطبقات:
1. **A — GraphQL اعتراض + إعادة تشغيل بالمؤشر (المسار الأساسي):**
   `page.route("**/api/graphql/**")` (لا `page.on`، غير موثوق داخل الـextractors — موثّق في المشروع)
   يُلتقط `doc_id` + `variables` + `fb_dtsg` لاستعلام تبويب الجروبات، ثم يُعاد إرساله من داخل الصفحة
   بـ `cursor` متجدد حتى `has_next_page = false`. النتيجة: **كل الجروبات، لا سقف 10**.
2. **B — فلتر كيانات نقي وقابل للاختبار:** ملف جديد `joined-groups-filter.ts` على نمط
   `managed-pages-filter.ts` (`isJoinedGroupEntity`, `extractJoinedGroups`) + اختبار وحدة.
   يقبل الـ id الرقمي **و** الـ vanity slug، ويستخرج `privacy` و`role` الحقيقيين.
3. **C — DOM كخط أخير فقط:** يُستخدم فقط إن أعادت A صفراً، ويُعلَّم الناتج `partial: true`.
4. **D — صدق الحقول:** ما لا نعرفه لا نخترعه. `can_post` يصبح `boolean | null`
   و`role`/`privacy`/`member_count` تُترك فارغة عند الغياب، والواجهة تعرض "غير معروف" بدل شارة كاذبة.
5. **E — كشف الحدود بصراحة:** إن كانت الجلسة guest نُرجع `SESSION_EXPIRED` (موجود)، وإن نفد المصدر
   نُرجع `total` + `source: "graphql" | "dom_partial"` ليظهر في الواجهة "قائمة جزئية" بدل رقم مضلل.

---

## 4. الخطة التنفيذية (مهام صغيرة، TDD)

### Task 1 — probe حي مثبت لاستعلام تبويب الجروبات
**ملفات:** إنشاء `extraction-service/src/debug-joined-groups.ts` (مؤقت، يُحذف بعد الاستخدام)
1. جلسة **متصلة فعلاً** (تحقق أولاً: `POST /list-groups` لا يعيد SESSION_EXPIRED).
2. `page.route("**/api/graphql/**")`، ثم `goto("https://www.facebook.com/groups/joins/?ordering=viewer_added")`،
   ثم نقر تبويب "Your groups"، ثم 6 عمليات scroll مع `waitForTimeout(2500)`.
3. اطبع لكل طلب: `fb_api_req_friendly_name`, `doc_id`, وهل الرد يحتوي `"__typename":"Group"`،
   وعدد الكيانات، واسم حقل المؤشر (`end_cursor` / `page_info`).
**التحقق:** يجب أن يظهر استعلام واحد على الأقل بعدد جروبات > 10.
**بوابة قرار:** إن لم يظهر أي استعلام يحمل جروبات على جلسة سليمة، فالمسار A غير متاح ⇒ نتوقف ونبلّغ
(احتمال أن فيسبوك يخدم القائمة فقط للتطبيق الرسمي) — **لا نكتب كوداً على افتراض غير مثبت**.

### Task 2 — فلتر نقي + اختبار (RED → GREEN)
**ملفات:** إنشاء `extraction-service/src/routes/joined-groups-filter.ts`
+ `extraction-service/src/routes/__tests__/joined-groups-filter.test.ts`
1. اكتب الاختبار أولاً بحالات: كيان جروب صحيح، id رقمي، vanity slug، اسم = عدّاد إشعارات (يُرفض)،
   `__typename` مختلف (يُرفض)، تكرار نفس الـid (dedupe).
2. `npx tsx --test 'src/routes/__tests__/joined-groups-filter.test.ts'` ⇒ FAIL.
3. نفّذ `isJoinedGroupEntity` + `extractJoinedGroups` (deep-walk بنمط `extractManagedPages`).
4. أعد التشغيل ⇒ PASS. ثم `npm run build` (الاختبارات داخل برنامج tsc).

### Task 3 — استبدال جسم `/list-groups` بالمسار A + pagination
**ملفات:** تعديل `extraction-service/src/routes/list-groups.ts`
1. `page.route` قبل أي `goto` (الترتيب حاسم).
2. تنقّل واحد إلى `/groups/joins/?ordering=viewer_added` (نقلل عدد التنقلات — التنقلات المتكررة = سبب أول لتسجيل خروج قسري).
3. deep-walk للردود عبر `extractJoinedGroups`.
4. حلقة `replayWithCursor` حتى `has_next_page = false` أو حد أمان `GROUPS_LIST_MAX_PAGES = 40`،
   مع `waitForTimeout(1200)` بين الصفحات.
5. أرجع `{ groups, total, source, partial }`.
**التحقق:** استدعاء حقيقي على جلسة سليمة، والعدد > 10 ويطابق ما يراه المستخدم في فيسبوك يدوياً.

### Task 4 — صدق الحقول في الواجهة
**ملفات:** `src/pages/dashboard/groups/types.ts`، `MyGroupsTab.tsx`، `src/i18n/locales/ar.json` + `en.json`
1. `can_post: boolean | null`، `privacy: "" | "public" | "private"`، `role: string`.
2. شارة الخصوصية/الدور تُرسم فقط عند وجود قيمة؛ عند `can_post === null` نص "غير معروف" بنقطة رمادية.
3. عند `partial: true` شريط تنبيه: "القائمة قد تكون جزئية — أعد المحاولة".
4. مفاتيح i18n جديدة بنفس شكل النداء (مطبّة معروفة: شكل المفتاح يجب أن يطابق `t()` حرفياً).
**التحقق:** `npm run typecheck` + `npm run build` + فحص RTL بصرياً.

### Task 5 — إصلاح P1 (سجل النشاط)
**ملفات:** `src/pages/dashboard/groups/ProgressDashboard.tsx:116-122`
اقبل `"posted"` و`"ok"` معاً (توافق خلفي مع صفوف يوليو).
**التحقق:** مهمة نشر حقيقية بجروب واحد ⇒ يظهر "تم" بأيقونة نجاح.

### Task 6 — إصلاح P2 (الخيار الوهمي)
**ملفات:** `extraction-service/src/services/publish-worker.ts:109,190`
استخدم `skipOnMissingComposer` فعلاً: إن كان `false` ⇒ `composer_not_found` تُحتسب `fail` مع سبب واضح
بدل skip صامت. + اختبار وحدة في `publish-logic.test.ts` إن نُقل المنطق لدالة نقية.

### Task 7 — إصلاح P3 (استئناف مهام النشر عند البوت)
**ملفات:** `extraction-service/src/routes/publish.ts` (تصدير `resumePublishJobs`) + `index.ts:93-96`
اقرأ صفوف `publish_jobs` بحالة `running` غير المملوكة لهذه العملية ⇒ حوّلها `paused` (لا `failed`،
ولا cleanup شامل — مطبّة `cleanupOrphanedJobs` المعروفة) ثم اسمح بالاستئناف اليدوي.
**التحقق:** أنشئ مهمة، أعد تشغيل الخدمة، تأكد أنها `paused` وأن مهمة جديدة تُقبل.

### Task 8 — إصلاح P4 (اختيار الجلسة)
**ملفات:** `src/pages/dashboard/groups/PublishTab.tsx:14`
اختر أول جلسة `status === "connected"` فقط، وأظهر `FbSessionSelector` عند وجود أكثر من واحدة.

### Task 9 — إثبات نهائي بالأرقام
1. `/list-groups` على جلسة سليمة: العدد، مصدر البيانات، الزمن.
2. مهمة نشر حقيقية على **3 جروبات** (لا واحد): `published/failed/skipped`، والتحقق من ظهور المنشور فعلاً.
3. تنظيف صفوف الاختبار (`update status='canceled'` لا DELETE — مطبّة enum `activity_action`).
4. حذف كل ملفات الـprobe المؤقتة ثم `npm run build` + `npm run typecheck`.

---

## 5. المخاطر والمقايضات
- **الخطر الأول:** قد لا يخدم فيسبوك قائمة الجروبات لأي سطح ويب لهذه الجلسة. Task 1 بوابة قرار
  صريحة لهذا — إن فشل، الحل الصادق هو إبلاغ المستخدم بحد المنصة، لا تلفيق قائمة.
- **تسجيل خروج قسري:** كل context إضافي من نفس الـIP بلا proxy يرفع الخطر. لذلك تنقّل واحد
  في `/list-groups`، وتجنّب تشغيل probes بالتوازي.
- **الـcache في المتصفح:** بعد النشر، Vite assets مخزّنة سنة ⇒ يجب `Ctrl+Shift+R` قبل إعادة الاختبار.
- **Task 6 يغيّر سلوكاً قائماً** (skip → fail): قرار منتج، يحتاج موافقة صريحة.

## 6. أسئلة مفتوحة تحتاج قرارك
1. هل نعرض الجروبات ذات vanity slug؟ (تعمل للنشر لكن لا تعطي id رقمياً).
2. عند فشل المسار A هل نعرض قائمة جزئية بتنبيه، أم لا نعرض شيئاً ونطلب إعادة المحاولة؟
3. Task 6: `composer_not_found` تبقى skip دائماً، أم تصبح fail عند إلغاء الخيار؟
