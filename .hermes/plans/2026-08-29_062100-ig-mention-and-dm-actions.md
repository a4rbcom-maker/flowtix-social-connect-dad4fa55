# خطة تنفيذ: إجراءان بعد استخراج إنستجرام (منشن في منشور | إرسال رسالة)

> **For Hermes:** نفّذ هذه الخطة مهمة-بمهمة عبر `subagent-driven-development` مع مراجعة spec ثم code quality بعد كل مهمة.

**الهدف:** بعد أي استخراج إنستجرام (followers / following / post_commenters / post_engagers / hashtag_posts / user_search)، يظهر للمستخدم إجراءان على نتائج المهمة:
1. **منشن (Mention)** — التعليق على منشور إنستجرام محدد وذكر المستخرَجين `@username` على دفعات.
2. **رسالة (DM)** — إرسال رسالة مباشرة لكل مستخرَج.

**المعمارية:** إعادة استخدام نفس بنية `message_jobs` + `message_recipients` + `message_send_counters` (المُثبتة في مسار Messenger) بعد جعلها platform-aware عبر عمودين `platform` و `mode`، مع Worker واحد لإنستجرام يتقاسم طبقة الـpacing النقية `message-pacing.ts`. لا يُلمس أي مسار Facebook.

**Tech Stack:** Express + Playwright (extraction-service, port 3100) · Supabase (Postgres + RLS) · React 19 + TanStack Query v5 + i18next (ar/en RTL).

---

## 1) الفهم التقني — الآلية والحدود الحقيقية

### 1.1 المنشن (Mention) — كيف يعمل فعلياً

المنشن على إنستجرام ليس API مستقلاً: هو **تعليق (comment) على منشور** نصه يحتوي `@username`. الشخص المذكور يستقبل إشعاراً. إذن ميزة "المنشن" = نشر سلسلة تعليقات على منشور واحد، كل تعليق يحمل مجموعة أسماء.

الحدود المنشورة/الموثقة (تم التحقق من المصادر 2026-08-29):

| الحد | القيمة | المصدر/الطبيعة |
|---|---|---|
| عدد `@mentions` في تعليق واحد | **5** (سقف عملي مُبلَّغ عنه) | قيود منصة معروفة — تجاوزه يجعل التعليق spam/يُرفَض |
| عدد mentions/tags في المنشور نفسه | 20 | لا يهمنا (نحن نعلّق لا ننشر) |
| معدل التعليقات | **12–14 تعليق/ساعة**، فاصل **350–400 ثانية** | القيمة الأخطر — تجاوزها = `action_blocked` |
| نص التعليق | حد أحرف عملي ~2200 | غير مقيّد فعلياً عند 5 أسماء |

**الحسبة الحاكمة:** 5 أسماء/تعليق × 12 تعليق/ساعة = **60 مستخرَج/ساعة لكل جلسة**. وبفاصل 350–400 ثانية بين التعليقات، الجلسة الواحدة تُنجز ~12 تعليق/ساعة كحد أقصى. مع جلستين (الحد الأقصى المتاح للمستخدم) = **~120 مستخرَج/ساعة** كسقف نظري، ويجب أن نبقى **تحت** السقف لا عليه.

القيم الافتراضية المقترحة (محافظة بنسبة ~30% أسفل الحد):
- `mentions_per_comment = 4` (وليس 5)
- `delay_min = 380s`, `delay_max = 520s` (وليس 350)
- `comments_per_hour = 8` (وليس 12)
- `daily_cap = 60 تعليق/جلسة/يوم` (= 240 مستخرَج/جلسة/يوم عند 4/تعليق)
- `batch_size = 6 تعليقات` ثم `batch_pause = 1800s` (نصف ساعة راحة)
- احترام quiet hours (01:00–07:00 القاهرة) — نفس `isQuietHour()` الموجود

### 1.2 الرسالة (DM) — كيف تعمل فعلياً

مسار الإرسال يتبع نفس نمط `message-sender.ts` لكن على DOM إنستجرام: `https://www.instagram.com/direct/t/...` أو الدخول من صفحة البروفايل → زر Message. لا نستخدم أي API خاص غير موثق ولا نحاول تجاوز حماية — نفس الجلسة المسجَّلة، إدخال حقيقي بالكيبورد، وتحقق من التسليم.

الحدود الحقيقية للـDM (مصادر متعددة 2026):
- حساب جديد (<30 يوم): **10–30 رسالة/يوم**
- حساب مستقر (180+ يوم): 80–150 رسالة/يوم
- **message requests** (رسائل لغير المتابعين — وهو حالتنا الغالبة، cold outreach): **10–20/يوم للحساب الجديد**

القيم الافتراضية المقترحة:
- `daily_cap = 15` رسالة/جلسة/يوم للـcold (نفس منطق `Math.min(input.daily_cap, 15)` الموجود في `messages.ts:147`)
- `rate_per_hour = 5`
- `delay_min = 90s`, `delay_max = 240s`
- `batch_size = 5` ثم `batch_pause = 1800s`

### 1.3 استغلال الجلستين بأمان

الجلستان **لا تُستخدمان بالتوازي على نفس الهدف**. يُستخدم `pickSession()` الموجود في `message-pacing.ts:65` كما هو: يختار الجلسة الحيّة، تحت الـcaps، غير المبرَّدة، والأقل استخداماً اليوم. النتيجة توزيع تلقائي (round-robin مرجّح) يضاعف الطاقة اليومية دون مضاعفة الضغط على أي حساب. عند إشارة حظر: `setCooldown(sessionId, 24h)` والانتقال للأخرى؛ عند حظر الاثنتين: `status='paused'` مع `stop_reason` واضح.

---

## 2) السياق الحالي والفرضيات (من قراءة الكود)

ما هو موجود فعلاً ويُعاد استخدامه:

| الملف | ما يقدمه | الاستخدام هنا |
|---|---|---|
| `extraction-service/src/services/message-pacing.ts` | `dayKeyUtc`, `nextDelayMs`, `renderTemplate`, `hasVariation`, `isQuietHour`, `pickSession`, `detectBlockSignal` | يُعاد استخدامه كما هو (دوال نقية) + إضافة `detectIgBlockSignal` |
| `extraction-service/src/services/message-worker.ts` | حلقة worker + counters + cooldown + batch pause + paused/completed | القالب المرجعي لـ`ig-action-worker.ts` |
| `extraction-service/src/routes/messages.ts` | `/messages/preview|start|pause|resume|stop|:jobId` + فحص الملكية | القالب المرجعي لـ`/ig-actions/*` |
| `supabase/migrations/2026082910_message_jobs.sql` | `message_jobs` + `message_recipients` + `message_send_counters` + RLS + trigger | يُوسَّع بعمودَي `platform` + `mode` |
| `extraction-service/src/services/ig-context-manager.ts` | `createContext` + قفل الجلسة + التحقق من عدم كونها guest + حفظ الكوكيز المُدوَّرة | يُستخدم كما هو |
| `extraction-service/src/services/ig-supabase.ts` | `getIgSessionAndCookies` (يرفض غير المتصلة، يتحقق من الكوكيز الحرجة) | يُستخدم كما هو |
| `src/pages/dashboard/messenger/MessageComposerPage.tsx` | Composer + pacing + preview + progress | القالب المرجعي لصفحة IG |

