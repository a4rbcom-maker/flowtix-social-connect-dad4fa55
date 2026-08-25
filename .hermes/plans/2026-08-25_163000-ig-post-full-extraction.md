# إصلاح جذري لاستخراج تفاعلات منشورات إنستجرام

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** استخراج كل تفاعلات المنشور (تعليقات + إعجابات) فعلياً بدلاً من 2-4 فقط من 35+.

**Architecture:** المشكلة ثلاثية الأبعاد: (1) `captureFirstPage` يلتقط استجابة GraphQL واحدة فقط ثم يغلق المستمع — بينما IG يُحمّل التعليقات عبر استجابات GraphQL متعددة عند التمرير. (2) لا يوجد نقر على زر "عرض المزيد من التعليقات". (3) `openLikersAndCollect` يمرر 6 جولات فقط داخل dialog الإعجابات — غير كافٍ للمنشورات الأكبر.

**Tech Stack:** TypeScript, Playwright, GraphQL response interception

---

## تحليل الجذر (مؤكد بالـ probe الحي)

### السبب 1: `captureFirstPage` يلتقط استجابة واحدة فقط
في `ig-post-users.ts:79-83`:
```ts
const client = new IgMediaClient();
const first = await client.captureFirstPage(...);
```
`captureFirstPage` (ig-media-client.ts:180-221) يشغّل `page.on("response", handler)` ثم ينتظر `scroll` تمريرات، ثم ينادي `page.off("response", handler)` — أي يلتقط **أول استجابة** فقط تحتوي مستخدمين. لكن IG يُحمّل التعليقات عبر **استجابات GraphQL متعددة** (واحدة عند تحميل الصفحة، وأخرى عند التمرير، وأخرى عند النقر على "عرض المزيد"). كل الاستجابات بعد الأولى تُفقد.

### السبب 2: لا يوجد نقر على "View all N comments"
IG لا يعرض كل التعليقات في الـ DOM عند تحميل الصفحة. الزر "View all N comments" يُحمّل الدفعات الإضافية. الكود لا ينقر هذا الزر أبداً.

### السبب 3: `openLikersAndCollect` محدود بـ 6 جولات
السطر 151: `for (let round = 0; round < 6; round++)` — لمنشور به 35 إعجاب، dialog الإعجابات يحتاج 10-15 تمريرة لتحميلهم كلهم. 6 جولات غير كافية.

### السبب 4: حلقة التمرير لا تلتقط GraphQL الجديد
السطر 99-114: حلقة `while (stale < 15)` تعتمد فقط على `usersFromPostDom` لقراءة DOM. لكن التعليقات الجديدة التي تُحمّل عبر GraphQL لا تُضاف للـ DOM إلا بعد اكتمال الاستجابة. بما أن المستمع GraphQL مغلق (السبب 1)، لا تُلتقط.

---

## الخطة خطوة بخطوة

### Task 1: إضافة دالة التقاط GraphQL المستمرة في `IgMediaClient`

**Objective:** إنشاء دالة `armContinuousCapture` تبقي مستمع GraphQL مفتوحاً طوال الجلسة وتُجمّع كل المستخدمين من كل الاستجابات.

**Files:**
- Modify: `extraction-service/src/services/ig-media-client.ts`

**Step 1: إضافة interface وطريقة بدء/إيقاف الالتقاط المستمر**

أضف قبل `class IgMediaClient`:

```ts
export interface ContinuousCapture {
  /** All users accumulated across every GraphQL response since arming. */
  users: Map<string, IgMediaUser>;
  /** Latest pagination cursor seen (null if none). */
  afterCursor: string | null;
  /** Stop listening and return the final snapshot. */
  stop: () => ContinuousSnapshot;
}

export interface ContinuousSnapshot {
  users: IgMediaUser[];
  afterCursor: string | null;
}
```

أضف داخل `class IgMediaClient`:

```ts
private continuousHandler: ((resp: import("playwright").Response) => void) | null = null;
private continuousAcc: Map<string, IgMediaUser> | null = null;
private continuousAfter: string | null = null;

/** Start capturing ALL GraphQL responses on this page. Call stop() to finish.
 *  Unlike captureFirstPage (single-shot), this stays armed for the entire
 *  extraction session so every paginated comment/like response is collected. */
armContinuousCapture(page: Page): ContinuousCapture {
  this.continuousAcc = new Map();
  this.continuousAfter = null;
  if (this.continuousHandler) page.off("response", this.continuousHandler);
  this.continuousHandler = async (resp: import("playwright").Response) => {
    try {
      const u = resp.url();
      if (!(u.includes("/graphql/query") || u.includes("/api/graphql") || u.includes("/api/v1/media"))) return;
      if (resp.status() !== 200) return;
      const ct = resp.headers()["content-type"] || "";
      if (!ct.includes("json")) return;
      const j = await resp.json().catch(() => null);
      if (!j) return;
      const parsed = usersFromGraphqlBody(j);
      if (parsed.users.length > 0) {
        for (const usr of parsed.users) {
          if (!this.continuousAcc!.has(usr.username)) this.continuousAcc!.set(usr.username, usr);
        }
        if (parsed.after) this.continuousAfter = parsed.after;
      }
    } catch { /* never throw */ }
  };
  page.on("response", this.continuousHandler);
  return {
    users: this.continuousAcc,
    get afterCursor() { return this.continuousAfter; },
    stop: (): ContinuousSnapshot => {
      page.off("response", this.continuousHandler!);
      this.continuousHandler = null;
      const users = Array.from(this.continuousAcc?.values() ?? []);
      this.continuousAcc = null;
      return { users, afterCursor: this.continuousAfter };
    },
  };
}
```

