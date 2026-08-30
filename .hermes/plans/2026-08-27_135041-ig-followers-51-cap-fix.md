# IG Followers Extraction Fix Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** رفع تغطية استخراج متابعي Instagram من ~0.18% (51 من 27.8K) إلى ≥70% من المتاح فعلياً، بآلية Dynamic + Paginated + Reliable + Resumable، مع إثبات بالأرقام.

**Architecture:** المسار الأساسي pagination عبر friendships API داخل صفحة الجلسة، مع DOM كـ fallback فقط، وتدوير جلسات عند الركود، وحالات توقف مُعلنة (paused/cursor) بدل إنهاء صامت بـ completed.

**Tech Stack:** extraction-service (Express + Playwright + tsx), Supabase REST, تكملة الموجود بدون مساس بمسارات Facebook.

---

## الأدلة المجمّعة (من الفحص الفعلي)

| الدليل | القيمة |
|---|---|
| المهمة | `52a3c0d1` — @yolya_qa، ig_followers |
| العدد في الرأس | 27,800 |
| المخزّن فعلياً في DB | **51 صف** (50 دفعة واحدة + 1 دفعة أخيرة) |
| مدة التشغيل | **48 ثانية** (10:08:34 → 10:09:22 UTC) |
| checkpoint المحفوظ | يقول `extracted: 100` — لا يطابق المخزّن 51 |
| شكل الـ cursor | DOM-shape `{lastUsername, rowsInDialog:50}` وليس API-shape `{api:true,maxId}` |
| سجلات الإنتاج | غير موجودة محلياً — الخدمة تعمل على VPS؛ السجلات هناك |

حالة git: التعديلات المحلية غير المرفوعة تمس FB فقط (post-comments/reactions/graphql-interceptor/base.ts) — `ig-followers.ts` المطوّر = المعروض على الإنتاج.

## Root Cause (مرتّب بالثقة)

1. **فشل صامت لمسار API في أول ثوانٍ**: إمّا أن التقاط أول response لـ `/api/v1/friendships/<id>/followers/` فشل (إعادة رسم للـ dialog بين الـ open والـ listen)، أو أن IG أعاد أول صفحة بلا `next_max_id` (soft-block على الجلسة). الكود الحالي: عند عدم وجود cursor و<100 مستخدم → `return null` → يسقط إلى DOM على نفس الـ dialog بلا أي محاولة API أخرى لاحقاً (ig-followers.ts:361-395, 443-454).
2. **DOM ثم انتهى بسرعة**: أول pass جمع ~50 صفاً، الـ scrolls التالية جاءت +0 (الـ dialog لا ينمو — إشارة throttle جديدة على الجلسة)، فدخل `MAX_EMPTY_SCROLLS=6` وانكسر خلال ثوانٍ (ig-followers.ts:124,212-215). النتيجة: إنهاء `completed` بتغطية 0.18% بلا سبب مسجّل.
3. **عدم اتساق عدّادات**: `engine.unique_extracted` يعلن 100 بينما المخزّن 51 (خلط بين حصاد داخل الذاكرة والـ flush + منطق `previouslyStored()`)، ولا يوجد `stop_reason` في progress — لذلك ظهر فشل استخراج كنجاح هادئ.
4. **لا تدوير جلسات عند الركود**: الجلسة الثانية أبقى خاملة (`secondaryPages` لا تدور الاستخراج)، والتدوير يُفعَّل فقط عند block صريح — الركود الصامت لا يعده المهندس فشلاً.

## Task 1: توحيد العدّاد + تسجيل سبب التوقف (telemetry integrity)

**Files:** Modify `extraction-service/src/extractors/ig-followers.ts`, `extraction-service/src/services/ig-engine.ts`

- اعتمد مصدر حقيقة واحد: عدد الـ Map الفعلي المُخزّن (`flushedCount + pending`)، لا `unique_extracted`.
- أضف `IgStopReason`: `api_cursor_exhausted | dom_dialog_exhausted | session_stagnation_rotated | all_sessions_stagnant | max_results | canceled`.
- عند كل مسار خروج: اكتب في progress `stop_reason` + `harvested`(في الذاكرة) + `stored`(DB) — داخلي فقط، لا يظهر للمستخدم النهائي.
- **اختبار**: `extraction-service/src/services/__tests__/ig-stop-reason.test.ts` — دوال حساب تغطية وأسباب خروج نقية؛ `npx tsx --test src/services/__tests__/ig-stop-reason.test.ts`.