فرضيات مثبتة من الكود:
- `extraction_results` لنتائج IG: `fb_id` = الـ`username`، و`data.username`/`data.full_name` موجودان (`ig-post-users.ts:52-62`).
- `message_recipients.thread_id` نوعه `text NOT NULL` — سنخزّن فيه الـ`username` لمسار IG (لا حاجة لتغيير النوع).
- الفريد الحالي `uq_message_recipients_job_fb (message_job_id, fb_id)` يكفي لمنع التكرار داخل المهمة.
- Trigger `enforce_message_jobs_active_limit` يمنع أكثر من مهمة مراسلة نشطة **لكل مستخدم**. سنجعله **لكل (user, platform)** حتى لا تتعارض مهمة IG مع مهمة Messenger قائمة.
- الحد الأقصى لجلسات IG المتصلة عملياً = 2 (نفس سياسة FB في `2026082310_per_user_limits.sql`).
- زر الرسائل في `TasksPage.tsx:325` مُقيَّد بـ`canMessage(job)` ويعرض للـIG زراً معطلاً مع `messaging.igUnsupported` — هذا ما سنستبدله.

## 3) المقاربة المقترحة (وقرار المعمارية)

**قرار: توسيع الجداول القائمة، لا إنشاء جداول جديدة.**

السبب: الميزتان (mention/DM) تشتركان في 90% من دورة الحياة مع مسار Messenger — نفس المستلمون، نفس الـpacing، نفس الـcooldown، نفس واجهة التقدم. إنشاء `ig_action_jobs` منفصلة يعني تكرار 3 جداول + RLS + trigger + worker + repository + UI. التوسيع بعمودين يمنحنا:
- `platform text NOT NULL DEFAULT 'facebook'` → `'facebook' | 'instagram'`
- `mode text NOT NULL DEFAULT 'dm'` → `'dm' | 'mention'`

كل مسار Facebook القائم يبقى يعمل حرفياً بلا تعديل (القيم الافتراضية تحفظ سلوكه).

**Worker منفصل، جدول مشترك.** `ig-action-worker.ts` مستقل عن `message-worker.ts`: منطق المنشن (تجميع دفعات + تعليق واحد لعدة مستلمين) مختلف جوهرياً عن حلقة "مستلم واحد لكل دورة"، ودمجهما في worker واحد سيولّد شروطاً متشعبة. لكنه يستورد نفس `message-pacing.ts` ونفس دوال الـcounters.

**طبقة DOM منفصلة:** `ig-comment-sender.ts` (المنشن) و`ig-dm-sender.ts` (الرسالة) — كل منهما يعيد `SendOutcome` بنفس الشكل الموجود في `message-sender.ts:14`.

**مبدأ إلزامي — probe قبل الـselectors:** قبل كتابة أي selector لصندوق التعليق أو محرر الـDM، يُكتب probe مستقل (`debug-ig-comment.ts`, `debug-ig-dm.ts`) على نمط `debug-msg-send2.ts` ويُشغَّل على جلسة حقيقية متصلة. DOM إنستجرام يتغير صامتاً — الـselectors المكتوبة من الذاكرة ستفشل. هذه هي Task 0 وهي **مانعة** لما بعدها.

---

## 4) الخطة خطوة بخطوة

### Task 0: Probe حيّ لـDOM التعليق والـDM (مانِع — لا يُكتب selector قبله)

**الهدف:** إثبات الأشكال الفعلية لصندوق التعليق على منشور IG، ولمحرر الـDM، على جلسة متصلة حقيقية.

**Files:**
- Create: `extraction-service/src/debug-ig-comment.ts`
- Create: `extraction-service/src/debug-ig-dm.ts`

**Step 1 — probe التعليق.** انسخ هيكل `src/debug-msg-send2.ts` (نفس boot: `browserPool.init()` → `igSupabaseService.getIgSessionAndCookies` → `igContextManager.createContext`). المطلوب طبعه:
- وجود `textarea[aria-label]` أو `div[contenteditable="true"][role="textbox"]` في منطقة التعليقات، مع الـ`aria-label` الفعلي
- وجود زر النشر (`Post`/`نشر`) وحالة `disabled` قبل/بعد الكتابة
- عدد التعليقات المرئية قبل/بعد (إثبات النشر الحقيقي)
- نص أي banner قيود يظهر

استخدم `page.evaluate` بصيغة **template string** لا function — `page.evaluate(\`(() => { ... })()\`)` — لتفادي حقن `__name` من tsx (pitfall مثبت في مهارة المشروع).

**Step 2 — التشغيل.** استخدم منفذاً غير 3100 إن احتجت خدمة. الأمر:
```
cd extraction-service && npx tsx src/debug-ig-comment.ts <igSessionId> <postShortcode>
```
المتوقع: طباعة الـselectors الفعلية + `COMMENT_POSTED ✅` أو سبب الفشل.

**Step 3 — probe الـDM.** نفس النمط على `https://www.instagram.com/direct/t/` أو من البروفايل → زر Message:
```
cd extraction-service && npx tsx src/debug-ig-dm.ts <igSessionId> <targetUsername>
```
المتوقع: `DM_SENT ✅` + الـselector المؤكَّد للمحرر.

**Step 4 — تدوين النتائج.** أضف `references/ig-comment-dm-dom.md` إلى مهارة `flowtix-extraction-service` بالأشكال المؤكَّدة والتواريخ. **لا تنتقل إلى Task 1 قبل نجاح الاثنين على جلسة متصلة.**

**Step 5 — commit:**
```bash
git add extraction-service/src/debug-ig-comment.ts extraction-service/src/debug-ig-dm.ts
git commit -m "chore(ig): live probes for comment + DM DOM shapes"
```

---

### Task 1: Migration — توسيع الجداول لتكون platform/mode aware

**الهدف:** إضافة `platform` + `mode` وتوسيع الـtrigger، دون كسر أي صف أو مسار FB قائم.

