---
description: "Task list template for feature implementation"
---

# Tasks: استخراج بيانات إنستجرام (Instagram Extraction)

**Input**: Design documents from `/specs/009-instagram-extraction/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: لم تُطلب مهام اختبارات آلية في الـ spec — التحقق عبر `npm run typecheck` + `npm run lint` وسيناريوهات [quickstart.md](./quickstart.md) اليدوية (مهمة Polish الأخيرة).

**Organization**: المهام مجمّعة حسب قصص المستخدم الست لتمكين التنفيذ والاختبار المستقل لكل قصة.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: قابل للتشغيل بالتوازي (ملفات مختلفة، لا اعتماد على مهام غير مكتملة)
- **[Story]**: قصة المستخدم التي تخدمها المهمة (US1..US6)
- كل مهمة تتضمن مسار الملف بدقة

## Path Conventions

بنية الويب الحالية: `extraction-service/src/` (خدمة الاستخراج) + `src/` (الواجهة) + `supabase/migrations/` — انظر Project Structure في [plan.md](./plan.md).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: تهيئة مشتركة قبل أي عمل

- [ ] T001 التحقق من خط الأساس: تشغيل `npm run typecheck` و`npm run lint` في جذر المشروع و`npm run typecheck` داخل `extraction-service/` والتأكد من صفر أخطاء قبل البدء
- [ ] T002 [P] مراجعة `extraction-service/src/services/supabase.ts` و`extraction-service/src/extractors/base.ts` وتوثيق نقاط إعادة الاستخدام (parseCookiesToPlaywright، switchToNextSession، processBatch) كتعليقات مرجعية في `specs/009-instagram-extraction/research.md` (تحديث R1/R6 بالأسطر الفعلية)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: البنية الأساسية التي MUST تكتمل قبل أي قصة مستخدم

**⚠️ CRITICAL**: لا تبدأ أي قصة مستخدم قبل اكتمال هذه المرحلة

- [ ] T003 إنشاء `supabase/migrations/2026081810_ig_extraction.sql`: جدولا `ig_sessions` و`ig_browser_profiles` بكامل الأعمدة والفهارس وسياسات RLS وفق [data-model.md](./data-model.md) + `ALTER TABLE extraction_results ADD COLUMN platform TEXT NOT NULL DEFAULT 'facebook'` مع فهرس `idx_extraction_results_platform`
- [ ] T004 [P] توسيع `extraction-service/src/types.ts`: إضافة أنواع `ig_followers | ig_following | ig_post_commenters | ig_hashtag_posts | ig_profile_info` إلى `ExtractionType` + حقول `username`, `full_name`, `bio_email`, `bio_phone`, `comments_count` إلى `ExtractedMember`
- [ ] T005 [P] إنشاء `extraction-service/src/services/ig-supabase.ts`: `getIgSessionAndCookies` (قراءة ig_sessions + ig_browser_profiles والتحقق من status=connected ووجود sessionid/ds_user_id/csrftoken) + `updateIgSessionStatus` + `storeIgResults` (كتابة extraction_results بـ platform='instagram' وfb_id=username) — يعيد استخدام `parseCookiesToPlaywright` من supabase.ts بتصديره
- [ ] T006 [P] إنشاء `extraction-service/src/services/ig-context-manager.ts`: إنشاء context على instagram.com (UA/viewport/locale مستقل) + حقن الكوكيز + التحقق من عدم التوجيه لـ `/accounts/login` + دعم proxy عبر `IG_PROXY_{SESSION_ID}` المعمم في `extraction-service/src/config.ts` (نمط parseProxyUrl نفسه)
- [ ] T007 [P] إنشاء `extraction-service/src/extractors/ig-base.ts`: `IgBaseExtractor` يرث `BaseExtractor` — pacing 1.5–3 ثوانٍ بين التمريرات، راحة 15 ثانية كل 10 تمريرات، كشف "Action Blocked"/checkpoint (إنهاء الجلسة + switchToNextSession أو إيقاف المهمة paused)، قراءة العدد الإجمالي المرجعي، حساب coverage
- [ ] T008 توسيع `extraction-service/src/routes/extract.ts`: قبول أنواع `ig_*` في zod schema + توجيه الجلسات إلى `ig-supabase`/`ig-context-manager` عند بدء نوع ig (عبر فحص بادئة `ig_`) + إنشاء contexts متوازية لكل session_id وتمرير secondaryPages (نفس نمط fb القائم في السطور 84-90)
- [ ] T009 [P] إنشاء `extraction-service/src/routes/ig-sessions.ts` (هيكل فارغ بمساري `/ig/session-check` و`/ig/sessions/import` مع zod schemas فقط) وتركيبه في `extraction-service/src/index.ts` بجوار بقية الـ routers

**Checkpoint**: البنية جاهزة — يمكن بدء قصص المستخدم بالتوازي

---

## Phase 3: User Story 1 - إضافة جلسة إنستجرام والتحقق منها (Priority: P1) 🎯 MVP

**Goal**: استيراد كوكيز إنستجرام وإنشاء جلسة متصلة تظهر بحالتها واسم حسابها، معزولة تماماً عن جلسات فيسبوك

**Independent Test**: السيناريو 1 من [quickstart.md](./quickstart.md) — استيراد كوكيز صالحة ثم رؤية الحالة "connected" مع اسم الحساب خلال ≤ 60 ثانية (SC-001)

### Implementation for User Story 1

- [ ] T010 [US1] تنفيذ `POST /ig/sessions/import` في `extraction-service/src/routes/ig-sessions.ts`: التحقق من الكوكيز الحاسمة (sessionid + ds_user_id + csrftoken) → INSERT في ig_sessions وig_browser_profiles → فحص فوري عبر context → إرجاع session_id وstatus وig_username (عقد contracts/api.md §2)
- [ ] T011 [US1] تنفيذ `POST /ig/session-check` في `extraction-service/src/routes/ig-sessions.ts`: فتح instagram.com بالكوكيز، قراءة اسم الحساب والصورة من الترويسة، تحديث ig_sessions (status/ig_username/avatar_url/last_checked_at) — عقد contracts/api.md §1
- [ ] T012 [P] [US1] إنشاء `src/hooks/useIgSessions.ts`: قائمة الجلسات (TanStack Query)، استيراد، فحص، حذف soft — بنفس أنماط `src/hooks/useFbSessions.ts`
- [ ] T013 [P] [US1] إنشاء `src/pages/dashboard/IgSessionsPage.tsx`: جدول الجلسات (الحالة الملونة، اسم الحساب، الصورة، آخر فحق)، نموذج استيراد الكوكيز (JSON paste)، زر فحص، زر حذف — مع حالات loading/empty/error كاملة
- [ ] T014 [P] [US1] إضافة المسار في `src/routes/` وعنصر التنقل "جلسات إنستجرام" في `src/config/navigation.ts` (أيقونة إنستجرام)
- [ ] T015 [P] [US1] إضافة كل نصوص US1 الجديدة في `src/i18n/locales/ar.json` و`src/i18n/locales/en.json` (مفاتيح ig_sessions.*)

**Checkpoint**: US1 كاملة وقابلة للاختبار المستقل — MVP قابل للعرض

---

## Phase 4: User Story 2 - استخراج متابعي حساب عام (Priority: P1)

**Goal**: استخراج followers/following لحساب عام بتغطية ≥ 80% مع نسبة تغطية حية وجلسات متعددة بالتوازي

**Independent Test**: السيناريو 2 + 3 من quickstart.md — مهمة على حساب ≤ 10K متابع تحقق ≥ 80% (SC-002) وتظهر خلال ≤ 5 ثوانٍ وتتحدث كل ≤ 15 ثانية (SC-003)، ومهمة بجلستين تعملان معاً بدمج بلا تكرار (SC-010)

### Implementation for User Story 2

- [ ] T016 [US2] إنشاء `extraction-service/src/extractors/ig-followers.ts`: فتح الملف → النقر على عدّاد المتابعين/المتابَعين → التمرير داخل الـ dialog (lazy-load) حتى النفاد أو ceiling أو الحظر → استخراج username/full_name/profile_url/avatar من صفوف القائمة → dedupe → processBatch تدريجياً + قراءة العدد الإجمالي من الرأس وتحديث progress.coverage — وفق R3
- [ ] T017 [US2] تسجيل `ig_followers`/`ig_following` في `createExtractor` بـ `extraction-service/src/extractors/index.ts` + دعم تبديل نوع التاب (followers↔following) من source_url في `extract.ts`
- [ ] T018 [US2] تنفيذ التوزيع الشعاعي للجلسات المتوازية في `ig-followers.ts`: كل جلسة تتمرر بإزاحة مختلفة والدمج عبر dedupe على username، وعند حظر جلسة يُعاد توزيع عملها (استخدام switchToNextSession من IgBase) — R6
- [ ] T019 [P] [US2] إنشاء `src/pages/dashboard/ExtractIgPage.tsx` (v1 يعرض نوع المتابعين فقط): اختيار followers/following، إدخال username، اختيار جلسة أو جلسات متعددة، ceiling، skip_duplicates، زر بدء يفتح POST /extract
- [ ] T020 [P] [US2] إنشاء `src/hooks/useIgExtraction.ts`: إنشاء المهمة + استطلاع حالتها (نفس أنماط `src/hooks/useExtractionJobs.ts`) مع عرض coverage للمتابعين
- [ ] T021 [P] [US2] إضافة مسار صفحة الاستخراج والتنقل والترجمات (ar/en) للمفاتيح ig_extract.*
- [ ] T022 [US2] رفض الحسابات الخاصة برسالة عربية واضحة (FR-010) داخل `ig-followers.ts` قبل بدء التمرير + رسالة اقتراح إضافة جلسة ثانية عند الحظر (نمط fb في FR-014)

**Checkpoint**: US1 + US2 تعملان مستقلتين

---

## Phase 5: User Story 6 - الإثراء التلقائي والعرض الموحد (Priority: P1)

**Goal**: إثراء نتائج IG تلقائياً من Egypt DB بشارة ثقة (bio=مؤكدة، اسم=محتملة) وعرضها في نفس قوائم النتائج/الجهات مع فلتر منصة

**Independent Test**: السيناريو 6 من quickstart.md — الإثراء يبدأ خلال ≤ 30 ثانية من اكتمال مهمة IG (SC-009) والشارة تظهر في الواجهة والتصدير

### Implementation for User Story 6

- [ ] T023 [US6] توسيع `extraction-service/src/services/enrichment-service.ts` بمسار IG: (1) phone/email مستخلصان من bio → مطابقة أعمدة Phone/email في Egypt DB → match_confidence=confirmed؛ (2) وإلا full_name exact على first_name||' '||last_name → match_confidence=probable — كتابة metadata.enrichment/match_confidence/match_method وفق data-model.md — R5
- [ ] T024 [US6] ربط بدء الإثراء التلقائي بمهام ig_* بعد اكتمالها في `extraction-service/src/routes/extract.ts` (نفس نقطة استدعاء إثراء fb الحالية، بشرط type يبدأ بـ ig_)
- [ ] T025 [P] [US6] إضافة فلتر المنصة (الكل/facebook/instagram) إلى صفحة الجهات/النتائج في `src/pages/dashboard/` عبر `src/lib/extraction-repo.ts` (تمرير platform كمعامل استعلام)
- [ ] T026 [P] [US6] إضافة عمودي `Platform` و`Match Confidence` و`Bio Email`/`Bio Phone` إلى تصدير Excel/CSV في `extraction-service/src/routes/extract.ts` (نفس دالة التصدير القائمة)
- [ ] T027 [P] [US6] عرض شارة الثقة (مؤكدة/محتملة) بجانب بيانات الإثراء في نتائج المهمة والجهات + الترجمات ar/en

**Checkpoint**: كل قصص P1 مكتملة (US1, US2, US6)

---

## Phase 6: User Story 3 - استخراج المعلّقين على منشور (Priority: P2)

**Goal**: لصق رابط منشور عام واستخراج كل المعلّقين بنصوص تعليقاتهم وdedupe وعدّاد إعجابات مرجعي

**Independent Test**: السيناريو 4 من quickstart.md — منشور بـ 200 تعليق يُستخرج كاملاً بصحة ≥ 98% (SC-004)

### Implementation for User Story 3

- [ ] T028 [US3] إنشاء `extraction-service/src/extractors/ig-post-comments.ts`: فتح الرابط (p/reel/tv) → تحميل التعليقات و"View more" loop → استخراج username/full_name/profile_url/avatar/comment_text/comment_id + تجميع تعليقات نفس المعلّق (comments_count) + قراءة عدّاد الإعجابات كمرجع — R3
- [ ] T029 [US3] تسجيل `ig_post_commenters` في `extraction-service/src/extractors/index.ts` + التحقق من صيغة الرابط (p/reel/tv فقط) برسالة INVALID_INPUT عربية في `extract.ts`
- [ ] T030 [P] [US3] إضافة نوع "معلّقو منشور" إلى `src/pages/dashboard/ExtractIgPage.tsx` (حقل رابط المنشور) + الترجمات ar/en

**Checkpoint**: US3 تعمل مستقلة بجانب السابقات

---

## Phase 7: User Story 4 - استخراج أصحاب منشورات هاشتاج (Priority: P2)

**Goal**: إدخال هاشتاج واستخراج أصحاب منشوراته مع إعلان صريح بأن النتائج جزئية دائماً

**Independent Test**: السيناريو 5 من quickstart.md — هاشتاج نشط يعيد منشورات وأصحابها مع تنبيه الجزئية الظاهر دائماً (SC-005)

### Implementation for User Story 4

- [ ] T031 [US4] إنشاء `extraction-service/src/extractors/ig-hashtag-posts.ts`: فتح `instagram.com/explore/tags/{tag}/` → التمرير في الـ grid + المودال → استخراج أصحاب المنشورات (dedupe مع عدّاد منشورات لكل صاحب) + post_url/post_shortcode — R3
- [ ] T032 [US4] تنفيذ تنبيه "النتائج جزئية بحكم حدود إنستجرام" يظهر في تفاصيل المهمة وفي أعلى النتائج دوماً: كتابة علامة في progress عند إنشاء مهمة ig_hashtag_posts في `extract.ts` + عرضها في الواجهة
- [ ] T033 [US4] تسجيل النوع + معالجة الهاشتاغ المحظور/الفارغ برسالة صريحة في `extraction-service/src/extractors/ig-hashtag-posts.ts`
- [ ] T034 [P] [US4] إضافة نوع "هاشتاج" إلى ExtractIgPage + الترجمات ar/en

**Checkpoint**: US4 تعمل مستقلة

---

## Phase 8: User Story 5 - بيانات الملف الشخصي (Priority: P3)

**Goal**: إدخال username أو قائمة واستخراج بيانات الملف العامة مع استخلاص email/phone من الـ bio

**Independent Test**: السيناريو 6 (الجزء الأول) — bio يحوي بريداً يُستخلص صحيحاً بنسبة ≥ 95% (SC-006)

### Implementation for User Story 5

- [ ] T035 [US5] إنشاء `extraction-service/src/extractors/ig-profile-info.ts`: فتح الملف وقراءة bio/followers_count/posts_count/external_url/is_verified + استخلاص bio_email/bio_phone بـ regex موحد (تطبيع الأرقام المصرية: مسافات/شرطات/+20) — R3
- [ ] T036 [US5] دعم قائمة usernames (فصل بفواصل/أسطر) في `extract.ts`: كل username سطر نتيجة مستقل، وusername فاشل (محذوف/خاص) لا يوقف البقية (رسالة خطأ خاصة به)
- [ ] T037 [P] [US5] إضافة نوع "بيانات ملف" إلى ExtractIgPage (حقل نص متعدد الأسطر) + الترجمات ar/en

**Checkpoint**: كل القصص تعمل

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: تحسينات عابرة للقصص وتحقق نهائي

- [ ] T038 تشغيل فحوص البناء: `npm run typecheck` و`npm run lint` في الجذر و`npm run typecheck` في `extraction-service/` + `npm run build` — صفر أخطاء
- [ ] T039 فحوص عدم الكسر (regression): تشغيل استخراج fb واحد (pages أو post_comments) والتأكد أن نتائجه platform=facebook تلقائياً وأن صفحة الجهات بلا فلتر تعرض المزيج
- [ ] T040 تنفيذ سيناريوهات [quickstart.md](./quickstart.md) السبعة كاملة وتوثيق النتائج
- [ ] T041 [P] مراجعة RTL كاملة للصفحتين الجديدتين (ar أساسي) والتبديل ar↔en دون نصوص خام (SC-008: لا خيار مستحيل في الواجهة)
- [ ] T042 [P] مراجعة أمنية: تأكيد سياسات RLS على ig_sessions/ig_browser_profiles (select/insert/update/delete بـ auth.uid()=user_id) وعدم تسريب كوكيز في السجلات أو رسائل الأخطاء

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: بلا اعتمادات — يبدأ فوراً
- **Foundational (Phase 2)**: يعتمد على Phase 1 — **يحجب كل القصص** (T003-T009)
- **قصص المستخدم (Phases 3-8)**: كلها تعتمد على اكتمال Phase 2
- **Polish (Phase 9)**: يعتمد على اكتمال القصص المطلوب تسليمها

### User Story Dependencies

- **US1 (جلسات)**: بعد Phase 2 مباشرة — لا تعتمد على أي قصة
- **US2 (متابعون)**: بعد Phase 2 — تستخدم جلسات US1 تشغيلياً لكن تُختبر مستقلة بكوكيز جاهزة
- **US6 (إثراء وعرض)**: بعد اكتمال US2 منطقياً (تحتاج نتائج IG موجودة للاختبار) — مهامها التقنية مستقلة عن US3/US4/US5
- **US3/US4/US5**: بعد Phase 2 — مستقلة تماماً عن بعضها وعن US6
- الترتيب المتسلسل المقترح: US1 → US2 → US6 → US3 → US4 → US5 (أولوية P1 ثم P2 ثم P3)

### Within Each User Story

- المستخرِج (extractor) قبل التسجيل في index.ts قبل الواجهة
- الواجهة والترجمات آخر ما يُنجز في كل قصة
- checkpoint في نهاية كل قصة = اختبار مستقل عبر quickstart.md

### Parallel Opportunities

- Phase 2: T004/T005/T006/T007/T009 كلها [P] (ملفات مختلفة) بعد T003
- داخل كل قصة: مهام الواجهة [P] (hooks/صفحات/ترجمات/تنقل) بالتوازي بعد اكتمال مهام الخدمة
- قصص US3 وUS4 وUS5 يمكن تشغيلها بالتوازي بأكملها (ملفات مستخرِجات وواجهة مختلفة) بعد Phase 2 + US1
- T025/T026/T027 في US6 متوازية، وT041/T042 في Polish متوازية

---

## Parallel Example: User Story 2

```bash
# بعد اكتمال T016-T018 (خدمة الاستخراج)، أطلق مهام الواجهة معاً:
Task: T019 "إنشاء src/pages/dashboard/ExtractIgPage.tsx"
Task: T020 "إنشاء src/hooks/useIgExtraction.ts"
Task: T021 "المسار والتنقل والترجمات"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. إكمال Phase 1 + Phase 2
2. إكمال Phase 3 (US1)
3. **توقف واختبار**: استيراد جلسة ورؤيتها connected (السيناريو 1)
4. عرض/نشر إن كان جاهزاً

