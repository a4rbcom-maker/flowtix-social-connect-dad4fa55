# خطة إصلاح: استخراج تفاعلات (إعجابات) منشور Instagram — `ig_post_engagers`

> **For Hermes:** نفّذ هذه الخطة عبر مهمة واحدة مركّزة على `ig-post-users.ts` وحده. لا تلمس مسارات FB/Groups/Pages ولا `ig_post_commenters`. لا تنفيذ قبل «اعتمد».

**الهدف:** استخراج أكبر عدد فعلي من المُعجِبين بمنشور IG (≥ 70% من المتاح فعلياً ضمن صلاحيات الجلسة) بدلاً من 2–3، مع pagination مستمر حتى الاستنفاد، دون تعليق/تجميد، وحفظ بلا فقد أو تكرار.

**النطاق:** فرع `platform === "instagram"` + `ctx.type === "ig_post_engagers"` فقط. الملف الوحيد المتوقّع تعديله: `extraction-service/src/extractors/ig-post-users.ts` (ودالة resolver صغيرة يُحتمل وضعها في نفس الملف).

**Tech Stack:** Express + Playwright + IG in-page `fetch` (GraphQL/private-API) + Supabase (`extraction_results`, `extraction_jobs.progress`).

---

## 1) السبب الجذري (مؤكَّد من الكود — لا نظري)

الملف `extraction-service/src/extractors/ig-post-users.ts`, الدالة `fetchLikersViaApi()` (السطور ~179–292):

```ts
const params = new URLSearchParams({
  doc_id: "8604818727118937",                       // ← PolarisPostCommentsPageQuery (استعلام التعليقات!)
  variables: JSON.stringify({ shortcode, child_comment_count: 3, fetch_comment_count: 40,
                              parent_comment_count: 24, has_threaded_comments: true, after }),
  fb_api_req_friendly_name: "PolarisPostCommentsPageQuery",
});
...
const likeEdges = xdt.edge_liked_by?.edges ?? xdt.edge_media_preview_like?.edges ?? [];
const pageInfo  = (xdt.edge_liked_by ?? xdt.edge_media_preview_like)?.page_info;
if (!result.hasNext) break;                          // ← ينكسر فوراً
after = result.endCursor ?? null;
```

**الأعطال المتسلسلة:**

1. **Endpoint خاطئ للإعجابات.** `doc_id=8604818727118937` هو استعلام التعليقات. حقل `edge_liked_by` داخل استجابة التعليقات **معاينة فقط** (وكذلك `edge_media_preview_like` — الاسم نفسه يقول *preview*): يعيد ~3–12 معجباً كحد أقصى، و`page_info.has_next_page = false` / `end_cursor = null` في الغالب.
2. **Pagination مكسور بنيوياً.** المؤشّر `after` المأخوذ من هذا الاستعلام يُرقّم **التعليقات**، لا المُعجِبين. حتى لو صحّ الحقل، فالمؤشّر لا يخصّ اتصال `edge_liked_by`. النتيجة: الحلقة `MAX_PAGES=100` تخرج بعد الصفحة 0 بـ 2–3 نتائج.
3. **لا يوجد مسار بديل يعوّض للـ engagers.**
   - مسار DOM (`usersFromPostDom`) يلتقط مؤلّفي **التعليقات** الظاهرين فقط، لا المُعجِبين.
   - `armContinuousCapture` يلتقط فقط ما يُطلقه المتصفّح فعلاً؛ وبما أن نافذة «الإعجابات» (liked_by dialog) لا تُفتح إطلاقاً في مسار الـ engagers (استُبدلت بالـ API)، لا يصدر أي طلب GraphQL خاص بقائمة المُعجِبين ليُلتقط.
   - فالمُعجِبون يأتون **حصراً** من `fetchLikersViaApi` المكسور ← 2–3.

> **خلاصة:** ليست حدود منصّة على منشور عادي. إنه ببساطة الاستعلام الخطأ يقرأ حقل معاينة غير قابل للترقيم. (حالة الحساب العملاق 686M المذكورة في `references/ig-known-limits.md` هي حدّ منصّة حقيقي منفصل — لا يُصلَح، فقط يُبلَّغ.)

## 2) الأجزاء الأخرى التي فُحصت وسلامتها (لا تُعدَّل)

| العنصر | الحالة | ملاحظة |
|---|---|---|
| `maxResults` | سليم | افتراضي 100000 (`routes/extract.ts:41,156`) — ليس هو الحدّ الذي يوقف الاستخراج |
| Deduplication | سليم للـ IG | `base.ts:663–669` لا يعمل cross-job dedup لـ IG؛ dedup داخل المهمة فقط عبر `add()`/`seen`. ليس سبب النقص |
| Session / admission | سليم | جلسة `disconnected` تُرفض عند `POST /extract` (حماية، ليست عطلاً) |
| `checkCanceled`/stale=15 | سليم | حلقة السكرول (خطوة 5) تخصّ التعليقات؛ لا تؤثّر على المُعجِبين |
| `processBatch` retry (3×) + `recordLostBatch` | سليم | الحفظ نفسه ليس هو المشكلة؛ المشكلة أن ما يُسلَّم للحفظ = 2–3 |
| flush ≥ 50 + `flushRemaining` | سليم | لكنه لا ينفع إن كان الحصاد 2–3 أصلاً |

