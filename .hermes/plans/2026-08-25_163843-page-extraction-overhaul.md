# إصلاح شامل لاستخراج متابعي الصفحات — خطة تنفيذ

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** رفع حصاد استخراج متابعي صفحات فيسبوك من ~350–2,600 مستخدم/مهمة إلى ≥5,000 خلال 60 دقيقة، عبر إصلاح عنق الزجاجة الحقيقي (اكتشاف المنشورات)، بدون أي تأثير على خدمات الجروبات/الماسنجر/IG.

**Architecture:** كل التعديلات تمر عبر **خيارات اختيارية جديدة (optional opts)** في `runGroupCascade` قيمها الافتراضية = السلوك الحالي. `page-followers.ts` وحده يمرّر القيم الجديدة — فالجروبات (المن callers الوحيدون الآخرون) لا يتغيّر سلوكهم بتاتاً. دوال الإثراء ومسار الجروبات في `group-members-core.ts` و`extract.ts` لا تُلمس إطلاقاً.

**Tech Stack:** TypeScript + Playwright (extraction-service)، Supabase (jobs DB)، GitHub Actions deploy.

---

## التشخيص — مثبت بالأرقام الحية (لا نظريات)

| المهمة | الصفحة | المنشورات المكتشفة | المستخدمون | الوقت | سبب التوقف |
|--------|--------|-------------------|-----------|-------|------------|
| `02d292f6` | StudioOussama2 | 165 | 2,667 | 42.5د | max_duration (45د قديم) |
| `49dbce21` | StudioOussama2 | ~181 | 2,549 | ~45د | session_rate_limited (=نفاد الوقت) |
| `781f4e43` | manfaz.alnasr | **3 فقط** (قُطعت بـ deploy) | 73 | 69ث | Server shutdown |
| `a89a39fd` | manfaz.alnasr | **43 فقط** | 350 | ~25د | **source_exhausted** |

**الحقائق الحاسمة:**
1. **العائد لكل منشور = 6–24 مستخدم** (med ~14). أي أن الحصاد ≈ المنشورات المكتشفة × 14.
2. **العنق الزجاجي #1 هو اكتشاف المنشورات، ليس حصاد المتفاعلين:** صفحة بـ 49K متابع (manfaz) اكتشفت **43 منشوراً فقط** ثم أعلنت `source_exhausted`. حتى لو كان الوقت لا نهائياً، السقف = 43×14 ≈ 600.
3. سبب قلة الاكتشاف (من كود `group-cascade-core.ts`):
   - `maxDiscoveryMs` الممرَّر من `page-followers.ts:336` = **120 ثانية فقط** لجلستين (300 ثانية لـ 3+). فيسبوك لا يحمّل أكثر من ~40 منشوراً في نافذة الدقيقتين.
   - `MAX_EMPTY_REDISCOVERIES = 3` (سطر 347): بعد 3 إعادة اكتشاف فارغة يتوقف البحث نهائياً — وصفحات manfaz الـ `/videos` و`/reels` فارغة فأحرقت المحاولات الثلاث بلا نتيجة.
   - `FEED_VARIANTS` الحالية (سطر 339): `["", "/videos", "/reels", "?sorting_setting=CHRONOLOGICAL"]` — لا يوجد `/photos` ولا `/posts` رغم أنهما أغنى أسطح الصفحات بالمنشورات.
   - إيقاع تمرير الاكتشاف `sleep(900 + rand(0,600))` (سطر 318) سريع جداً لخلاصات الصفحات (lazy-load لا يشتغل) — مناسب للجروبات فقط.
4. **العنق الزجاجي #2: مرحلة followers_search top-up تلتهم الوقت:** في `a89a39fd` استغرقت ~10 دقائق لإضافة 50 مستخدماً فقط (300→350) — 5 مستخدم/دقيقة.
5. **العنق #3: ~20 ثانية/منشور** (حوار reactions 10ث + commenters 10ث + استراحات) — و`scrollContainerAggressively` ينتظر **noProgress>=40** (≈10ث توقف كامل!) قبل أن ييأس من منشور ميت.
6. الإثراء (2–5%): **ليس خطأ كود** — يوجد DB واحد `egypt_fixed.db` على السيرفر والـ IDs بصيغة 615 الجديدة لا تطابقه. (مشكلة بيانات، خارج نطاق هذه الخطة — موثقة في مهمة منفصلة بالأسفل).
7. `JOB_TIMEOUT_MS=3600000` (60د) منشور ومفعّل — الوقت لم يعد العائق.
8. زر التحميل أثناء الإثراء: **أُصلح ومنشور** (commit `3af8d4d` — `enrichment:{}` كان truthy في JS).

