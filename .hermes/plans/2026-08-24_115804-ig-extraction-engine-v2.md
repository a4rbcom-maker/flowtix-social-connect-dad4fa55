# Instagram Extraction Engine v2 — خطة تنفيذ كاملة Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** تشغيل كل ميزات قائمة إنستجرام (7 أنواع استخراج) على معمارية موحّدة واحدة، مع إثبات رقمي واستخراج بأعداد كبيرة (آلاف/جلسة).

**Architecture:** محرك واحد `IgExtractionEngine` يملك الجلسات/الترقيم/الCheckpoint/الـ heartbeat، وفوقه Adapters خفيفة لكل نوع استخراج تعيد استخدام 3 قدرات مشتركة فقط (ProfileList و PagedFeed و ProfileInfo). الإنتاجية عبر GraphQL Interceptor (نفس نمط الـ FB المُجرّب) بدل DOM-scroll البطيء، مع DOM-scroll كـ fallback تلقائي.

**Tech Stack:** Express + Playwright (موجود) + zod + Supabase (migration واحدة) + node:test (موجود).

---

## Current context / الحالة الحالية (audit مكتمل 2026-08-24)

### ما يعمل الآن (مُثبت live على prod)
- `ig_followers` / `ig_following`: DOM-scroll عبر `IgFollowersExtractor` فوق `IgExtractionEngine` (heartbeat/rate/cursor). مُثبت: 412 فريد @tourismegypt، 76–129/د، 0 تكرارات، enrichment بدون تجميد (worker)، export gate يعمل (CSV/JSON/XLSX). commit `3d4aa57`.
- Sessions: استيراد كوكيز + فحص فوري + تدوير كوكيز (ig-context-manager).
- Dedup: `user_id + platform` + unique index جزئي (migration 2026082311 مطبقة live).
- uncommitted في working tree: إصلاح race الـ `currentScopeUserId` (تم تمريره عبر `ctx.userId`) + perf (block-check كل 3 تمريرات، wheel 600px/400ms) + إصلاح resume catch-up (budget + عدم احتساب empty أثناء اللحاق) + UI rate/sessions/activity + ترجمات. **tsc نظيف + 44/44 اختبار** — جاهزة للـ commit أولًا.

### ميزات قائمة إنستجرام في الواجهة — الحالة
| # | الميزة | الحالة | السبب |
|---|---|---|---|
| 1 | متابعي حساب (ig_followers) | ✅ يعمل (DOM) | — |
| 2 | متابَعي حساب (ig_following) | ✅ يعمل (DOM) | — |
| 3 | تعليقات منشور → مستخدمون (ig_post_commenters) | ❌ مفقود | أُزيل من الـ schema (RC4) — لم يوجد له extractor أصلًا |
| 4 | تفاعلات منشور (ig_post_engagers) | ❌ غير موجود | لم يُبنَ قط |
| 5 | منشورات هاشتاج (ig_hashtag_posts) | ❌ مفقود | أُزيل (RC4) |
| 6 | بيانات حساب مفصلة (ig_profile_info) | ❌ مفقود | أُزيل (RC4) |
| 7 | بحث باسم مستخدم (ig_user_search) | ❌ غير موجود | لم يُبنَ قط |

### المشاكل الجوهرية المفتوحة
- **P1 السرعة**: DOM-scroll = ~2.2s/تمريرة (~20 صف) → سقف عملي ~130/د/جلسة. الحسابات الكبيرة (100k+) تحتاج أيام. الأعداد الكبيرة تتطلب GraphQL pagination.
- **P2 الحسابات العملاقة**: "Only X can see all followers" — قيد منصة (غير قابل للحل تقنيًا للقائمة الكاملة؛ يُعالج بتوسيع المصادر: منشورات/تعليقات/هاشتاج).
- **P3 DOM هش**: selectors تنكسر مع كل تحديث IG (انكسرت مرة بالفعل — RC6). GraphQL (doc_id مستقر نسبيًا) + DOM fallback.
- **P4 followers_list only**: لا يوجد أي مصدر ثانٍ اليوم — مهمة واحدة تنتهي بنفاد القائمة، دون Adaptive fallback.