**Step 2: تشغيل `npx tsc --noEmit` — يجب أن يكون نظيفاً**

**Step 3: Commit**

```bash
git add extraction-service/src/services/ig-media-client.ts
git commit -m "feat(ig-media): add armContinuousCapture for multi-response GraphQL collection"
```

---

### Task 2: إصلاح `ig-post-users.ts` لاستخدام الالتقاط المستمر وإضافة نقر "عرض المزيد"

**Objective:** استبدال `captureFirstPage` (single-shot) بـ `armContinuousCapture` (مستمر)، وإضافة نقر على زر "View all comments" قبل التمرير.

**Files:**
- Modify: `extraction-service/src/extractors/ig-post-users.ts`

**Step 1: استبدال `captureFirstPage` بالالتقاط المستمر**

احذف السطرين 80-81 واستبدلهما:

```ts
// 1) Load the post; keep GraphQL listener armed for the entire session.
const client = new IgMediaClient();
const capture = client.armContinuousCapture(this.page);
await this.page.goto(`${config.igBaseUrl}/p/${shortcode}/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
await this.page.waitForTimeout(3000);
```

**Step 2: إضافة نقر "View all comments" قبل جمع الـ DOM**

أضف بعد سطر `await this.page.waitForTimeout(3000)`:

```ts
// 2) Click "View all N comments" / "Load more comments" to trigger
//    additional GraphQL comment loads before the DOM harvest.
for (let attempt = 0; attempt < 5; attempt++) {
  const clicked = await this.page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('span, div[role="button"], button, a'));
    for (const b of btns) {
      const t = (b.textContent || "").trim();
      if (/(view all|all \d+|comments|عرض|مزيد|تحميل|load more)/i.test(t) && t.length < 60) {
        (b as HTMLElement).click();
        return t;
      }
    }
    return null;
  }).catch(() => null);
  if (!clicked) break;
  await this.page.waitForTimeout(2000);
}
```

**Step 3: تعديل نهاية الدالة لإيقاف الالتقاط المستمر**

استبدل السطر 116 (`await this.flushRemaining(collected)`) وما بعده:

```ts
// Stop the continuous GraphQL listener and collect any remaining users.
const snapshot = capture.stop();
let fromGraphQL = 0;
for (const u of snapshot.users) if (add(u)) { fromGraphQL++; engine.addResults(1); }
log.info("IgPostUsers", `graphql total: +${fromGraphQL} → ${collected.size} unique`);