**معادلة الهدف:** 5,000 مستخدم ÷ 14/منشور ≈ 360 منشوراً مكتشفاً، ÷ 60 دقيقة ≈ 6 منشورات/دقيقة عبر عاملَين = 10ث/منشور/عامل. **قابل للتحقق** — كل مهمة في الخطة تخدم أحد طرفي المعادلة.

---

## Task 1: قياسات اكتشاف في السجلات (instrumentation)

**Objective:** كل عملية rediscovery تطبع عدد المنشورات الجديدة التي جلبتها واسم السطح — لنعرف بالدليل أي سطح يجلب منشورات، بدل التخمين.

**Files:**
- Modify: `D:/Projects/FlowTix/extraction-service/src/services/group-cascade-core.ts` (~سطر 349-366 داخل `runRediscovery`)

**Step 1:** في `runRediscovery`، قبل `scrollRounds` سجّل `const before = queuedPosts.size;` وبعد الـ flush مباشرة (قبل عدّ `emptyRediscoveries`) أضف:

```ts
const before = queuedPosts.size;
// ... (scrollRounds + flush كما هي)
const surfaced = queuedPosts.size - before;
log.info("GroupCascade", `rediscovery: surface=${variant || "timeline"} surfaced ${surfaced} new posts (total ${queuedPosts.size}/${maxPosts})`);
```

**Step 2 (تحقق):**
```bash
cd "D:/Projects/FlowTix/extraction-service" && npx tsc --noEmit -p tsconfig.json
```
Expected: صفر أخطاء. (تغيير logging فقط — صفر سلوك.)

**Step 3 (commit):**
```bash
git add src/services/group-cascade-core.ts && git commit -m "feat(cascade): log posts surfaced per rediscovery surface"
```

---

## Task 2: نافذة اكتشاف تتناسب مع الميزانية (pages فقط)

**Objective:** رفع نافذة الاكتشاف من 120ث ثابتة إلى 20% من الوقت المتبقي (5–12 دقيقة) — يضاعف حجم مجمّع المنشورات.

**Files:**
- Modify: `D:/Projects/FlowTix/extraction-service/src/extractors/page-followers.ts:336`

**Step 1:** استبدل:

```ts
maxDiscoveryMs: allPages.length >= (opts.latePages ? 3 : 2) ? 300_000 : 120_000,
```

بـ:

```ts
// Discovery window scales with remaining budget (min 5, max 12 min).
// The old fixed 120s/300s capped page cascades at ~40-180 discovered
// posts — the #1 harvest bottleneck proven live (manfaz.alnasr:
// 43 posts → source_exhausted at 350 users).
const discoveryWindowMs = Math.min(
  12 * 60_000,
  Math.max(5 * 60_000, Math.round((this.timeRemainingMs - 45_000) * 0.2)),
);
maxDiscoveryMs: discoveryWindowMs,
```

**Step 2 (تحقق):** `npx tsc --noEmit -p tsconfig.json` → صفر أخطاء.

**Step 3 (إثبات سلوك الجروبات سليم):** الجروبات لا تمرّ عبر `page-followers.ts` — `grep -n "runGroupCascade" src/extractors/*.ts` يجب أن يُظهر caller واحداً للصفحات + caller الجروبات الحالي، والأخير لا يمرّر `maxDiscoveryMs` فيظل على الافتراضي 300ث. وثّق نتيجة الـ grep في الـ PR.

**Step 4 (commit):**
```bash
git add src/extractors/page-followers.ts && git commit -m "perf(page-followers): scale discovery window with time budget (5-12min)"
```

---

## Task 3: أسطح تغذية أكثر + محاولات rediscovery أكثر (pages فقط)

**Objective:** إضافة `/photos` و`/posts` كأسطح اكتشاف (أغنى مصادر permalinks) ورفع سقف المحاولات الفارغة من 3 إلى 8 للصفحات.

**Files:**
- Modify: `D:/Projects/FlowTix/extraction-service/src/services/group-cascade-core.ts` (سطر ~57 منطقة الخيارات + سطر 347)
- Modify: `D:/Projects/FlowTix/extraction-service/src/extractors/page-followers.ts:328`