### قيود صارمة (من المالك)
- لا تتجاوز صلاحيات/سياسات Instagram — استخدام ما يظهره الويب للجلسة المسجلة فقط.
- لا تكسر FB/Groups/Pages الموجودة. لا تغيير business rules بلا سبب.
- الاستخراج والإثراء pipeline منفصلان؛ لا export قبل اكتمال enrichment (موجود — لا يُمس).
- UI عربي أولًا RTL، ولا يظهر mechanics داخلية للمستخدم النهائي.

---

## Proposed Approach — المعمارية الإبداعية

### الفكرة المركزية: "Capability-based Adapters"
بدل 7 extractors منفصلة، **3 قدرات (Capabilities) فقط** تغطي كل الأنواع السبعة:

```
IgExtractionEngine (موجود — يُوسَّع)
├── SessionManager (موجود: health/cooldown/lock + تدوير كوكيز)
├── SourcePlanner (جديد: يبني خطة مصادر لكل نوع مهمة — Adaptive)
├── IgGraphQLClient (جديد: التقاط doc_id من صفحة حية + replay بـ cursor — نمط FB المُجرّب graphql-interceptor.ts)
├── Capabilities:
│   ├── ProfileListCap    → followers/following (GraphQL أولاً، DOM fallback)
│   ├── PagedFeedCap      → hashtag posts / post likes+comments (كل feed مرقّم صفحة بصفحة)
│   └── ProfileInfoCap    → تفاصيل حساب واحد (bio/عدادات/هوية)
└── Adapters (خفيفة: تُركّب Capabilities وتحدد الـ schema):
    ig_followers, ig_following, ig_post_commenters,
    ig_post_engagers, ig_hashtag_posts, ig_profile_info, ig_user_search
```

**لماذا هذا مناسب هنا**: نفس الـ DOM dialog يخدم followers/following؛ نفس آلية "feed + زر عرض المزيد" تخدم الهاشتاج والتعليقات والتفاعلات (يختلف الرابط فقط)؛ وكلها تحتاج نفس الترقيم/الحظر/الجلسة. الـ GraphQL يلتقط من أول تحميل صفحة ثم يُعاد تشغيله بسرعة كاملة دون DOM thrashing.

**Adaptive Sources (المطلوب 5)**: `SourcePlanner` يبني قائمة مصادر مرتبة لكل نوع (مثال ig_followers على حساب ضخم: `followers_list` → إن انقطعت (`Only X can see`) ينتقل لـ `profile_posts_likers` → `profile_posts_commenters`). كل مصدر يُقاس (rate/min من RateMeter الموجود) ويُترك عند `low_yield` — نفس منطق `decideNextSource` المُجرّب في orchestrator-core (يُعاد استخدامه لا إعادة اختراعه).

**Multi-session throughput**: مهام N ≥ 100k توزّع الجلسات على "نوافذ" (offsets) مختلفة من نفس القائمة عبر GraphQL cursors — كل جلسة تبدأ من صفحة مختلفة ثم تلتف. (بلا بروكسي: حد 2 جلسة كما هو.)

### ملاحظات إبداعية إضافية
- **GraphQL capture-warmup**: قبل أي adapter، يزور المحرك بروفایل الهدف مرة واحدة ويلتقط كل doc_ids الجاهزة (followers/following/posts) — استهلاك واحد يخدم كل المصادر.
- **Resume نقطي**: checkpoint = (source, cursor, lastUsername, seen-count) — موجود جزئيًا؛ يُعمم على كل المصادر.
- **Result routing موحد**: `IgResultRouter` يطبّع كل صف لأجل `extraction_results` (fb_id=username أو pk، platform=instagram, user_id=ctx) — نقطة واحدة للـ dedup/index/upsert.

---

## Execution Plan — مراحل مرتبة

> ترتيب التنفيذ: تثبيت الموجود → البنية المشتركة → الأنواع بالأولوية (الأسرع إثباتًا أولًا) → adaptive → إثبات الأعداد الكبيرة. كل Task = 2–5 دقائق، TDD حيث ينطبق.

### Phase 0 — تثبيت الموجود (prerequisite)
- **Task 0.1**: commit التغييرات الـ uncommitted (race fix + perf + resume catch-up + UI rate) — message: `fix: IG result ownership race + scroll perf + resume catch-up`.
- **Task 0.2**: تشغيل `npx tsc --noEmit` + `npx tsx --test src/services/__tests__/*.test.ts` (متوقع 44/44) — لا نشر قبل الاختبار الكامل في Phase 8.