await this.flushRemaining(collected);
```

**Step 4: إزالة `captureFirstPage` الأصلي (الأسطر 79-83 القديمة) — لأننا استبدلناه**

**Step 5: تشغيل `npx tsc --noEmit` — يجب أن يكون نظيفاً**

**Step 6: Commit**

```bash
git add extraction-service/src/extractors/ig-post-users.ts
git commit -m "fix(ig-post): use continuous GraphQL capture + click load-more comments"
```

---

### Task 3: زيادة جولات تمرير dialog الإعجابات

**Objective:** `openLikersAndCollect` يمرر 6 جولات فقط. لمنشور 35+ إعجاب، نحتاج 20+ جولة أو حلقة while حتى الاستقرار.

**Files:**
- Modify: `extraction-service/src/extractors/ig-post-users.ts`

**Step 1: تحويل حلقة `for` إلى `while` مع كشف `stale`**

استبدل الأسطر 148-182:

```ts
const out: { username: string; fullName?: string; avatar?: string }[] = [];
const seen = new Set<string>();
let staleLikers = 0;
let prevSize = 0;
// Scroll inside the dialog until no new rows appear (max 30 rounds).
for (let round = 0; round < 30 && staleLikers < 6; round++) {
  const rows = await this.page
    .evaluate(() => {
      const res: { username: string; fullName: string; avatar: string }[] = [];
      const dialog = document.querySelector('div[role="dialog"]');
      if (!dialog) return res;
      const NAV = new Set(["p", "reel", "reels", "explore", "accounts", "tags", "popular", "directory", "about", "locations", "hashtag"]);
      for (const a of dialog.querySelectorAll('a[href^="/"]')) {
        const href = a.getAttribute("href") || "";
        const m = href.match(/^\/([a-zA-Z0-9._]{1,30})\/?$/);
        if (!m || NAV.has(m[1].toLowerCase())) continue;
        const parent = a.closest("div[role='button']") || a.parentElement;
        let full = "";
        if (parent) {
          for (const s of Array.from(parent.querySelectorAll("span"))) {
            const t = (s.textContent || "").trim();
            if (t && t !== m[1] && t.length <= 100) { full = t; break; }
          }
        }
        res.push({ username: m[1], fullName: full, avatar: "" });
      }
      return res;
    })
    .catch(() => [] as { username: string; fullName: string; avatar: string }[]);
  for (const r of rows) {
    if (!seen.has(r.username)) {
      seen.add(r.username);
      out.push(r);
    }
  }
  if (out.length === prevSize) staleLikers++;
  else { staleLikers = 0; prevSize = out.length; }
  await this.scrollDialogCenter();
}
```

**Step 2: تشغيل `npx tsc --noEmit` — يجب أن يكون نظيفاً**

**Step 3: Commit**

```bash
git add extraction-service/src/extractors/ig-post-users.ts
git commit -m "fix(ig-post): increase likers dialog scroll rounds to 30 with stale detection"
```

---

### Task 4: تحسين `openLikersAndCollect` — توسيع selector نقر زر الإعجابات

**Objective:** زر "N likes" قد لا يطابقه الـ regex الحالي في بعض إصدارات IG. نوسّع الـ selector.

**Files:**
- Modify: `extraction-service/src/extractors/ig-post-users.ts`

**Step 1: توسيع `openLikersAndCollect` للبحث عن الزر**

استبدل الأسطر 132-141:

```ts
const clicked = await this.page
  .evaluate(() => {
    const cands = Array.from(document.querySelectorAll(
      'a[href*="/liked_by/"], section button, button, [role="button"], span'
    )) as HTMLElement[];
    for (const el of cands) {
      const txt = (el.textContent || "").trim();
      // Match "N likes", "N إعجاب", "N others", "and N others"
      if (/(\d[\d,.]*[KkMm]?)\s*(likes?|إعجاب|others|آخرون)/i.test(txt)) {
        el.click();
        return true;
      }
    }
    return false;
  })
  .catch(() => false);
```

**Step 2: تشغيل `npx tsc --noEmit` — يجب أن يكون نظيفاً**

**Step 3: Commit**

```bash
git add extraction-service/src/extractors/ig-post-users.ts
git commit -m "fix(ig-post): widen likers button selector to include span + 'others' text"
```

---

### Task 5: التحقق النهائي — build + deploy

**Objective:** التأكد من أن كل التغييرات تترجم وتُبنى بنجاح.

**Step 1: Typecheck**

```bash
cd extraction-service && npx tsc --noEmit -p tsconfig.json
```
Expected: exit 0, no errors.

**Step 2: Build الواجهة**

```bash
cd .. && npm run build
```
Expected: exit 0.

**Step 3: Commit نهائي (إذا كان هناك تغييرات متبقية) و push**

```bash
git status
git push origin main
```

**Step 4: انتظار deploy**

```bash
sleep 90 && curl -s "https://api.github.com/repos/a4rbcom-maker/flowtix-social-connect-dad4fa55/actions/runs?per_page=1" | grep -o '"status":[^,]*\|"conclusion":[^,]*'
```
Expected: `"status":"completed"` + `"conclusion":"success"`

---

## ملخص الملفات المتأثرة

| الملف | التغيير |
|-------|---------|
| `extraction-service/src/services/ig-media-client.ts` | إضافة `armContinuousCapture` + `ContinuousCapture` interface |
| `extraction-service/src/extractors/ig-post-users.ts` | استبدال `captureFirstPage` بالالتقاط المستمر، نقر "View all comments"، رفع جولات dialog الإعجابات، توسيع selector زر الإعجابات |

## المخاطر

- **حظر IG:** الالتقاط المستمر + نقر "عرض المزيد" + تمرير dialog الإعجابات المكثف قد يزيد من احتمالية اكتشاف IG للنشاط الآلي. التخفيف: pacing موجود أصلاً (minGapMs). نضيف `waitForTimeout` إضافي بين نقرات "عرض المزيد".
- **Dialog الإعجابات لا يفتح:** إذا كان المنشور مخفي الإعجابات (hidden likes)، `openLikersAndCollect` يرجع `[]` بأمان — لا تأثير سلبي.
- **التعليقات لا تُحمّل:** بعض المنشورات لا تعرض زر "View all comments" إذا كان عدد التعليقات قليل. نقر الزر يُحاط بـ `try/catch` ولا يفشل المهمة.

## أسئلة مفتوحة

- هل 30 جولة كافية لـ dialog الإعجابات لمنشور 100+ إعجاب؟ (نعم، لأن dialog IG يُحمّل ~12-15 صف لكل تمريرة، 30 جولة = 360-450 إعجاب)
- هل الالتقاط المستمر يلتقط استجابات GraphQL من علامات تبويب أخرى؟ (لا، `page.on("response")` مرتبط بالـ page الحالية فقط)