## Task 2: ترسيخ مسار API (Fast path) — Retry + إعادة probing

**Files:** Modify `extraction-service/src/extractors/ig-followers.ts`, `extraction-service/src/services/ig-friendships-client.ts`

1. **تقاطع موثوق لأول استجابة**: قبل `openDialog()` سجّل المستمع، وبعده انتظر الالتقاط حتى 8s؛ عند فشل إعادة افتح dialog حتى 3 مرات قبل الاتجاه لـ DOM.
2. **تصعيد للأولوية**: لو التقِط نجح لكن بدون `next_max_id`، أعد `fetchPage(null)` مرتين (بفاصل 5s) للتأكد قبل كتابة "exhausted". لو الجلسة ثrottle، احترمها لكن لا تنهئ — انزل DOM وحدّد `stop_reason=throttled_pending_retry`.
3. **كثافة pagination**: قلّل `minGapMs` من 900 إلى 600–750ms عشوائي ±15%، وراحة كل 40 صفحة كما هي؛ الراحة الوحيدة التي لا تلمسها هي pacing الجلسة.
4. **تصحيح نقطة البيانات المكررة**: في probed-page فرع (سطر 382) استخدم عدد الفريد الجديد فعلياً وليس `probe.users.length`.

## Task 3: دوم fallback أكثر صبراً (بدون ما يفسد الاستقرار)

**Files:** Modify `extraction-service/src/extractors/ig-followers.ts`

- `MAX_EMPTY_SCROLLS` يصبح دورتين متتاليتين: 6 empty → راحة 20–30s + محاولة re-open dialog (وإعادة probe API واحدة) → دورة ثانية 6 empty → عندها فقط `dom_dialog_exhausted`.
- عندما تكون هناك جلسات ثانوية حية وعامة فارغة كلياً → بدّل جلسة (Task 4) قبل إعلان الانتهاء.

## Task 4: تدوير جلسات عند الركود + multi-session حقيقي

**Files:** Modify `extraction-service/src/extractors/ig-followers.ts`, `extraction-service/src/extractors/base.ts`

- إذا جلستَ أساسية خلفت 0 جديد عبر دورتي exhaustion وكانت `secondarySessionPages.length > 0`: صنّفها `degraded` عبر `recordSessionFailure` ونفّذ `switchToNextSession()` (يشمل فحص `isClosed()` الحالي)، ثم `navigateToProfile` + reopen.
- عند كل جلسة: سجّل `stop_reason per session` في heartbeat.session_health.
- عندما كل الجلسات `unavailable/stagnant` → لا تختم بـ `completed` — أرجع `nextCursor` (paused مع cursor) كما تخدم AGENTS.md.
- ممنوع المساس بـ switchToNextSession للفيسبوك — التغيير محدود ضمن كود Instagram.

## Task 5: بوابة الاكتمال (Coverage Gate) + الاستئناف

**Files:** Modify `extraction-service/src/extractors/ig-followers.ts`, `extraction-service/src/routes/extract.ts`, i18n ar/en

- متغير بيئة `IG_MIN_COVERAGE_TO_COMPLETE` (افتراضي 70). عند الخروج:
  - التغطية < الحد لكن يوجد مؤشر استمرار حقيقي (آخر صفحة فيها rows أو rotate ممكن لاحقاً) → أرجع `done:false, nextCursor` (المهمة `paused` قابلة للاستئناف تلقائياً عبر queue الموجود).
  - `platform_limit` (account خاص / "Only X can see followers") أو استنفاد واقعي بعد كل الجلسات والأدوات → `completed` مع `stop_reason` داخلي ورسالة سرعة مفهومة.
- رسالة المستخدم النهائية تبقى بسيطة (progress/coverage فقط) — تفاصيل الآلية داخل logs وinternal progress fields.