### Phase 1 — Database migration (نوع واحد لكل قيمة enum)
- **Task 1.1**: ملف `supabase/migrations/2026082410_ig_types_full.sql`:
  ```sql
  ALTER TYPE public.extraction_type ADD VALUE IF NOT EXISTS 'ig_post_commenters' BEFORE 'custom';
  ALTER TYPE public.extraction_type ADD VALUE IF NOT EXISTS 'ig_post_engagers' BEFORE 'custom';
  ALTER TYPE public.extraction_type ADD VALUE IF NOT EXISTS 'ig_hashtag_posts' BEFORE 'custom';
  ALTER TYPE public.extraction_type ADD VALUE IF NOT EXISTS 'ig_profile_info' BEFORE 'custom';
  ALTER TYPE public.extraction_type ADD VALUE IF NOT EXISTS 'ig_user_search' BEFORE 'custom';
  NOTIFY pgrst, 'reload schema';
  ```
  (تُطبَّق statement-by-statement عبر Management API —ADD VALUE لا تعمل داخل txn.)
- **Task 1.2**: تطبيقها live والتحقق: `select unnest(enum_range(NULL::extraction_type))` يحوي الـ 7 قيم ig_*.
- **Task 1.3**: التحقق أن الوظائف التشغيلية (`getJobsMissingEnrichment` وغيرها) لا تكسرها القيم الجديدة (قراءة الكود فقط — لا تعديل).

### Phase 2 — GraphQL client (قلب الإنتاجية)
- **Task 2.1**: test أولًا `src/services/__tests__/ig-graphql-client.test.ts` — parsing نموذج استجابة followers (edge_users → username/full_name/pk) و end_cursor/has_next. (HTML fixtures من debug-ig-dialog sessions.)
- **Task 2.2**: `src/services/ig-graphql-client.ts`: attach(page) يلتقط POSTs `/api/graphql` على instagram.com (doc_id+variables+headers)، ثم `fetchPage(docId, variables)` عبر `page.evaluate(fetch)` بجلسة الصفحة الحية (لا request خارجي — نفس الجلسة/الكوكيز/البصمة).
  - إدخال: الملتقط فقط؛ لا تخمين doc_ids.
  - الحد: 1 طلب/1.2–2s jitter؛ 429/login-redirect → إشارة block للمحرك.
- **Task 2.3**: اختبار live قصير (سكربت debug): التقاط followers doc_id لحساب صغير وجلب 2 صفحات (متوقع ~40+ صفحة/طلب).
- **Task 2.4**: tsc + tests.

### Phase 3 — Capabilities (القدرات الثلاث)
- **Task 3.1** `src/services/ig-caps/profile-list-cap.ts`:
  - test: دمج صفحات GraphQL → unique map، وانتقال DOM-fallback عند فشل capture (mock).
  - تنفيذ: `run({ username, tab, cursor })` → GraphQL أولًا؛ عند أي فشل → استدعاء مسار DOM الحالي (`IgFollowersExtractor` scroll-loop يُستخرج إلى دالة قابلة لإعادة الاستخدام).
- **Task 3.2** `src/services/ig-caps/paged-feed-cap.ts`:
  - يخدم: hashtag posts، post comments، post engagers (likers).
  - آلية: فتح URL (هاشتاج/منشور) → التقاط cursor من DOM/GraphQL → "Load more" loop بنفس الترقيم.
  - test: نموذج HTML fixture لصفحة منشور مع تعليقات → parser يستخرج usernames.
- **Task 3.3** `src/services/ig-caps/profile-info-cap.ts`: زيارة بروفايل → header counters (الشكلين القديم/الجديد RC6) + bio +外部 id. test بـ fixtures.
- **Task 3.4**: tsc + tests.

