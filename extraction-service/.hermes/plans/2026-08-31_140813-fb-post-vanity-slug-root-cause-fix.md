# إصلاح جذري: استخراج تعليقات + تفاعلات Facebook من أي سطح بوست (vanity-slug fix)

> **For Hermes:** نفّذ مهمة-بمهمة. الكود جاهز للنسخ. TDD حيث ينطبق. commit بعد كل مهمة. لا تمسّ استخراج الجروب (`group-members.ts`).

**Goal:** رفع تغطية استخراج المعلّقين والمتفاعلين لأي بوست FB بإصلاح العطل الذي يُسقط كل مستخدم رابطه vanity-slug (`/username`) بدل `profile.php?id=`.

**Architecture:** كلا الـ extractor يحصدان المستخدمين من DOM (`[role="article"]` للتعليقات، نافذة dialog للتفاعلات). العطل: المُنقّي الداخلي يقبل `profile.php?id=`/`\/user\/` فقط ويُسقط الـ vanity قبل معالجته. الإصلاح: قبول الـ vanity-slug في نقطة الحصاد، مع تنظيف `?comment_id=` وتصفية الـ junk slugs الموجودة أصلاً.

**Tech Stack:** Playwright + TypeScript، extraction-service على 3100/3200، Supabase.

---

## السبب الجذري (مُثبت بالأرقام — probe حيّ 2026-08-31)

بوست `manfaz.alnasr/posts/…` (1440 تعليق)، جلسة `ba5882ba` متصلة:

| القياس | القيمة | الدلالة |
|--------|--------|---------|
| عقد `[role="article"]` في DOM | **22** | التعليقات محمّلة فعلاً |
| `articlesWithUser` (المطابق لـ profile.php?id=) | **0** | كلها vanity-slug |
| روابط المعلّقين الفعلية | `/manfaz.alnasr?comment_id=`, `/khaled.mahmoud.349117?comment_id=`, `/shahen.shahy?comment_id=` | vanity + comment_id |
| رد GraphQL تعليقات مُصفَّح | لم يُلتقَط (رد واحد users=1، بلا cursor) | مسار GraphQL لا يكفي على هذا السطح |

**نقطة العطل الحرفية** — `post-comments.ts` داخل `drainDomBatch` (السطر ~418):
```ts
const idMatch = href.match(/profile\.php\?id=(\d{5,25})/) || href.match(/\/user\/(\d{5,25})/);
if (!idMatch) return;   // ← يُسقط كل vanity-slug commenter قبل أن يصل لمعالجة الـ vanity
```
معالجة الـ vanity في السطور 456-462 (`vanity[1]` → `fb_id`) صحيحة لكنها **كود ميت غير قابل للوصول** لأن `raw` لا يحوي عناصر vanity أصلاً (أُسقطت في الـ evaluate).

نفس النمط في `post-reactions.ts` → `extractReactorsFromDialogDom` (السطر ~343): يطابق `profile\.php\?id=` / `/user/` فقط.

**ليس حد منصّة:** التعليقات موجودة ومقروءة في DOM؛ الكود يرفضها بسبب شكل الرابط فقط.

---

## Task 1: اختبار فاشل يثبت إسقاط الـ vanity في تطبيع الرابط

**Objective:** التقاط سلوك «رابط vanity + comment_id يُنتج fb_id صالحاً» في اختبار وحدة نقي.

**Files:**
- Create: `extraction-service/src/extractors/__tests__/dom-user-link.test.ts`

**Step 1: استخرج منطق التطبيع في دالة نقية قابلة للاختبار (تمهيد Task 2 يعتمد عليها).**