## 3) المعمارية المقترحة للإصلاح

مبدأ: **مسارَان متوازيان للمُعجِبين، يُدمجان في نفس `collected` Map** (dedup بالـ username)، مع مؤشّر ترقيم صحيح واستمرار حتى `has_next_page=false` أو استنفاد الصبر.

### المسار A (الأساسي): Private mobile API — `GET /api/v1/media/{media_id}/likers/`
- **لماذا:** هذا هو المصدر الذي يعيد قائمة المُعجِبين الكاملة (ضمن ما تسمح به IG للجلسة)، خلافاً لحقل المعاينة.
- **يتطلّب `media_id` (pk رقمي)، لا shortcode.** استخراجه من HTML المنشور — النمط موجود جاهز في `debug-ig-id.ts:16`:
  ```ts
  out.mediaId = (html.match(/"id":"(\d+)_(\d+)"/) || [])[1]; // أو [0] لكامل "pk_owner"
  ```
  نضيف دالة `resolveMediaId(shortcode)`: `page.goto(/p/<shortcode>/)` ثم `fetch` للـ HTML واستخراج أول `"media_id"` / `"id":"<digits>_<digits>"`.
- **الطلب داخل الصفحة** (نفس الجلسة/الكوكيز/البصمة):
  ```ts
  fetch(`https://www.instagram.com/api/v1/media/${mediaId}/likers/`, {
    credentials: "include",
    headers: { "x-ig-app-id": "936619743392459", accept: "*/*" },
  })
  ```
  الاستجابة: `{ users: [{ username, full_name, profile_pic_url, pk }], ... }`.
- **الترقيم:** هذا الـ endpoint يعيد دفعة كبيرة دفعة واحدة (لا cursor) لمعظم المنشورات. إن رجع `next_max_id`/`max_id` نستخدمه؛ وإلا نعتبرها مكتملة.

### المسار B (احتياطي): GraphQL likers query بالـ media_id
- عند فشل A (429/403/شكل مختلف)، نستخدم مسار GraphQL مخصّص للإعجابات مرقّماً عبر `edge_liked_by.page_info.end_cursor` **من استعلام يخصّ الإعجابات فعلاً** (يُلتقط الـ `doc_id`/friendly-name الصحيح حياً — انظر §4).
- الشرط الحاسم: يجب أن يكون الاستعلام هو استعلام قائمة الإعجابات، لا التعليقات؛ عندها فقط يصير `has_next_page` و`end_cursor` ذوَي معنى للمُعجِبين.

### مسار C (احتياطي أخير): DOM likers dialog
- فتح نافذة «الإعجابات» عبر رابط `a[href$="/liked_by/"]` أو زر عدد الإعجابات، ثم سكرول النافذة مع `armContinuousCapture` نشطاً لالتقاط ردود GraphQL الناتجة. يبقى فقط لتغطية الحالات التي يفشل فيها A وB.

### الاندماج والإنهاء
- الثلاثة تكتب في `collected` عبر `add()` الحالي (dedup بالـ username محفوظ).
- **شروط الإنهاء الصحيحة:** `has_next_page=false` (A/B) أو نفاد rows الجديدة عبر دورتَي صبر في C أو بلوغ `maxResults`. **إزالة الاعتماد على `edge_media_preview_like`** ككل نهائي.
- pacing 1200ms بين الصفحات (موجود) لتفادي 429؛ عند 429 نتوقّف بلطف ونسجّل `stop_reason` بدل الادّعاء بالاكتمال.

## 4) خطوة استطلاع حيّة إلزامية قبل الكتابة (probe، ليست تنفيذاً للإصلاح)

قبل تعديل الكود، probe مستقل بنمط `debug-ig-media.ts` على **جلسة متّصلة** ومنشور عادي عليه مئات/آلاف الإعجابات، لإثبات:
1. أن `/api/v1/media/{mediaId}/likers/` يعيد `users.length` أكبر بكثير من 3 (المسار A).
2. التقاط الـ `doc_id`/`fb_api_req_friendly_name` الحقيقي لقائمة الإعجابات عند فتح النافذة يدوياً (للمسار B — غالباً `PolarisPostLikedByListQuery` أو مشابه).
3. تأكيد resolver الـ media_id من HTML.
- **قيود بيئة معروفة (من skill):** استخدم `page.evaluate(\`(()=>{...})()\`)` كنص (تفادي `__name` من tsx). لا تشغّل probe على المنفذ 3100. استخدم template string.

## 5) الملفات المتوقّع تغييرها

- **Modify:** `extraction-service/src/extractors/ig-post-users.ts`
  - استبدال جسم `fetchLikersViaApi()` بالكامل بمنطق المسار A (+ B/C كاحتياطي)، وإضافة `resolveMediaId(shortcode)`.
  - عدم المساس بـ `fetchCommentsViaApi()` (مسار commenters سليم).
- **(احتمال) New probe مؤقّت:** `extraction-service/src/debug-ig-likers.ts` — يُحذف بعد الإثبات.
- **Test:** `extraction-service/src/extractors/__tests__/ig-post-users.test.ts` — اختبار وحدة لدالة parse للـ likers API وشرط الإنهاء (يجب ألا يكسر `npm run build` لأن `tsc` يشمل ملفات `*.test.ts`).

## 6) التحقّق (build/test/real-run)

1. `cd extraction-service && npm run build` (كامل `tsc` على `src/**` — يشمل الاختبارات).
2. `npm run typecheck` (frontend) — لا تغييرات متوقّعة فيه لكنه بوّابة CI.
3. `npx tsx --test 'src/extractors/__tests__/*.test.ts' 'src/services/__tests__/*.test.ts'`.
4. **Real run** عبر المسار الحقيقي: `POST /extract` بنوع `ig_post_engagers` على جلسة متّصلة ومنشور معروف العدد، ثم مراقبة `extraction_jobs.progress` عبر `scripts/monitor-job.mjs`، والتأكّد من تشغيل الكود الجديد فعلاً (grep على سطر لوج يخصّ المسار الجديد فقط، وتفادي فخّ «STALE SERVICE ON 3100»: القتل بالمنفذ لا بالنمط، وتأكيد `/health` = DOWN قبل الإقلاع، وغياب `EADDRINUSE`).

## 7) طريقة الإثبات بالأرقام (المطلوبة صراحةً)

جدول إثبات لكل تشغيل تجريبي، مبنيّ على مصادر حقيقية:

| المقياس | المصدر |
|---|---|
| عدد الإعجابات الظاهر على المنشور | header count من `edge_media_preview_like.count` / نص «N likes» في DOM |
| المتاح للاستخراج فعلاً | `users.length` الإجمالي من `/api/v1/media/{id}/likers/` قبل dedup (سقف الجلسة) |
| العدد المستخرَج | `collected.size` = `progress.extracted` |
| المحفوظ فعلاً | `result_count` في DB (بعد dedup داخل المهمة) — يجب أن يساوي `extracted` لمنشور جديد |
| نسبة التغطية | `extracted / المتاح-للاستخراج × 100` (وليس على العدد الظاهر إن قيّدت IG القائمة) |
| الوقت | `duration` من `progress.last_activity - started` و`rate_per_min` |
| الأخطاء وأسباب النقص | `progress.errors`، `stop_reason`، عدد صفحات API، أي 429/403، وهل السبب حدّ منصّة (notice + `has_next_page=false` من endpoint الإعجابات الصحيح) أم لا |

**معيار النجاح:** على منشور عادي غير مقيّد، `extracted ≥ 70%` من `المتاح-للاستخراج`، مع `stop_reason` واضح إن قلّت. على حساب/منشور عملاق مقيّد: يُبلَّغ كحدّ منصّة (بأرقام)، لا يُعتبر عطلاً — طبقاً لـ `references/ig-known-limits.md`.

## 8) المخاطر والمقايضات والأسئلة المفتوحة

- **حدّ منصّة حقيقي على الإعجابات:** IG تُخفي القائمة الكاملة للمُعجِبين على بعض المنشورات/الحسابات الكبيرة حتى للجلسة المتّصلة. الإصلاح يرفع الحصاد للحدّ المتاح، لا يتجاوز حظر IG. يُثبَت بالفرق بين «الظاهر» و«المتاح».
- **ثبات الـ doc_id/endpoint:** IG تغيّر المُعرّفات صامتةً؛ لذا probe حيّ لالتقاط المعرّف الحالي بدل تثبيته أعمى (نفس درس followers/comments).
- **429/rate-limit:** pacing 1200ms + توقّف لطيف + `stop_reason` بدل ادّعاء الاكتمال.
- **سؤال مفتوح للمستخدم:** هل «التفاعلات» هنا = الإعجابات (likers) حصراً، أم يريد دمج المُعلّقين أيضاً ضمن «المتفاعلين»؟ الخطة الحالية تركّز على الإعجابات (`ig_post_engagers`) كما ورد. لو أراد الدمج، نضيف استدعاء `fetchCommentsViaApi` أيضاً في مسار الـ engagers ونوحّد النتائج.

---
**لا تنفيذ الآن.** بانتظار «اعتمد» للبدء بخطوة الـ probe الحيّ (§4) ثم تطبيق المسار A.