### Phase 4 — Adapters + types (الأنواع السبعة)
- **Task 4.1**: `src/types.ts` + `routes/extract.ts` zod enum: إعادة القيم الخمس المحذوفة (post_commenters/post_engagers/hashtag_posts/profile_info/user_search).
- **Task 4.2**: `src/lib/extraction/types.ts` (frontend): إضافة نفس القيم لـ `ExtractionType` + `SOURCE_TO_DB_TYPE`.
- **Task 4.4**: `extractors/ig-followers.ts` → إعادة تسمية منطقية `IgProfileListExtractor` (followers/following) فوق ProfileListCap (يفضَّل إبقاء الملف ومساره — minimum change).
- **Task 4.5**: `extractors/ig-hashtag-posts.ts` فوق PagedFeedCap (posts → مؤلفون + likers لاحقًا).
- **Task 4.6**: `extractors/ig-post-engagers.ts` فوق PagedFeedCap (تعليقات + likers → مستخدمون).
- **Task 4.7**: `extractors/ig-profile-info.ts` فوق ProfileInfoCap (نتيجة واحدة مفصلة).
- **Task 4.8**: `extractors/ig-user-search.ts` (بحث top-accounts عبر DOM search lap — أعلى تنفيذًا، يبدأ Task 4.1).
- **Task 4.9**: `extractors/index.ts`: createExtractor switch للحالات الجديدة.
- **Task 4.10**: tsc + tests (لا `Unsupported extraction type` لأي قيمة).

### Phase 5 — SourcePlanner (Adaptive)
- **Task 5.1**: `src/services/ig-source-planner.ts` + test خالص: مدخلات (type, followersCount, isGiant) → خطة مصادر مرتبة. مثال:
  - giant (قائمة مقيدة): [`profile_posts_likers`, `profile_posts_commenters`, `followers_list`] — القائمة آخرًا (سريعة النفاد).
  - normal: [`followers_list`] فقط.
  - hashtag: [`hashtag_recent`, `hashtag_top`].
- **Task 5.2**: دمج `decideNextSource` (orchestrator-core) في المحرك — انتقال عند `low_yield/stagnated` (نفس عتبات FB: minRate 5/min بعد 120s).
- **Task 5.3**: heartbeat يعرض `current_source` + `next_source` (موجود جزئيًا في IgHeartbeat).
- **Task 5.4**: test + tsc.

### Phase 6 — Multi-session throughput
- **Task 6.1**: عند N جلسات: توزيع GraphQL offsets (كل جلسة صفحة مختلفة) على ProfileListCap فقط؛ حلقة DOM تبقى أحادية.
- **Task 6.2**: test وحدة: خطة توزيع 3 جلسات × 4 صفحات → لا تداخل.
- **Task 6.3**: دليل تشغيلي: MAX_SESSIONS_PER_JOB يبقى 5، بلا بروكسي → الالتزام 2 (تحذير موجود بالفعل في extract.ts).

### Phase 7 — UI (عرض بلا mechanics داخلية)
- **Task 7.1**: ExtractIgPage: بطاقات الأنواع السبعة (أيقونات/وصف ar/en) — إعادة استخدام نمط sourceOptions الحالي.
- **Task 7.2**: حقول الإدخال حسب النوع (username / post URL / hashtag / نص بحث) — تبديل شرطي.
- **Task 7.3**: شاشة التشغيل: النتائج/السرعة/الجلسات/آخر نشاط (موجودة) + progress حقيقي بالنسبة للمصدر النشط (لا يظهر أسماء مصادر داخلية — فقط "جاري استخراج X").
- **Task 7.4**: الترجمات ar/en لكل النصوص الجديدة (ig_extract.types.*).
- **Task 7.5**: `npm run typecheck` + فحص RTL بصري (logical properties فقط — لا rtl: variant).

### Phase 8 — إثبات وإصدار (الإثبات المطلوب)
- **Task 8.1**: تشغيل محلي لكل نوع على أهداف حقيقية (جدول إثبات أدناه).
- **Task 8.2**: اختبار stress: ig_followers على حساب 50k+ → إثبات ≥1000 نتيجة فريدة مع rate/min الناتج.
- **Task 8.8**: حذف مهام الاختبار من DB + `git push` + متابعة Actions run حتى success + smoke على prod (health + job واحد لكل نوع).
- **Task 8.9**: تقرير نهائي قبل/بعد بالأرقام.