### Incremental Delivery

1. Setup + Foundational → الأساس جاهز
2. US1 → اختبار مستقل → **MVP**
3. US2 → اختبار (سيناريو 2+3) → التسليم الأول صاحب القيمة التسويقية
4. US6 → اختبار (سيناريو 6) → القيمة الكاملة لـ P1
5. US3 → US4 → US5 → كل واحدة تضيف نوع استخراج دون كسر السابق
6. Polish النهائي (T038-T042)

### Parallel Team Strategy

- مطور واحد: تسلسل القصص بترتيب الأولوية
- فريق: بعد Phase 2 → مطور A على US2، مطور B على US3+US4، مطور C على US6+US5 — التقاء وحيد في تعديل `extract.ts` (تنسيق بالتناوب)

---

## Notes

- [P] = ملفات مختلفة بلا اعتمادات
- لا مهام اختبارات آلية (غير مطلوبة في spec) — التحقق اليدوي عبر quickstart.md مهمة T040
- تعديل `extract.ts` مشترك بين US2/US3/US4/US5 — يُنجز تدريجياً في T008 (الهيكل) ثم بكل قصة إضافتها فقط
- ارتكاز كل مهام الخدمة على قرارات research.md المرقمة (R1..R10) — راجعها قبل أي مهمة
- Commit بعد كل مهمة أو مجموعة منطقية، ووقف عند كل checkpoint للتحقق المستقل