**Step 1:** في `group-cascade-core.ts` أضف للـ options interface:

```ts
/** Max rediscovery passes that surface 0 new posts before giving up.
 *  Default 3 (groups). Pages pass a higher value — their /videos, /reels
 *  surfaces are often empty and must not burn the whole budget. */
maxEmptyRediscoveries?: number;
```

**Step 2:** سطر 347 استبدل:

```ts
const MAX_EMPTY_REDISCOVERIES = 3;
```

بـ:

```ts
const MAX_EMPTY_REDISCOVERIES = opts.maxEmptyRediscoveries ?? 3;
```

**Step 3:** في `page-followers.ts:328` استبدل variants:

```ts
rediscoverVariants: ["", "/videos", "/reels", "/photos", "/posts", "?sorting_setting=CHRONOLOGICAL"],
```

وفي نفس استدعاء `runGroupCascade` أضف:

```ts
maxEmptyRediscoveries: 8,
```

**Step 4 (تحقق):**
```bash
cd "D:/Projects/FlowTix/extraction-service" && npx tsc --noEmit -p tsconfig.json
```
Expected: صفر أخطاء. (الجروبات: لا يمرّرون `maxEmptyRediscoveries` → يظلون على 3 الافتراضي.)

**Step 5 (commit):**
```bash
git add src/services/group-cascade-core.ts src/extractors/page-followers.ts
git commit -m "feat(page-cascade): discover /photos & /posts surfaces, 8 empty-rediscovery budget"
```

---

## Task 4: إيقاع تمرير أهدأ لخلاصات الصفحات (lazy-load fix)

**Objective:** خلاصات الصفحات lazy-load ثقيلة — التمرير السريع (900ms) لا يعطي فيسبوك فرصة تحميل منشورات جديدة. الصفحات تحصل على 2.2–3.7ث بين كل تمريرة، الجروبات كما هي.

**Files:**
- Modify: `D:/Projects/FlowTix/extraction-service/src/services/group-cascade-core.ts` (سطر 318 داخل `scrollRounds`)

**Step 1:** استبدل:

```ts
await sleep(900 + rand(0, 600));
```

بـ:

```ts
// Page feeds lazy-load heavier than group feeds; too-fast scrolling
// never triggers the next batch of posts. Groups keep the old cadence.
if (feedKind === "page") {
  await sleep(2200 + rand(0, 1500));
} else {
  await sleep(900 + rand(0, 600));
}
```

**Step 2 (تحقق):** `npx tsc --noEmit -p tsconfig.json` → صفر أخطاء. `feedKind` متاح داخل closure `scrollRounds` (معرّف سطر 120).

**Step 3 (commit):**
```bash
git add src/services/group-cascade-core.ts && git commit -m "perf(cascade): slower page-feed scroll cadence to trigger lazy-load"
```

---

## Task 5: يأس أسرع من المنشورات الميتة (deep extractor فقط)

**Objective:** `scrollContainerAggressively` ينتظر 40 دورة بلا تقدم (≈10 ثوانٍ كاملة ضائعة على منشور لا يعرض المزيد). الخفض إلى 14 دورة (≈4 ثوانٍ) يقلّل زمن المنشور الميت — والدالة تستخدمها `extractEngagersDeep` فقط (مسار الصفحات حصراً؛ `extractEngagers` الأصلية تستخدم `scrollDialogForMore` ولم تُمس).

**Files:**
- Modify: `D:/Projects/FlowTix/extraction-service/src/services/engager-extractor-v2.ts:411`

**Step 1:** استبدل:

```ts
if (noProgress >= 40) break; // genuine stall
```

بـ:

```ts
if (noProgress >= 14) break; // ~4s of no new rows — genuine stall, move on
```

**Step 2 (تحقق):** `npx tsc --noEmit -p tsconfig.json` → صفر أخطاء + `grep -n "noProgress >= 40" src/services/engager-extractor-v2.ts` → لا نتائج (تأكيد الاستبدال).

**Step 3 (commit):**
```bash
git add src/services/engager-extractor-v2.ts && git commit -m "perf(engagers-deep): bail on stalled reaction dialog after ~4s not 10s"
```

---

## Task 6: ميزانية تعليقات أخف للصفحات (deep extractor فقط)