**Files:**
- Create: `supabase/migrations/2026082920_ig_message_actions.sql`

**Step 1 — محتوى الـmigration** (additive بالكامل، `status`/`mode`/`platform` نصوص لا enums — تفادياً لفخ `ALTER TYPE`):
```sql
ALTER TABLE public.message_jobs
  ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'facebook',
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'dm';

ALTER TABLE public.message_jobs
  ADD CONSTRAINT message_jobs_platform_chk
  CHECK (platform IN ('facebook','instagram')) NOT VALID;
ALTER TABLE public.message_jobs
  ADD CONSTRAINT message_jobs_mode_chk
  CHECK (mode IN ('dm','mention')) NOT VALID;

ALTER TABLE public.message_recipients
  ADD COLUMN IF NOT EXISTS batch_index int;

CREATE INDEX IF NOT EXISTS idx_message_jobs_user_platform_status
  ON public.message_jobs (user_id, platform, status);
```

**Step 2 — توسيع الـtrigger** ليصبح النطاق `(user_id, platform)`: نفس دالة `enforce_message_jobs_active_limit` مع `AND j.platform = NEW.platform` داخل الـ`SELECT count(*)`، ورسالة الاستثناء تبقى عربية. هذا يسمح بمهمة Messenger ومهمة IG نشطتين معاً، ويمنع مهمتين على نفس المنصة.

**Step 3 — `message_send_counters`** يُشارَك كما هو (المفتاح `(session_id, day_key)` و`session_id` هنا سيكون `ig_sessions.id` — لا تعارض لأن UUIDs فريدة عبر الجدولين). **لكن** سياسة الـSELECT الحالية تربط بـ`fb_sessions` فقط، فتُضاف سياسة موازية:
```sql
DROP POLICY IF EXISTS select_own_ig_message_counters ON public.message_send_counters;
CREATE POLICY select_own_ig_message_counters ON public.message_send_counters
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.ig_sessions s
            WHERE s.id = session_id AND (s.user_id = auth.uid() OR is_super_admin()))
  );
```

**Step 4 — التطبيق والتحقق.** يُطبَّق عبر Supabase Management API عبارةً-بعبارة (CLI بلا صلاحيات — راجع `references/supabase-management-api.md`). ثم أثبت:
```sql
select column_name, data_type, column_default from information_schema.columns
where table_name='message_jobs' and column_name in ('platform','mode');
select count(*) from public.message_jobs where platform is null or mode is null;  -- expected 0
```
**دليل عدم الـregression:** يجب أن تعرض كل الصفوف القديمة `platform='facebook'`, `mode='dm'`.

**Step 5 — commit:**
```bash
git add supabase/migrations/2026082920_ig_message_actions.sql
git commit -m "feat(db): platform+mode on message_jobs for IG mention/DM actions"
```

---

### Task 2: طبقة pacing لإنستجرام (دوال نقية + اختبارات)

**الهدف:** إضافة منطق IG الخاص إلى طبقة pacing نقية قابلة للاختبار بلا متصفح ولا DB.

**Files:**
- Create: `extraction-service/src/services/ig-action-pacing.ts`
- Create: `extraction-service/src/services/__tests__/ig-action-pacing.test.ts`

**Step 1 — اكتب الاختبار الفاشل أولاً** (`ig-action-pacing.test.ts`, باستخدام `node:test` + `node:assert` كما في اختبارات المشروع):
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { chunkMentions, buildMentionComment, detectIgActionBlock, IG_MENTION_DEFAULTS } from "../ig-action-pacing.js";

test("chunkMentions splits by mentions_per_comment", () => {
  const users = ["a","b","c","d","e","f","g"];
  const chunks = chunkMentions(users, 4);
  assert.equal(chunks.length, 2);
  assert.deepEqual(chunks[0], ["a","b","c","d"]);
  assert.deepEqual(chunks[1], ["e","f","g"]);
});

test("chunkMentions clamps to the platform ceiling of 5", () => {
  assert.equal(chunkMentions(["a","b","c","d","e","f"], 99)[0].length, 5);
});

test("buildMentionComment prefixes @ and keeps template text", () => {
  const text = buildMentionComment("شوف ده 👇", ["ali","sara"]);
  assert.match(text, /@ali/);
  assert.match(text, /@sara/);
  assert.match(text, /شوف ده/);
});

test("buildMentionComment never double-prefixes @", () => {
  assert.equal((buildMentionComment("x", ["@ali"]).match(/@/g) ?? []).length, 1);
});

test("detectIgActionBlock recognizes action_blocked", () => {
  assert.equal(detectIgActionBlock("Action Blocked. Try again later"), "rate_limited");
  assert.equal(detectIgActionBlock("challenge_required"), "session_dead");
  assert.equal(detectIgActionBlock("everything fine"), null);
});