## Task 6: إثبات بأرقام على @yolya_qa (27.8K)

1. تأكيد أن آخر commit على origin/main هو المنشور (`gh run list --repo a4rbcom-maker/flowtix-social-connect-dad4fa55` أو GitHub API) قبل الاختبار.
2. شغّل خدمة محلية على PORT=3200 (وليس 3100) مع نفس .env وقاعدة الإنتاج؟ ❌ لا — البيئة الاختبارية يجب أن تشير إلى DB staging/local إن وُجد لتجنب تلويث نتائج المستخدم؛ وإلا فإن الحالة الحالية تُثبت على الإنتاج مباشرة بشهادة `session_id` من `connected`.
3. POST `/extract` بواجهة الإنتاج أو الجلسة المحددة، session: الجلسة cdbc902a… أو بديلة `connected`.
4. مراقبة عبر scripts/monitor-job.mjs + Progress polling كل 60–120s.
5. جدول النتيجة المتوقع:

| البند | مصدر الحقيقة |
|---|---|
| Available (followers الحالية) | عدّاد الرأس أو web_profile_info probe |
| Extracted (stored rows unique) | `select count(distinct fb_id) … job_id=eq.<id>` |
| نسبة التغطية | stored/available |
| الوقت | started_at → completed_at |
| الأخطاء | progress.errors + session_health snapshots |
| سبب عدم الوصول | progress.stop_reason + تفاصيل لكل جلسة (rate-limit/block/paginate-end) |

6. المقاييس المرجوّة: ≥70% تغطية وسرعة ≥500 مستخدم/دقيقة على 27.8K (أي ≤~38 دقيقة نظرياً؛ عملياً نرى أقل بسبب الراحة).

## Task 7: تدقيق عدم إحداث regression لغير Instagram

- اختبار units التقنية فقط داخل مسارات IG (do not touch group/page/post extractors).
- `npm run build` (service — يشمل __tests__ بـ tsc) + `npm run lint` + `npm run typecheck` (front).
- `npx tsx --test 'src/services/__tests__/*.test.ts' 'src/extractors/__tests__/*.test.ts'`.

## سجل المهام (subagent-ready granularity)

1. توحيد عدّاد وتهيئة `stop_reason` + unit tests (TDD: أحمر→أخضر→كوميت).
2. تقاطع موثوق لأول استجابة + تصعيد probing متعدد المحاولات.
3. منطق استمرار بمستويين للـ DOM fallback.
4. تفعيل استخدام الجلسات الثانوية عند الركود + دمجها في الاستخراج.
5. بوابة الاكتمال + التنسيق مع مسار الاستئناف القائم.
6. Debug/live harness script للمتابعة.
7. Config flag إنْ لزم + i18n + التوثيق (references/ig-followers-dom.md يتحدث علامات جلسات throttled).
8. تحقق نهائي build/lint/test + بروفة live واحدة على حساب تجريبي قبل production.

## Risks / Tradeoffs

- **تفاقم أخطاء rate-limit**: كل pagination متعجلة قد يثير تحقق IG — التحكم: pacing عشوائي، راحة مجدولة، rotating sessions قبل الضغط على نفس الجلسة، وقاعدة «محاولة لا تضر الجلسة».
- **Missions restent longues**: مهمة 27.8K تعني دقائق طويلة؛ التحكم: `pause/resume` موجود أصلاً وإبقاء JOB_TIMEOUT_MS.
- **طبقات Pause/Resume تعقّد UX**: الخدمة تبقى تعيد الجلسة كـ queued تلقائياً عند توفر slot دون تدخل المستخدم، والمستخدم يرى «قيد الاستكمال» فقط.

## Open Questions

1. هل تفضّل التعامل التلقائي (auto-resume) أو اجبار المستخدم على زر "استئناف"؟ (يفترض مؤقتاً auto-resume).
2. هل تسمح بجلسات IG اثنين على الإنتاج أثناء التشغيل المباشر (أقصى حد UI الحالي) أم اختبار واحد على جلسة واحدة؟

---
*الخطة هذه مرحلة فهم فقط — لا تنفيذ قبل "اعتمد".*