**Objective:** مسار commenters يأخذ `max(7, scrollDialogSeconds)` = 10ث — بينما التعليقات أقل قيمة من التفاعلات للمتابعين. خفضها إلى `max(6, scrollDialogSeconds*0.6)` = 6ث يوفّر 4ث/منشور (≈40% من زمن المنشور).

**Files:**
- Modify: `D:/Projects/FlowTix/extraction-service/src/services/engager-extractor-v2.ts:501`

**Step 1:** استبدل:

```ts
await scrollContainerAggressively(page, Math.max(7, opts.scrollDialogSeconds), "commenters");
```

بـ:

```ts
// Reactors are the primary follower signal for pages; commenters get a
// lighter budget (60% of the reactor scroll) to keep per-post time low.
await scrollContainerAggressively(page, Math.max(6, Math.round(opts.scrollDialogSeconds * 0.6)), "commenters");
```

**Step 2 (تحقق):** `npx tsc --noEmit -p tsconfig.json` → صفر أخطاء.

**Step 3 (commit):**
```bash
git add src/services/engager-extractor-v2.ts && git commit -m "perf(engagers-deep): lighter commenter budget for page cascades"
```

---

## Task 7: تحديد زمن مرحلة followers_search (pages فقط)

**Objective:** مرحلة البحث أحادي الحرف أكلت 10 دقائق لإضافة 50 مستخدماً في `a89a39fd`. تحديدها بـ 3 دقائق hard deadline.

**Files:**
- Modify: `D:/Projects/FlowTix/extraction-service/src/extractors/page-followers.ts:507` (حلقة `FOLLOWERS_SEARCH_TERMS`)

**Step 1:** قبل الحلقة مباشرة أضف، وأضف شرط اليأس داخلها:

```ts
const searchDeadline = Date.now() + 3 * 60_000;
for (const term of FOLLOWERS_SEARCH_TERMS) {
  if (await this.throttledCanceled()) break;
  if (Date.now() >= searchDeadline) {
    log.info("PageFollowers", `search top-up timeboxed at 3min (recovered ${searchUsers.length} so far) — moving on`);
    break;
  }
  // ... باقي جسم الحلقة كما هو
```

**Step 2 (تحقق):** `npx tsc --noEmit -p tsconfig.json` → صفر أخطاء.

**Step 3 (commit):**
```bash
git add src/extractors/page-followers.ts && git commit -m "perf(page-followers): 3-minute timebox on followers search top-up"
```

---

## Task 8: نشر + تحقق ما بعد النشر

**Objective:** دفع كل المهام ومراقبة الـ deploy.

**Step 1:**
```bash
cd "D:/Projects/FlowTix" && git push origin main
```

**Step 2:** انتظر ~60ث ثم:
```bash
gh run list --repo a4rbcom-maker/flowtix-social-connect-dad4fa55 --limit 1
```
Expected: `completed success` (Deploy to Server).

**Step 3 (تحقق ما بعد النشر):**
```bash
curl -s https://api.flowtixtools.com/health -H "X-API-Key: $API_KEY"
```
Expected: `{"status":"ok",...}`.

---

## Task 9: اختبار A/B حي — إثبات الأرقام

**Objective:** إثبات التحسّن بأرقام DB، مع ضمان عدم كسر الجروبات.

**Step 1 (صفحة كبيرة — manfaz.alnasr):**
```bash
curl -s -X POST https://api.flowtixtools.com/extract -H "Content-Type: application/json" -H "X-API-Key: $API_KEY" \
  -d '{"type":"pages","source_url":"https://www.facebook.com/manfaz.alnasr","session_ids":["fcffe9db-1ab1-4347-ada9-9c58312f2638","122cd08b-370e-437a-84e1-b84d46d4d070"],"max_results":100000}'
```
راقب كل دقيقتين في `extraction_jobs.progress` (سكربت المراقبة المعروف). دوّن: posts_total النهائي، result_count، stop_reason، duration.

**معايير القبول (manfaz مقابل baseline 43 منشوراً/350 مستخدم):**
- [ ] منشورات مكتشفة ≥ 120 (2.8x)
- [ ] مستخدمون ≥ 900 في ≤ 60 دقيقة (2.6x)
- [ ] stop_reason ليس `source_exhausted` قبل 30 دقيقة من التشغيل
- [ ] `session_health` كلها `healthy` حتى النهاية

**Step 2 (صفقة تحكم — StudioOussama2):** نفس الخطوة، القبول: posts ≥ 300 (vs 181)، مستخدمون ≥ 4,000 (vs 2,549).