test("defaults stay conservative under the documented ceilings", () => {
  assert.ok(IG_MENTION_DEFAULTS.mentions_per_comment <= 5);
  assert.ok(IG_MENTION_DEFAULTS.delay_min >= 350);
  assert.ok(IG_MENTION_DEFAULTS.comments_per_hour <= 12);
});
```

**Step 2 — شغّله وتأكد من الفشل:**
```
cd extraction-service && npx tsx --test 'src/services/__tests__/ig-action-pacing.test.ts'
```
المتوقع: FAIL — `Cannot find module '../ig-action-pacing.js'`.

**Step 3 — نفّذ الحد الأدنى** في `ig-action-pacing.ts`:
- `IG_MENTION_CEILING = 5` (سقف المنصة الصلب)
- `chunkMentions(usernames, perComment)` — يقصّ `perComment` إلى `[1, IG_MENTION_CEILING]` ثم يقسّم
- `buildMentionComment(template, usernames)` — يمرّر النص على `renderTemplate` المستورد من `message-pacing.js` (DRY، لا تكرار spintax) ثم يلحق الأسماء مسبوقة بـ`@` مع تطبيع أي `@` مسبق
- `detectIgActionBlock(pageText)` — يعيد `"rate_limited" | "send_rejected" | "session_dead" | null` مستخدماً نفس علامات `ig-base.ts:32-46` (`action_blocked`, `try again later`, `feedback_required`, `checkpoint_required`, `/challenge/`, `/accounts/login`) + مكافئاتها العربية
- `IG_MENTION_DEFAULTS` و`IG_DM_DEFAULTS` بالقيم المحافظة من القسم 1
- **لا تعيد كتابة** `nextDelayMs` / `isQuietHour` / `pickSession` — استوردها

**Step 4 — أعد التشغيل:** المتوقع `6 pass, 0 fail`.

**Step 5 — تحقق من الـbuild** (ملفات الاختبار داخل برنامج tsc — pitfall مثبت):
```
cd extraction-service && npm run build
```
المتوقع: نجاح بلا أخطاء.

**Step 6 — commit:**
```bash
git add extraction-service/src/services/ig-action-pacing.ts extraction-service/src/services/__tests__/ig-action-pacing.test.ts
git commit -m "feat(ig): pure pacing layer for mention/DM actions + tests"
```

---

### Task 3: طبقة DOM — ناشر التعليق (المنشن)

**الهدف:** دالة واحدة تنشر تعليقاً واحداً على منشور محدد وتعيد `SendOutcome` صريحاً.

**Files:**
- Create: `extraction-service/src/services/ig-comment-sender.ts`
- استخدم selectors Task 0 **حرفياً** — لا تخترع.

**Step 1 — التوقيع:**
```ts
export async function postComment(
  page: Page,
  shortcode: string,
  text: string,
): Promise<SendOutcome>;
```
`SendOutcome` يُعاد استيراده من `./message-sender.js` (لا نوع مكرر).

**Step 2 — التدفق المطلوب** (مطابقاً لنمط `message-sender.ts` المُثبت):
1. `page.goto(\`${config.igBaseUrl}/p/${shortcode}/\`, { waitUntil: "domcontentloaded", timeout: config.igNavTimeoutMs })`
2. انتظار صندوق التعليق بـpolling (لا `waitForSelector` صلب) — إن لم يظهر خلال 45s → `thread_unavailable` مع سبب "صندوق التعليق لم يظهر"
3. فحص قيود **قبل** الكتابة عبر `detectIgActionBlock(bodyText)` — `session_dead` / `rate_limited` تُعاد فوراً بلا كتابة
4. `page.keyboard.press("Escape")` ثم `page.focus(selector)` ثم `page.keyboard.type(text, { delay: 40 + rand*50 })` — **بلا clicks** على الصندوق (overlays تعترض pointer events)
5. النشر: `Enter` ثم إن لم يُرصد، النقر على زر النشر المؤكَّد من الـprobe
6. **تأكيد التسليم:** التعليق الجديد يجب أن يظهر في نص الصفحة (نفس فكرة `confirmDelivered`) — لا تعتمد على غياب الخطأ
7. فحص قيود **بعد** النشر (بعض الـbanners تظهر لاحقاً فقط)
8. `catch` شامل → `send_failed` مع `detail` مقتطعة إلى 200 حرف، بلا تسريب كوكيز

**Step 3 — التحقق اليدوي** بـprobe صغير يستدعي `postComment` مباشرة على منشور تملكه:
```
cd extraction-service && npx tsx src/debug-ig-comment.ts <igSessionId> <shortcode> --via-sender
```
المتوقع: `{ ok: true }` + ظهور التعليق فعلياً على المنشور (تحقق بصري).

**Step 4 — commit:**
```bash
git add extraction-service/src/services/ig-comment-sender.ts
git commit -m "feat(ig): DOM comment sender with delivery confirmation"
```

---

### Task 4: طبقة DOM — مُرسِل الـDM

**الهدف:** إرسال رسالة مباشرة إلى `username` وإعادة `SendOutcome`.

**Files:**
- Create: `extraction-service/src/services/ig-dm-sender.ts`

**Step 1 — التوقيع:** `export async function sendIgDm(page: Page, username: string, text: string): Promise<SendOutcome>`

**Step 2 — التدفق:** نفس الانضباط أعلاه، مع فارقين:
- الوصول إلى المحادثة عبر المسار المؤكَّد من الـprobe (بروفايل → Message، أو `/direct/t/<threadId>` إن أمكن استخراجه)
- الحساب الخاص / المحظور / غير الموجود → `thread_unavailable` (تخطٍّ لا فشل — لا يُحرق retry)

**Step 3 — التحقق:** `npx tsx src/debug-ig-dm.ts <igSessionId> <username> --via-sender` → `{ ok: true }` + وصول الرسالة فعلياً.

**Step 4 — commit:**
```bash
git add extraction-service/src/services/ig-dm-sender.ts
git commit -m "feat(ig): DOM direct-message sender with delivery confirmation"
```

---

### Task 5: الـWorker — دورة حياة مهمة IG (mention + dm)

**الهدف:** worker واحد يقرأ `message_jobs` حيث `platform='instagram'` ويشغّل الوضعين مع pacing وcooldown وcheckpoint واستئناف.

**Files:**
- Create: `extraction-service/src/services/ig-action-worker.ts`
- Create: `extraction-service/src/services/__tests__/ig-action-worker.test.ts`

**Step 1 — اكتب الاختبار الفاشل أولاً.** حاكِ نمط الحقن الموجود في `message-worker.ts:130-138` (`WorkerHooks` بـ`sendOneFn`/`delayFn`) لاختبار المنطق بلا متصفح:
- مع 7 مستلمين و`mentions_per_comment=4` → عدد استدعاءات النشر = **2** ودفعتان بحجم 4 و3
- `rate_limited` من الناشر → **لا** يزيد `attempts` على المستلم، ويُسجَّل cooldown للجلسة
- `thread_unavailable` → المستلم `skipped` و`progress.skipped` يزيد
- بلوغ `max_errors` متتالية → الحالة `paused` و`stop_reason='too_many_errors'`
- `isQuietHour()=true` → توقف بـ`stop_reason='quiet_hours'` بلا أي إرسال
- عدم وجود جلسة مؤهلة → `paused` بـ`daily_cap_reached` أو `all_sessions_cooling`

**Step 2 — شغّل وتأكد من الفشل:**
```
cd extraction-service && npx tsx --test 'src/services/__tests__/ig-action-worker.test.ts'
```

**Step 3 — نفّذ الـworker.** انسخ هيكل `message-worker.ts` بالكامل واحتفظ بـ:
`workers = new Map<string, boolean>()`, `startIgActionWorker`, `stopIgActionWorker`, `resumeIgActionJobs`, `loadCounters`, `bumpCounter`, `setCooldown`, `updateProgress`. الفروق الجوهرية:

| البند | Messenger الحالي | IG هنا |
|---|---|---|
| مصدر الجلسة | `fb_sessions` + `supabaseService.getSessionAndCookies` | `ig_sessions` + `igSupabaseService.getIgSessionAndCookies` |
| السياق | `contextManager.createContext` | `igContextManager.createContext` |
| الإرسال | `sendOne(page, threadId, text)` | `mode==='mention' ? postComment(page, shortcode, commentText) : sendIgDm(page, username, text)` |
| وحدة الدورة | مستلم واحد | `mode==='mention'` → **دفعة** من `chunkMentions`؛ `dm` → مستلم واحد |
| الفلترة | — | تخطَّ أي `username` غير مطابق لـ`/^[a-zA-Z0-9._]{1,30}$/` → `skipped` |

في وضع المنشن، عند نجاح تعليق دفعة: كل مستلمي الدفعة يُحدَّثون إلى `sent` مع `batch_index` و`sent_via_session_id` في **تحديث واحد** (`.in("id", ids)`), و`bumpCounter` يُنادى **مرة واحدة** (التعليق هو الفعل المحدود، لا الاسم). عند الفشل: الدفعة كلها تعود `pending` مع `attempts+1`.

**Step 4 — التوقف الآمن:** استخدم نفس فحص `workers.get(jobId) !== false` في رأس الحلقة وبعد كل `batch_pause` طويل، وفي `finally` أفرج عن كل السياقات بـ`igContextManager.releaseContext` (يعيد قفل الجلسة ويحفظ الكوكيز المُدوَّرة).

**Step 5 — أعد التشغيل + build:** المتوقع كل الاختبارات pass و`npm run build` أخضر.

**Step 6 — commit:**
```bash
git add extraction-service/src/services/ig-action-worker.ts extraction-service/src/services/__tests__/ig-action-worker.test.ts
git commit -m "feat(ig): action worker for mention batches and DM sends"
```

---

### Task 6: الـAPI — `/ig-actions/*`

**الهدف:** endpoints بنفس عقد `/messages/*` مع تحقق ملكية صريح (service-role يتجاوز RLS).

**Files:**
- Create: `extraction-service/src/routes/ig-actions.ts`
- Modify: `extraction-service/src/index.ts` (تسجيل الـrouter + `resumeIgActionJobs()` في نفس مكان `resumeMessageJobs()` عند السطر 93)

**Step 1 — Endpoints:**

`POST /ig-actions/preview` — `{ source_job_id, mode, body, mentions_per_comment? }` →
```
{ eligible, skipped_unsupported, mode, source_type,
  has_variation, comments_needed, est_hours, est_days, sample[] }
```
`comments_needed = ceil(eligible / mentions_per_comment)`؛ `est_hours = comments_needed / comments_per_hour / sessionsCount`. هذه الأرقام هي ما يراه المستخدم — **بلا أي ذكر لآليات داخلية** (لا shards ولا counters).

`POST /ig-actions/start` — تحقق بالترتيب:
1. مهمة المصدر موجودة و`type` يبدأ بـ`ig_` (رفض 400 لغير ذلك)
2. `ig_sessions` — موجودة، `deleted_at IS NULL`, `status='connected'`, ونفس `user_id` لمهمة المصدر
3. `session_ids` بين 1 و2
4. لا مهمة IG نشطة لهذا المستخدم (`platform='instagram'` + `status in (queued,running,paused)`) → 409
5. `mode='mention'` يستلزم `post_url` صالحاً (`/p/` أو `/reel/`) — يُخزَّن في `content.post_shortcode`
6. تجهيز المستلمين من `extraction_results` بـ`platform='instagram'` مع الترقيم 1000 صف/صفحة (نفس `materializeRecipients`) — المفتاح `data.username ?? fb_id`, يُطبَّع بحذف `@` و`/`
7. إدراج `message_jobs` بـ`platform='instagram'`, `mode`, `config` مقيَّد بالسقوف
8. إدراج المستلمين على دفعات 500
9. `startIgActionWorker(jobId)`

**قيد السقوف إلزامي عند الإنشاء** (لا نثق بالـclient):
```ts
mentions_per_comment: Math.min(input.mentions_per_comment ?? 4, 5),
comments_per_hour:    Math.min(input.comments_per_hour ?? 8, 12),
delay_min:            Math.max(input.delay_min ?? 380, 350),
daily_cap:            mode === "mention" ? Math.min(input.daily_cap ?? 60, 80)
                                         : Math.min(input.daily_cap ?? 15, 30),
```

`POST /ig-actions/pause|resume|stop` + `GET /ig-actions/:jobId` — نسخ حرفي لدلالات `messages.ts:209-256` مع الـworker الجديد.

**Step 2 — Zod schemas** بنفس نمط `pacingFields` في `messages.ts:17-27`، ورسائل الأخطاء عربية للمستخدم.

**Step 3 — التحقق الحقيقي عبر الـAPI** (لا قراءة كود):
```bash
API_KEY=$(grep '^API_KEY=' extraction-service/.env | cut -d= -f2 | tr -d '\r')
curl -s -X POST localhost:3100/ig-actions/preview -H "X-API-Key: $API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"source_job_id":"<igJobId>","mode":"mention","body":"تجربة","mentions_per_comment":4}'
```
المتوقع: JSON بـ`eligible > 0` و`comments_needed = ceil(eligible/4)`. لاحظ `tr -d '\r'` — إلزامي على Windows.

**Step 4 — build + commit:**
```bash
cd extraction-service && npm run build
git add extraction-service/src/routes/ig-actions.ts extraction-service/src/index.ts
git commit -m "feat(api): /ig-actions endpoints for mention and DM jobs"
```

---

### Task 7: الواجهة — repository + hook

**الهدف:** طبقة وصول للـAPI الجديد بنفس نمط `message-repository.ts`.

**Files:**
- Create: `src/lib/ig-actions/types.ts`
- Create: `src/lib/ig-actions/ig-action-repository.ts`
- Create: `src/hooks/useIgActions.ts`

**Step 1 — `types.ts`:** `IgActionMode = "mention" | "dm"`, `IgActionPacing` (بنفس شكل `MessagePacing` + `mentions_per_comment` + `comments_per_hour`), `IG_MENTION_DEFAULTS` / `IG_DM_DEFAULTS` **مطابقة لقيم الخادم**, `IgActionPreview`, `StartIgActionInput`, `IgActionJobDetails`. **لا `any`** (قاعدة المشروع).

**Step 2 — `ig-action-repository.ts`:** نسخ حرفي لبنية `message-repository.ts` (نفس `postJson` و`readFetchError`) بمسارات `/ig-actions/*`. **لا تكرّر** `postJson` — استخرجها إن لزم إلى `src/lib/api-client.ts` واستوردها في الملفين (DRY)، أو أبقِها محلية إن كان الاستخراج يمسّ مسار Messenger العامل (المبدأ: أقل تغيير آمن).

**Step 3 — `useIgActions.ts`:** `useIgActionJob(jobId)` بـ`refetchInterval` مشروط بالحالة (نفس `useMessageJobs.ts:12-15`), و`useIgActionPreview` (debounced في الصفحة لا في الـhook), و`useIgActions(jobId)` للـpause/resume/stop مع `invalidateQueries`. **Server state في React Query فقط** — لا تكرار في local state.

**Step 4 — typecheck:**
```
npm run typecheck
```
المتوقع: نجاح.

**Step 5 — commit:**
```bash
git add src/lib/ig-actions src/hooks/useIgActions.ts
git commit -m "feat(ui): ig-actions repository and hooks"
```

---

### Task 8: الواجهة — صفحة الإجراء (اختيار منشن/رسالة + composer + progress)

**الهدف:** صفحة واحدة `/dashboard/instagram/action/:jobId` تعرض الخيارين وتشغّل المهمة.

**Files:**
- Create: `src/pages/dashboard/instagram/IgActionPage.tsx`
- Modify: `src/routes/index.tsx` (lazy import + route جديد بعد السطر 102)

**Step 1 — الهيكل** (نفس تخطيط `MessageComposerPage.tsx`: `grid xl:grid-cols-5`, يسار composer بـ`xl:col-span-3`, يمين جلسات/pacing/preview بـ`xl:col-span-2`):

1. **اختيار الوضع** — بطاقتان بنفس نمط `sourceOptions` في `ExtractIgPage.tsx:214-242` (نفس `rounded-xl border-2`, نفس دائرة الاختيار, نفس `size-12` للأيقونة): «منشن في منشور» (`AtSign`) و«إرسال رسالة» (`Send`).
2. عند `mention`: حقل رابط المنشور بـ`InputIcon` + تحقق فوري (نفس نمط `buildSourceUrl` في `ExtractIgPage.tsx:76-79`) + رسالة خطأ حمراء تحت الحقل.
3. **Composer** — `textarea` بـ`dir="auto"` وعدّاد أحرف (منسوخ من `MessageComposerPage.tsx:135-148`) + تلميح spintax نفسه.
4. **الجلسات** — أعد استخدام `IgMultiSessionSelector` الموجود بدل بناء قائمة جديدة.
5. **الإعدادات** — للمنشن: «عدد الأسماء في التعليق الواحد» (1–5) و«التعليقات في الساعة» (1–12)؛ للرسالة: `daily_cap` و`rate_per_hour`. + checkbox ساعات الهدوء.
6. **المعاينة** — 3 بطاقات أرقام (`eligible`, `comments_needed`, `est_hours`) + عيّنات نص. للمنشن أضف تنبيه warning: التعليقات ستُنشر على منشورك المحدد.
7. **التقدم** — أعد استخدام نمط `MessageProgressInline` (شبكة 4 أرقام + progress bar بـ`role="progressbar"` و`aria-valuenow` + `aria-live="polite"`).

**Step 2 — الحالات الإلزامية (قاعدة المشروع):**
- Loading: `Skeleton` للمعاينة والجلسات
- Empty: لا جلسات متصلة → `EmptyState` مع رابط `/dashboard/instagram/sessions` (يوفّره `IgMultiSessionSelector` أصلاً)
- Empty: `preview.eligible === 0` → رسالة صريحة وتعطيل زر البدء
- Error: شريط أحمر بـ`role="alert"` (نفس `MessageComposerPage.tsx:291-295`)
- Hover/Focus: كل الأزرار عبر مكوّن `Button` القائم؛ الحقول بـ`focus:ring-2` كما في الصفحات الأخرى

**Step 3 — RTL:** استخدم `ms-/me-/ps-/pe-/start-/end-` فقط. الأيقونات الاتجاهية بـ`rtl:rotate-180`. **ملاحظة:** الملف الحالي `ExtractIgPage.tsx:297` يستخدم `rtl:rotate-180` وهو يعمل للـtransform؛ التزم بـ`i18n.language` لأي منطق تخطيط شرطي جديد (قاعدة المشروع تمنع الاعتماد على `rtl:` للتخطيط).

**Step 4 — التحقق:** `npm run typecheck && npm run lint && npm run build` — الثلاثة يجب أن تنجح.

**Step 5 — commit:**
```bash
git add src/pages/dashboard/instagram/IgActionPage.tsx src/routes/index.tsx
git commit -m "feat(ui): IG action page with mention/DM modes"
```

---

### Task 9: نقاط الدخول — زر على بطاقة المهمة وصفحة الاستخراج

**الهدف:** وصول المستخدم للميزة من حيث ينتهي الاستخراج فعلاً.

**Files:**
- Modify: `src/pages/dashboard/TasksPage.tsx` (الشرط عند السطر ~325)
- Modify: `src/pages/dashboard/extraction/ExtractIgPage.tsx` (بطاقة الإجراءات عند الاكتمال، السطر ~428)

**Step 1 — `TasksPage.tsx`:** استبدل الفرع الحالي الذي يعرض زراً **معطلاً** للـIG (`messaging.igUnsupported`) بزرين فعليين عندما `String(job.type).startsWith("ig_") && job.result_count > 0 && !job.isPublish && canDownload && !isEnriching`:
```tsx
<Button variant="primary" size="sm"
  onClick={() => navigate(`/dashboard/instagram/action/${job.id}?mode=mention`)}>
  <AtSign className="size-3.5" />{t("ig_actions.mentionButton")}
</Button>
<Button variant="secondary" size="sm"
  onClick={() => navigate(`/dashboard/instagram/action/${job.id}?mode=dm`)}>
  <Send className="size-3.5" />{t("ig_actions.dmButton")}
</Button>
```
**تحذير regression:** لا تلمس `canMessage(job)` ولا أي فرع FB — الشرط الجديد يُضاف كفرع `else if` مستقل للـIG فقط. أضف `AtSign` إلى import الأيقونات.

**Step 2 — `ExtractIgPage.tsx`:** في بطاقة الإجراءات عند الاكتمال، أضف الزرين بعد أزرار التنزيل بنفس الأنماط (`variant="primary"` / `"secondary"`). الشرط: `activeJob?.result_count > 0`.

**Step 3 — التحقق:** `npm run typecheck && npm run build` + فتح الصفحتين فعلياً في المتصفح والتنقل عبر الزرين.

**Step 4 — commit:**
```bash
git add src/pages/dashboard/TasksPage.tsx src/pages/dashboard/extraction/ExtractIgPage.tsx
git commit -m "feat(ui): mention/DM entry points on IG task cards"
```

---

### Task 10: الترجمات (ar + en)

**الهدف:** كل نص جديد له مفتاح في الملفين، بنفس **شكل** الاستدعاء.

**Files:**
- Modify: `src/i18n/locales/ar.json`
- Modify: `src/i18n/locales/en.json`

**Step 1 — أضف قسم `ig_actions`** يحتوي: `title`, `subtitle`, `mentionButton`, `dmButton`, `mode.mention`, `mode.mentionDesc`, `mode.dm`, `mode.dmDesc`, `postUrlPlaceholder`, `invalidPostUrl`, `bodyPlaceholder`, `settings.*`, `preview.*`, `warn.*`, `progress.*`, `status.*`, `startButton`, `starting`, `startedTitle`, `startedDesc`.

**Step 2 — فخ حرج (مثبت في مهارة المشروع):** أي مفتاح يُستدعى بمسار منقّط ديناميكي مثل `` t(`ig_actions.status.${status}`) `` **يجب** أن يكون كائناً متداخلاً في JSON:
```json
"status": { "queued": "...", "running": "...", "paused": "...",
            "completed": "...", "failed": "...", "canceled": "..." }
```
لا `statusRunning` مسطّحاً — وإلا يُطبع المفتاح الخام على الشاشة (نفس ما حدث مع `ig_extract.status.*`). أضف `statusLabel` منفصلاً للعنوان.

**Step 3 — لغة المستخدم:** الأرقام والعبارات فقط. **يُحظر** ذكر آليات داخلية للمستخدم (لا "counters" ولا "shards" ولا "cooldown"). مثال مقبول: «تم الإرسال 40 من 120 — الوقت المتوقع للانتهاء: 3 ساعات».

**Step 4 — تحقق البنية:**
```
python -c "import json,io; [json.load(io.open(f'src/i18n/locales/{l}.json',encoding='utf-8')) for l in ('ar','en')]; print('JSON OK')"
```
ثم افتح الصفحة بالعربية والإنجليزية وتأكد بصرياً أن لا مفتاح خام ظاهر.

**Step 5 — commit:**
```bash
git add src/i18n/locales/ar.json src/i18n/locales/en.json
git commit -m "feat(i18n): ig_actions keys (ar+en)"
```

---

### Task 11: تشغيل حقيقي بأدلة رقمية (شرط اعتبار المهمة مكتملة)

**الهدف:** إثبات أن الميزتين تعملان فعلاً — لا "لا يوجد syntax error".

**Step 1 — إعادة تشغيل الخدمة بأمان.** اقتل بالمنفذ لا بالنمط (فخ مثبت: `pkill -f 'tsx src/index.ts'` يفشل والخدمة القديمة تبقى تخدم كوداً قديماً):
```
powershell -Command "Get-NetTCPConnection -LocalPort 3100 | Select OwningProcess"
powershell -Command "taskkill /PID <n> /F /T"
curl -s localhost:3100/health          # يجب أن يفشل الاتصال قبل الإطلاق
```
ثم أطلق الخدمة، وبعدها **ابحث في اللوج عن `EADDRINUSE`** — وجوده يعني أنك أطلقت جسة ميتة والاختبار يجري على الكود القديم.

**Step 2 — اختبار المنشن.** جلسة IG واحدة `connected` + مهمة IG منتهية بـ`result_count >= 12` + منشور **تملكه**:
```
POST /ig-actions/start { mode:"mention", mentions_per_comment:4, comments_per_hour:8, ... }
```
راقب اللوج والـDB. الأدلة المطلوبة:
- عدد التعليقات المنشورة = `ceil(sent/4)` — يُتحقق منه بصرياً على المنشور
- الفاصل الزمني بين التعليقات ≥ 350 ثانية (من `sent_at` في `message_recipients`)
- `progress.sent + failed + skipped` = عدد المستلمين المعالَجين
- لا صف `sent` بلا `sent_via_session_id`

استعلام الإثبات:
```sql
select mode, status, progress, session_ids from message_jobs where id='<jobId>';
select status, count(*) from message_recipients where message_job_id='<jobId>' group by status;
select batch_index, count(*), min(sent_at), max(sent_at)
from message_recipients where message_job_id='<jobId>' and status='sent'
group by batch_index order by batch_index;
```

**Step 3 — اختبار الرسالة.** نفس المهمة المصدر، `mode='dm'`, `daily_cap=3` (اختبار مقصود صغير). الأدلة: 3 صفوف `sent` بفواصل ≥ 90 ثانية، ووصول الرسائل فعلياً على الحساب المستهدف.

**Step 4 — اختبار الاستئناف.** أثناء التشغيل: أوقف الخدمة، أعد إطلاقها، وتحقق أن `resumeIgActionJobs()` استأنفت المهمة وأن **لا مستلم أُرسل له مرتين**:
```sql
select fb_id, count(*) from message_recipients
where message_job_id='<jobId>' and status='sent' group by fb_id having count(*) > 1;
-- expected: 0 rows
```

**Step 5 — اختبار عدم الـregression على Messenger.** شغّل مهمة `/messages/start` قصيرة على FB وتحقق أنها تعمل كما قبل، وأن مهمة IG نشطة **لا** تحجبها (بفضل توسيع الـtrigger إلى `(user_id, platform)`).

**Step 6 — تنظيف.** احذف مهام الاختبار من `message_jobs` (الـCASCADE يحذف المستلمين) وأي تعليقات اختبارية من المنشور.

**Step 7 — الجدول النهائي المطلوب تسليمه للمستخدم:**

| المقياس | منشن | رسالة |
|---|---|---|
| المستلمون المعالَجون | | |
| التعليقات/الرسائل المنشورة | | |
| متوسط الفاصل الزمني (ث) | | |
| فشل / تخطٍّ | | |
| إشارات حظر | | |
| نجح الاستئناف بلا تكرار | | |

---

### Task 12: مراجعة الكود + الـdiff النهائي

**Step 1 — استخدم مهارة `requesting-code-review`** على كل التغييرات. الأولويات: تسريب أسرار، حدود المعدل، أمان الملكية، صحة أنواع TypeScript.

**Step 2 — أصلح المشاكل الحقيقية فقط** التي تظهر في المراجعة (لا refactor تجميلي).

**Step 3 — البوابات النهائية:**
```
npm run typecheck && npm run lint && npm run build
cd extraction-service && npm run build
cd extraction-service && npx tsx --test 'src/services/__tests__/*.test.ts' 'src/extractors/__tests__/*.test.ts'
```
الأربعة يجب أن تنجح.

**Step 4 — مراجعة الـdiff للتغييرات غير المرتبطة:**
```
git status
git diff --stat main...HEAD
```
تأكد أن **لا** ملف خارج القائمة المتوقعة تغيّر. **تحذير:** الريبو به ملفات غير متتبَّعة وسرّية (`pass.txt`, `.env`, `captcha.png`) — لا تستخدم `git add .` أبداً؛ أضف بالمسار الصريح فقط.

**Step 5 — النشر (بعد موافقة صريحة):** `git push origin main` إلى `a4rbcom-maker/flowtix-social-connect-dad4fa55`. لا تعلن "نُشر" قبل أن يعرض run على نفس `head_sha` النتيجة `conclusion: success`. ثم أخبر المستخدم بـ`Ctrl+Shift+R` (أصول Vite مُخزَّنة سنة كاملة).

---

## 5) الملفات المتوقع تغييرها

### تُنشأ
```
supabase/migrations/2026082920_ig_message_actions.sql
extraction-service/src/debug-ig-comment.ts
extraction-service/src/debug-ig-dm.ts
extraction-service/src/services/ig-action-pacing.ts
extraction-service/src/services/ig-comment-sender.ts
extraction-service/src/services/ig-dm-sender.ts
extraction-service/src/services/ig-action-worker.ts
extraction-service/src/services/__tests__/ig-action-pacing.test.ts
extraction-service/src/services/__tests__/ig-action-worker.test.ts
extraction-service/src/routes/ig-actions.ts
src/lib/ig-actions/types.ts
src/lib/ig-actions/ig-action-repository.ts
src/hooks/useIgActions.ts
src/pages/dashboard/instagram/IgActionPage.tsx
```

### تُعدَّل (تعديلات جراحية صغيرة)
```
extraction-service/src/index.ts               # router + resumeIgActionJobs()
src/routes/index.tsx                          # lazy import + route
src/pages/dashboard/TasksPage.tsx             # فرع IG المستقل
src/pages/dashboard/extraction/ExtractIgPage.tsx  # زران عند الاكتمال
src/i18n/locales/ar.json / en.json            # قسم ig_actions
```

### لا تُلمَس مطلقاً
```
extraction-service/src/services/message-worker.ts
extraction-service/src/services/message-sender.ts
extraction-service/src/routes/messages.ts
extraction-service/src/services/message-pacing.ts   # قراءة/استيراد فقط
extraction-service/src/extractors/*                 # كل مسارات الاستخراج
extraction-service/src/services/publish-worker.ts
extraction-service/src/wa/*
src/lib/messaging/*
```

## 6) الاختبار والتحقق

| الطبقة | الأداة | معيار النجاح |
|---|---|---|
| pacing نقي | `npx tsx --test 'src/services/__tests__/ig-action-pacing.test.ts'` | 6/6 pass |
| منطق الـworker | `npx tsx --test 'src/services/__tests__/ig-action-worker.test.ts'` | كل الحالات pass بلا متصفح |
| DOM | probes حيّة (Task 0/3/4) | `{ ok: true }` + تحقق بصري |
| API | `curl /ig-actions/preview` + `start` | JSON صحيح + مهمة في الـDB |
| E2E | تشغيل حقيقي (Task 11) | الجدول الرقمي مكتمل |
| Frontend | `typecheck` + `lint` + `build` | ثلاثتها خضراء |
| Service | `npm run build` | أخضر (يشمل ملفات الاختبار) |
| Regression | مهمة Messenger قصيرة | تعمل كما قبل |
| RTL/i18n | فتح بالعربية والإنجليزية | لا مفتاح خام ظاهر |

## 7) المخاطر والمقايضات والأسئلة المفتوحة

### مخاطر
| المخاطرة | التخفيف |
|---|---|
| **`action_blocked` على حساب المستخدم** — الأخطر. القيم فوق الحد تحرق الحساب | افتراضات 30% أسفل الحد؛ سقوف مقيَّدة **في الخادم** لا الـclient؛ cooldown 24س عند أول إشارة؛ توقف `paused` عند حظر الجلستين |
| **تغيّر DOM إنستجرام** يعطّل الـselectors صامتاً | Task 0 مانعة؛ تأكيد تسليم إيجابي (ليس غياب خطأ)؛ تدوين الأشكال في مهارة المشروع بتاريخها |
| **إزعاج المذكورين** → تقارير spam على حساب المستخدم | تنبيه واضح قبل البدء؛ افتراضي 4 أسماء/تعليق؛ التعليق على منشور المستخدم نفسه |
| **regression على Messenger** بسبب الجدول المشترك | أعمدة بـdefaults تحفظ السلوك؛ worker وrouter منفصلان تماماً؛ Task 11 Step 5 اختبار صريح |
| **خدمة قديمة على 3100** تجعل نتائج الاختبار كاذبة | القتل بالمنفذ + فحص `EADDRINUSE` + التحقق من سطر لوج يخصّ الكود الجديد فقط |
| **جلسة مقفلة** (`acquireSessionLock`) إذا كان الاستخراج يعمل | خطأ `SESSION_IN_USE` واضح؛ رسالة عربية تطلب انتظار انتهاء الاستخراج |

### مقايضات
- **جدول مشترك بدل جدول جديد:** أقل كوداً وأقل سطح خطأ، مقابل جدول أعرض قليلاً. الرابح واضح.
- **DOM بدل private API:** أبطأ، مقابل عدم استخدام endpoints غير موثقة قابلة للتعطّل والحرق.
- **بطء مقصود:** 8 تعليقات/ساعة تعني أن 500 مستخرَج يستغرقون ~16 ساعة عبر جلستين. البديل — سرعة أعلى — يعني حظراً. البطء هو الميزة هنا، ويجب أن تعبّر الواجهة عن الوقت المتوقع بصدق.

### أسئلة مفتوحة (تحتاج قرار المستخدم)
1. **منشور المنشن:** المستخدم يلصق الرابط يدوياً، أم نجلب منشوراته الأخيرة في قائمة اختيار؟ (الخطة تفترض اللصق اليدوي — الأبسط والأقل مساساً).
2. **نص التعليق مع الأسماء:** الأسماء قبل النص أم بعده؟ (الخطة تفترض النص ثم الأسماء).
3. **الحساب الخاص في الـDM:** تخطٍّ صامت أم عرضه في تقرير المتخطَّين؟ (الخطة تفترض `skipped` مع سبب ظاهر في التفاصيل).
4. **هل يُسمح بمهمة منشن ومهمة DM معاً؟** الخطة الحالية: **لا** — مهمة IG واحدة نشطة لكل مستخدم (حماية للحساب). إن أراد المستخدم السماح، يصبح نطاق الـtrigger `(user_id, platform, mode)`.