أضف في `post-comments.ts` (module-scope، بجانب `isJunkSlug`) دالة مُصدَّرة:
```ts
/** Normalize a comment/reactor author href into a stable fb_id.
 *  Accepts numeric profile.php / /user/ ids AND vanity slugs
 *  (facebook.com/<slug>?comment_id=…). Returns null for junk/non-user links. */
export function normalizeUserHref(href: string): { fbId: string; profileUrl: string } | null {
  const idMatch = href.match(/profile\.php\?id=(\d{5,25})/) || href.match(/\/user\/(\d{5,25})/);
  if (idMatch) {
    return { fbId: idMatch[1], profileUrl: `https://www.facebook.com/profile.php?id=${idMatch[1]}` };
  }
  const abs = href.startsWith("http") ? href : `https://www.facebook.com${href}`;
  const vanity = abs.match(/facebook\.com\/([a-zA-Z0-9.]{3,60})(?:[/?#]|$)/i);
  if (!vanity || isJunkSlug(vanity[1])) return null;
  return { fbId: vanity[1], profileUrl: `https://www.facebook.com/${vanity[1]}` };
}
```

**Step 2: اكتب الاختبار الفاشل.**
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeUserHref } from "../post-comments.js";

test("vanity slug with comment_id resolves to fb_id", () => {
  const r = normalizeUserHref("/khaled.mahmoud.349117?comment_id=Y29tbWVudDox");
  assert.equal(r?.fbId, "khaled.mahmoud.349117");
});
test("numeric profile.php id resolves", () => {
  assert.equal(normalizeUserHref("/profile.php?id=100012345678")?.fbId, "100012345678");
});
test("junk slug is rejected", () => {
  assert.equal(normalizeUserHref("/photo.php?fbid=123"), null);
  assert.equal(normalizeUserHref("/reel/abc"), null);
});
```

**Step 3: شغّل ليفشل.**
`npx tsx --test src/extractors/__tests__/dom-user-link.test.ts` → FAIL (الدالة غير موجودة بعد).

**Step 4: أضف الدالة (Step 1) → أعد الاختبار → PASS.**

**Step 5: commit** `test(fb-post): normalizeUserHref accepts vanity commenter links`.

---

## Task 2: إصلاح drainDomBatch ليقبل الـ vanity (السبب الجذري للتعليقات)

**Objective:** التقاط معلّقي الـ vanity-slug الذين يُسقطهم `if (!idMatch) return;`.

**Files:**
- Modify: `extraction-service/src/extractors/post-comments.ts` (`drainDomBatch`, ~L403-474)

**Step 1: داخل الـ `page.evaluate` — بدّل شرط الإسقاط.**

استبدل (السطر ~416-418):
```ts
        const href = userLink.getAttribute("href") || "";
        const idMatch = href.match(/profile\.php\?id=(\d{5,25})/) || href.match(/\/user\/(\d{5,25})/);
        if (!idMatch) return; // only count real user ids, skip pages/links
```
بـ:
```ts
        const href = userLink.getAttribute("href") || "";
        // Accept BOTH numeric ids AND vanity slugs. The vanity path is resolved
        // in the outer loop (normalizeUserHref); dropping non-numeric here was
        // the root cause of 0-comment results on /posts/ surfaces where FB
        // renders every commenter as facebook.com/<slug>?comment_id=…
        // (still skip obvious non-user hrefs).
        const looksUserish = /profile\.php\?id=\d{5,25}/.test(href)
          || /\/user\/\d{5,25}/.test(href)
          || /^\/?(?:https?:\/\/[^/]*facebook\.com)?\/[a-zA-Z0-9.]{3,60}(?:[/?#]|$)/.test(href);
        if (!looksUserish) return;
```

**Step 2: في الحلقة الخارجية — استخدم `normalizeUserHref` بدل المنطق المكرر (DRY).**

استبدل (السطر ~449-462) كتلة `idMatch`/`vanity` بـ:
```ts
    for (const c of raw) {
      const norm = normalizeUserHref(c.href);
      if (!norm) continue;
      const { fbId, profileUrl } = norm;
      if (seen.has(fbId)) continue;
      seen.add(fbId);
      batch.push({
        fb_id: fbId,
        name: c.name,
        profile_url: profileUrl,
        type: "commenter",
        ...(c.comment_text ? { comment_text: c.comment_text } : {}),
        ...(c.comment_id ? { comment_id: c.comment_id } : {}),
      });
    }
    return batch;
```

**Step 3: build.** `npm run build` → أخضر (يشمل ملف الاختبار في tsc).

**Step 4: تشغيل حقيقي.** خدمة على `PORT=3200` (اقتل بالـ port أولاً)، مهمة `post_comments` على بوست الـ1440. راقب DB.
Expected: `result_count` ≫ 0 (عشرات على الأقل من الـ22 المرئية + المزيد بالتمرير)، `progress.discovered` مرتفع.

**Step 5: commit** `fix(fb-post-comments): accept vanity-slug commenters — root cause of 0 results on /posts/`.

---

## Task 3: نفس الإصلاح لمسار التفاعلات (dialog)

**Objective:** قبول متفاعلي الـ vanity-slug في نافذة التفاعلات.

**Files:**
- Modify: `extraction-service/src/extractors/post-reactions.ts` (`extractReactorsFromDialogDom`, ~L330-355)

**Step 1: استبدل التقاط الرابط.**

استبدل:
```ts
      const idMatch = link.href.match(/profile\.php\?id=(\d{5,25})/) || link.href.match(/\/user\/(\d{5,25})/);
      if (!idMatch) continue; // only real user ids
      ...
      const fbId = idMatch[1];
      const profileUrl = `https://www.facebook.com/profile.php?id=${fbId}`;
```
باستيراد `normalizeUserHref` من `./post-comments.js` (أو انقلها لـ `base.ts` كأداة مشتركة — القرار في Step 2) واستخدامها:
```ts
      const norm = normalizeUserHref(link.href);
      if (!norm) continue;
      const { fbId, profileUrl } = norm;
```

**Step 2: قرار DRY — إن استوردت من post-comments شعرت بغرابة، انقل `normalizeUserHref` + `isJunkSlug` + `JUNK_SLUGS` إلى `base.ts` وصدّرها، واستوردها في كلا الـ extractor.** (الأنظف؛ لكن غيّر أقل عدد أسطر.)

**Step 3: build → أخضر. تشغيل حقيقي** `post_reactions` على بوست معروف تفاعلاته.
Expected: تحسّن فعلي عن 2 حين تُفتح النافذة وتحوي روابط vanity.

**Step 4: commit** `fix(fb-post-reactions): accept vanity-slug reactors in dialog scrape`.

---

## Task 4: منع التصنيف الخاطئ + تعزيز التمرير للوصول لأكبر عدد

**Objective:** ضمان أن حلقة `extractFromDomLoop` تُمرّر وتوسّع بما يكفي لحصاد المئات لا العشرات، دون حلقة لا نهائية.

**Files:**
- Modify: `extraction-service/src/extractors/post-comments.ts` (`extractFromDomLoop`, ~L363-387)

**Step 1: ارفع سقف الجمود المتسامح + أضف تمريراً للأسفل بين الجولات** (القيم الحالية `consecutiveEmpty < 15` معقولة؛ تأكّد أن `scrollFeed` يمرّر فعلاً الحاوية الصحيحة على سطح `/posts/`). أضف قياساً: سجّل `total` كل جولة في اللوج للتشخيص.

**Step 2: تشغيل حقيقي على بوست الـ1440، سجّل المنحنى** (كم في الجولة 1/5/10). أثبت أن العدد يتصاعد.

**Step 3: commit** `fix(fb-post-comments): sustain scroll to harvest large comment threads`.

---

## Task 5: اختبارات + إثبات نهائي بالأرقام

- `npm run build` (service — يشمل tests) → أخضر.
- `npx tsx --test 'src/extractors/__tests__/*.test.ts' 'src/services/__tests__/*.test.ts'` → كلها تمر، الإخفاقات ≤ خط الأساس.
- تشغيل حقيقي لكلا النوعين على بوست الـ1440 + بوست تفاعلات معروف، والإثبات:

| المسار | المتاح | المستخرَج | التغطية | المدة | الأخطاء | سبب النقص |
|--------|--------|-----------|---------|-------|---------|-----------|
| تعليقات (1440) | 1440 | ؟ | ؟ | ؟ | ؟ | ؟ |
| تفاعلات (معروف) | ؟ | ؟ | ؟ | ؟ | ؟ | ؟ |

- نظّف مهام الاختبار (`update status='canceled'`، لا حذف — فخ enum `activity_action`).

---

## Task 6: مراجعة + نشر

- `requesting-code-review` على الـ diff الكامل: Regression، تصنيف خاطئ (معلّق↔متفاعل)، junk slugs مسرّبة (pages مثل `manfaz.alnasr` صاحب البوست — قد يُحصد كـ «معلّق» لأنه ردّ؛ قرار: يُحصد مرة واحدة، مقبول).
- تأكّد أن الجروب سليم (`group-members.ts` لم يُلمَس؛ إن نُقلت `normalizeUserHref` لـ `base.ts` فتأكّد ألا تغيّر سلوك group/pages).
- الإثراء يعمل بعد الاستخراج/الإيقاف (`if (result.extracted > 0)`).
- `git push origin main` → انتظر `conclusion: success` على نفس الـ SHA.

---

## المخاطر والمقايضات

- **صاحب البوست (Page) يظهر كمعلّق:** ردوده تُحصد كـ «معلّق» بـ vanity slug الصفحة. مقبول (يُدَدُّ مرة). إن أراد المستخدم استبعاد صاحب البوست، يُضاف slug صاحب البوست لقائمة استبعاد ديناميكية — **لا تفعل الآن (YAGNI)** إلا بطلب.
- **الـ vanity قد يلتقط روابط non-user نادرة** (صفحات): قائمة `JUNK_SLUGS` + التصفية الحالية تغطّي المعروف؛ راقب في التشغيل الحقيقي.
- **fb_id يصبح نصياً (slug) لا رقمياً:** الـ enrichment يطابق بالاسم للـ FBIDs الجديدة أصلاً (رأينا `615*` FBIDs)، والـ vanity slug مقبول كمعرّف مستقر للتصدير. تأكّد أن `storeResults` لا يفرض fb_id رقمياً.
- **سؤال مفتوح:** هل الـ enrichment يتعامل مع slug كـ fb_id بلا مشكلة؟ تحقّق في Task 5 (اقرأ صفاً واحداً بعد التخزين).

**معيار النجاح:** تعليقات بوست الـ1440 تُستخرج بالعشرات/المئات (تغطية عالية فعلية)، التفاعلات تتحسن عن 2 حين تتوفر، الاختبارات خضراء، لا regression على الجروب، الإثراء يعمل، والمشكلة الأصلية (صفر) انتهت — مُثبت بالأرقام.