**Step 3 (اختبار عدم كسر الجروبات — إلزامي):** مهمة `groups` صغيرة على جروب معروف:
```bash
curl -s -X POST https://api.flowtixtools.com/extract -H "Content-Type: application/json" -H "X-API-Key: $API_KEY" \
  -d '{"type":"groups","source_url":"https://www.facebook.com/groups/731243328607269","session_ids":["fcffe9db-1ab1-4347-ada9-9c58312f2638"],"max_results":500}'
```
القبول: تنجز طبيعياً، منشورات تُكتشف بنفس الوتيرة السابقة (سجلات rediscovery)، صفر أخطاء، تكتمل بلا `source_exhausted` مبكر. (الجروبات لا تمرّ بأي opt جديد — هذا تحقق أن الافتراضيات لم تتغير.)

**Step 4 (سجلات الأسطح):** من سجل الخدمة بعد النشر، تأكد أن أسطر `rediscovery: surface=/photos surfaced N` تظهر — دليل أن الأسطح الجديدة تعمل.

---

## الملفات المتغيرة (ملخص)

| الملف | التغيير | أثر الجروبات |
|-------|---------|--------------|
| `src/extractors/page-followers.ts` | نافذة اكتشاف متدرجة + variants جديدة + `maxEmptyRediscoveries:8` + timebox البحث | لا يوجد (ملف صفحات حصراً) |
| `src/services/group-cascade-core.ts` | opt اختياري `maxEmptyRediscoveries` (افتراضي 3 = الحالي) + سطر logging + إيقاع page-feed | **صفر** — الافتراضيات مطابقة للقيم القديمة حرفياً |
| `src/services/engager-extractor-v2.ts` | `extractEngagersDeep` فقط (noProgress 40→14، ميزانية commenters) | **صفر** — الدالة القديمة تستخدم `scrollDialogForMore` ولم تُمس |

**ملفات لا تُلمس إطلاقاً:** `group-members-core.ts`، `extract.ts`، `ig-*.ts`، مسار الإثراء `enrichment-service.ts`/`enrichment-queue.ts` (أُصلح زر التحميل سابقاً في `3af8d4d`)، الـ frontend.

---

## المخاطر والتخفيف

| الخطر | التخفيف |
|-------|---------|
| `group-cascade-core.ts` ملف مشترك — أي تعديل قد يكسر الجروبات (خط المستخدم الأحمر) | كل تغيير = opt اختياري بقيمة افتراضية مطابقة للسلوك الحالي + اختبار جروب إلزامي (Task 9 Step 3) قبل اعتبار الخطة منجزة |
| إيقاع أهدأ (Task 4) = اكتشاف أبطأ في الدقيقة الواحدة | التعويض: نافذة أطول (Task 2) + أسطح أكثر (Task 3) — الصافي صافي منشورات أكثر (يتحقق في Task 9) |
| تعرّض أكبر لفيسبوك → حظر جلسة | الإيقاع الأهدأ نفسه يبدو أكثر بشرية؛ `session_health` يراقب كل مهمة، ومعيار القبول يشترط بقاءها healthy |
| `/photos` قد يعيد بنية GraphQL مختلفة | regex الالتقاط `"post_id":"(\d{10,})"` عام على كل استجابات GraphQL؛ سجلات Task 1 تُثبت surfaced>0 أو تسمح بالتراجع الفوري |
| ازدحام queue مع مهام أطول | `MAX_CONCURRENT_JOBS=1` موجود؛ 60د timeout منشور |

## أسئلة مفتوحة / خارج النطاق

1. **الإثراء 2–5%**: يحتاج رفع ملفات `.db` إضافية إلى `/www/wwwroot/api.flowtixtools.com/data/enrichment` على السيرفر (بيانات، ليس كوداً). DB واحد `egypt_fixed` مصري فقط، و1449 ID بصيغة 615 الجديدة لا يطابقونه أبداً. **إجراء المستخدم** — أنا جاهز للمساعدة عند توفر الملفات.
2. **جلسة ثالثة**: إضافة جلسة FB ثالثة ترفع العمال من 2 إلى 3 (+50% إنتاجية منشورات/دقيقة) بلا أي كود — رافعة تشغيلية جاهزة.
3. **البديل الجذري** (Graph API رسمي) لاستخراج المتابعين الحصريين بالكامل — مشروع منفصل، خارج هذه الخطة.