### جدول الإثبات (لكل نوع)
| النوع | هدف الاختبار | معيار النجاح |
|---|---|---|
| ig_followers | حساب 50k+ (مصر) | ≥1000 فريد، rate GraphQL ≥300/min (هدف)، 0 dupes |
| ig_following | حساب متوسط | ≥100 فريد، 0 dupes |
| ig_post_commenters | ريلز/منشور عربي شعبي | ≥200 مستخدم، 0 dupes |
| ig_post_engagers | نفس المنشور | ≥300 مستخدم (likers+commenters) |
| ig_hashtag_posts | #كرة_القدم_مصر أو #مصر | ≥150 منشورًا (pk) + مؤلفوها |
| ig_profile_info | @tourismegypt | سجل واحد: أعداد/bio/رابط |
| ig_user_search | "أحمد" | ≥20 حسابًا مطابقًا |

**Stalling/Resume proof**: قتل الخدمة منتصف مهمة GraphQL → استئناف → 0 dupes (نفس منهجية الإثبات السابقة).

---

## Files likely to change

**Create:**
- `extraction-service/src/services/ig-graphql-client.ts`
- `extraction-service/src/services/ig-source-planner.ts`
- `extraction-service/src/services/ig-caps/profile-list-cap.ts`
- `extraction-service/src/services/ig-caps/paged-feed-cap.ts`
- `extraction-service/src/services/ig-caps/profile-info-cap.ts`
- `extraction-service/src/extractors/ig-hashtag-posts.ts`
- `extraction-service/src/extractors/ig-post-engagers.ts`
- `extraction-service/src/extractors/ig-profile-info.ts`
- `extraction-service/src/extractors/ig-user-search.ts`
- `extraction-service/src/services/__tests__/ig-graphql-client.test.ts`
- `extraction-service/src/services/__tests__/ig-source-planner.test.ts`
- `supabase/migrations/2026082410_ig_types_full.sql`

**Modify:**
- `extraction-service/src/types.ts` (قيم enum الجديدة)
- `extraction-service/src/routes/extract.ts` (zod enum + validation)
- `extraction-service/src/extractors/index.ts` (switch)
- `extraction-service/src/extractors/ig-followers.ts` (فصل DOM-loop لإعادة الاستخدام)
- `extraction-service/src/services/ig-engine.ts` (ربط planner + sources متعددة)
- `src/lib/extraction/types.ts`, `src/pages/dashboard/extraction/ExtractIgPage.tsx`, `src/i18n/locales/{ar,en}.json`

**لا يُمس:** كل ملفات FB (group-members/page-followers/post-*)، enrichment gates، export rules، RLS.

## Tests / validation
- `cd extraction-service && npx tsc --noEmit -p tsconfig.json`
- `npx tsx --test src/services/__tests__/*.test.ts` (متوقع 44+ الجديدة)
- `npm run typecheck` (frontend)
- Live proof حسب جدول Phase 8 (كل نوع: نتائج/فريدة/rate/مدة/dupes/resume/enrichment/export).

## Risks & mitigations
| خطر | أخفافه |
|---|---|
| doc_id يتغير / يفشل capture | DOM fallback تلقائي (نفس مسار اليوم المُثبت)؛ الـ capture لكل جلسة على حدة |
| حدود Instagram على GraphQL | jitter 1.2–2s، حد طلبات/دقيقة لكل جلسة، block → تدوير جلسة (منقول من FB المُجرّب) |
| تعليقات/تفاعلات على المنشورات العملاقة مقيدة | ضمن سياسات المنصة — نستخرج المتاح فقط وندوّن stop_reason |
| adaptive يزيد التعقيد | planner خالص (pure) قابل للاختبار، عتبات نفس FB |
| تعدد الجلسات بلا بروكسي | يبقى الحد 2 (تحذير IP مشترك موجود) |
| migration على prod | ADD VALUE فقط — إضافية لا تمس القيم الحالية (نفس نمط 2026082311 الناجح) |

## Open questions (قرارات المالك قبل Phase 6)
1. هل نفعّل multi-session offsets افتراضيًا أم لمهام ≥10k فقط؟ (توصيتي: ≥10k فقط)
2. ig_profile_info: نتيجة مفردة تفصيلية (سلوك جديد في ResultsPage) أم صف واحد في نفس الجدول؟ (توصيتي: صف واحد — لا UI جديدة)
3. هل نضيف ig_post_engagers للـ enum (نوع جديد كليًا) — أم نكتفي بالخمسة الأصلية؟ (توصيتي: نضيفه — قيمة الطلب صريحة "كل الخصائص")
