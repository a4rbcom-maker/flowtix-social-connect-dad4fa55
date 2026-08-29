# خطة تنفيذ: مراسلة الداتا المستخرجة من فيسبوك (Messenger Broadcast)

> **For Hermes:** استخدم `subagent-driven-development` لتنفيذ هذه الخطة مهمة بمهمة، ثم `requesting-code-review`.

**Goal:** إضافة إرسال رسائل فيسبوك (نص + صورة/فيديو) لأي داتا مستخرجة — من كل مسارات الاستخراج المتاحة — بزر "مراسلة" في كل بطاقة مهمة، مع محرك إرسال حقيقي مضاد للحظر يعمل بالجلسات المتعددة ولا يضغط على الخادم.

**Architecture:** نكرّر بالحرف نمط `publish_jobs` + `publish-worker.ts` الموجود والمُجرَّب (Playwright + جدول job + progress/checkpoint + routes للتحكم)، لكن مع جدول مستلمين حقيقي (`message_recipients`) على نمط `wa_campaign_recipients` لأن العدد بالآلاف ولازم resume دقيق. الإرسال داخل الـ extraction-service (نفس `contextManager` / `browserPool` / نفس بصمة الجلسة)، والفرونت يستهلك API جديد `/messages/*` بنفس شكل `/publish/*`.

**Tech Stack:** Express + Playwright + Supabase (extraction-service) · React 19 + TanStack Query + i18next RTL (frontend) · zod للتحقق · Supabase Storage للمرفقات.

---

## 1) نتيجة الفحص — ما هو موجود فعلاً وما هو معطّل

هذا القسم مبني على قراءة الكود الفعلي، لا على تخمين.

### 1.1 المسار الحالي "موجود لكن لا يعمل" — مُثبت
| الملف | الحالة الحقيقية |
|---|---|
| `extraction-service/src/routes/extract.ts:688-728` (`POST /broadcast`) | **stub**. يقرأ النتائج، ثم يكتب `config.broadcast_message` + `broadcast_requested_at` على الـ job ويرجع `status: "queued"`. **لا يوجد أي إرسال فعلي**. التعليق في الكود نفسه يقول: `Full Playwright-based sending will be implemented in a future update`. |
| `src/pages/dashboard/messenger/MessengerBroadcastPage.tsx` | يستدعي `/broadcast` ثم يعرض "تم بدء الإرسال بنجاح!" — **نجاح كاذب**. لا رفع مرفقات، لا تقدّم، لا سجل، لا إيقاف. `job` مكتوب `any`، بدون i18n (نصوص عربية hardcoded). |
| `src/pages/dashboard/TasksPage.tsx:318-322` | زر "إرسال رسالة" ظاهر **فقط** إذا `job.type === "messenger_contacts"` وبعد `canDownload`. باقي المسارات (groups / pages / post_comments / post_reactions / IG) لا يوجد لها زر. |
| `src/routes/index.tsx:101` | الراوت `messenger/broadcast/:jobId` موجود ويعمل. |

**الخلاصة:** الواجهة والراوت موجودان، والمحرك غير موجود. فالمطلوب ليس "إصلاح" بل **بناء محرك الإرسال** + توسيع الواجهة.

### 1.2 شكل الداتا المستخرجة (يحدد كيف نرسل)
- `extraction_results`: `job_id, fb_id, fb_type, platform, data(jsonb), user_id`. لا يوجد `workspace_id` فعّال (أُسقط في migration `2026072716`) — **النطاق هو `user_id`**.
- `data` = `{ name, profile_url, avatar_url, username?, comment_text?... }`.
- **مهم:** مستخرج الماسنجر يخزّن `fb_id = "msg_<numericId>"` و `profile_url = ""` (`messenger-contacts.ts` → `flushContacts`). أي إرسال لازم **يشيل بادئة `msg_`** ويبني `https://www.facebook.com/messages/t/<id>`.
- باقي المسارات (`groups`/`pages`/`post_*`) تخزّن `fb_id` رقمي أو username مع `profile_url` كامل (`base.ts:93,118,311`).
- `platform = "instagram"` للنتائج الانستجرامية — **خارج نطاق هذه الخطة** (الإرسال IG DM مسار مختلف تماماً؛ الزر يُعرض معطّلاً مع تلميح).

### 1.3 الأصول القابلة لإعادة الاستخدام (لا نعيد كتابتها)
- `services/publish-worker.ts` — النمط الكامل: worker map، batch + `BATCH_PAUSE`، delay عشوائي `delay_min..delay_max`، `saveCheckpoint` كل 5، `consecutiveErrors >= max_errors` → توقف، `contextManager.createContext/releaseContext` في `finally`.
- `routes/publish.ts` — نمط `start/pause/resume/stop` + منع أكثر من مهمة نشطة للمستخدم (409 `JOB_ALREADY_ACTIVE`).
- `wa/campaign-worker.ts` — نمط **النافذة الزمنية المنزلقة** (`sentWindow` + `rate_per_hour`) ونمط المرفق عبر `createSignedUrl`.
- `wa/routes.ts:104-117` — نمط `multer` upload إلى Supabase Storage (bucket `wa-media`).
- `services/context-manager.ts` — قفل جلسة داخلي `fb:<sessionId>` (`acquireSessionLock`)، بصمة جهاز ثابتة لكل جلسة، حفظ `storageState` دوري. **الجلسة لا يمكن استخدامها من سياقين في نفس الوقت** — قيد أساسي في التصميم.
- `extractors/base.ts:489-527` — `switchToNextSession()` مع فحص `page.isClosed()` وترتيب المرشحين ثم الرجوع للـ primary. نفس المنطق يُستعار للمُرسل (بدون تعديل الملف).
- `src/pages/dashboard/groups/ProgressDashboard.tsx` — نمط polling كل 3 ث + شارات حالة + سجل نشاط. سنعمل نظيره للرسائل.

### 1.4 قيود مثبتة من الكود/الـ DB
- `browserPool` = `BROWSER_POOL_SIZE=2`، `maxConcurrentJobs=2` → أي محرك إرسال يجب أن **لا** ينافس الاستخراج على المتصفحات.
- trigger `enforce_fb_sessions_limit` → **حد أقصى جلستان FB لكل مستخدم** (`2026082310_per_user_limits.sql`). إذاً "أكثر من جلسة" = جلستان واقعياً.
- `enforce_extraction_jobs_running_limit` يخص `extraction_jobs` فقط — جدول الرسائل الجديد لا يتأثر (لكن سنضع حداً خاصاً به).
- API الخدمة محمي بـ `X-API-Key` على كل المسارات ما عدا `/health` (`index.ts:41-48`).


---

## 2) أفضل آلية إرسال ضد الحظر (القرار الهندسي + السبب)

### 2.1 الحقائق التي تحكم التصميم
من فحص سياسات ميتا وسلوك المنصة (مصادر 2026):
- **الرسائل من حساب شخصي لأشخاص غير أصدقاء** تدخل في `message requests` وحدّها اليومي منخفض جداً (تقارير متكررة: **5 رسائل/يوم**، وأحياناً واحدة). أي "10 رسائل كل فترة" من حساب شخصي = حظر مؤكد.
- **صفحات الأعمال (Page inbox)**: النافذة القياسية **24 ساعة** من آخر رسالة للمستخدم؛ خارجها مسموح فقط بـ Message Tags (وHuman Agent = 7 أيام)، والاستخدام خارج الحالات المعتمدة يؤدي لتقييد الإرسال.
- الأسباب المُعلنة للتقييد: **إرسال كثير في وقت قصير** + **نفس النص لأشخاص كثيرين**.

### 2.2 القرار
**نستهدف — كافتراضي — جهات اتصال الماسنجر (`messenger_contacts`) لأنهم من راسلوا الصفحة فعلاً (داخل النافذة)، ونعتبر باقي المسارات "إرسال بارد" عالي الخطورة نحكمه بحدود متحفظة جداً + تحذير صريح في الـ UI.**

آلية الإرسال (بديل مقترحك "10 رسائل ثم انتظار"، أقوى منه):

1. **قناة الإرسال:** واجهة `facebook.com/messages/t/<id>` داخل نفس سياق Playwright للجلسة (نفس البصمة/الكوكيز/البروكسي). لا Graph API — لا يوجد Page Access Token في المشروع (`facebook_accounts.access_token_enc` غير مستخدم في الخدمة).
2. **حد يومي صارم لكل جلسة (day-key UTC، ليس rolling):** `daily_cap` افتراضي **40** للماسنجر و **15** للإرسال البارد، سقف صلب 80. العدّاد في `message_send_counters(session_id, day_key)`.
3. **نافذة منزلقة/ساعة:** `rate_per_hour` افتراضي **12**، سقف 20 (نفس نمط `sentWindow` في `campaign-worker.ts`).
4. **تباعد عشوائي غير منتظم:** `delay_min=45s`, `delay_max=150s` + jitter ±20% (لا رقم ثابت — الانتظام نفسه بصمة آلية).
5. **دفعات + راحة طويلة:** `batch_size=8` ثم `batch_pause=900s` (15 د).
6. **راحة ليلية:** لا إرسال بين 01:00–07:00 بتوقيت القاهرة (`quiet_hours`) — الإرسال ليلاً بمعدل ثابت أوضح إشارة آلية.
7. **تنويع النص إلزامي (spintax):** `{مرحبا|أهلاً|السلام عليكم}` + `{{name}}` — نفس النص حرفياً لكل الناس هو السبب الأول المعلن للحظر. **إذا لم يحتوِ النص على متغيّر أو بديل واحد على الأقل → تحذير في الـ UI قبل البدء.**
8. **توزيع على الجلستين (round-robin ذكي، ليس تقسيم ثابت):** كل جلسة لها عدّادها الخاص؛ المُرسل يختار الجلسة التالية **الأقل استهلاكاً** التي لم تبلغ `daily_cap`/`rate_per_hour` وصفحتها `!isClosed()`. لو كل الجلسات مستنفدة → الحالة `paused` + `stop_reason='daily_cap_reached'` بدل الفشل.
9. **كسر تلقائي (circuit breaker):** أي إشارة تقييد ("You've reached the message request limit" / "Message not sent" / checkpoint / تحويل لـ `login`) → **إيقاف الجلسة فوراً** (`session_cooldown_until = now + 24h`) والتحويل للجلسة الأخرى؛ لو لا يوجد بديل → `paused`. **لا إعادة محاولة على نفس الجلسة.**
10. **سلوك بشري خفيف قبل الإرسال:** فتح المحادثة → انتظار 1.5-4s → الكتابة بـ `type({delay: 40-90ms})` وليس `innerText=` → انتظار → Enter. (`publish-worker.ts` يستخدم `innerText=` وهو أضعف؛ للرسائل نستخدم الكتابة الحقيقية.)
11. **ضغط الخادم:** المُرسل **يستهلك سياق متصفح واحد لكل جلسة** ويحتفظ به لكل المهمة (لا فتح/إغلاق لكل رسالة)، وبما أن التباعد ≥45s فمعدل الطلبات ضئيل. حد صلب: **مهمة رسائل نشطة واحدة فقط لكل مستخدم** + `MAX_MESSAGE_JOBS_GLOBAL=2`.

### 2.3 الأرقام النهائية (defaults)
| المتغير | افتراضي | سقف | ملاحظة |
|---|---|---|---|
| `daily_cap` (لكل جلسة) | 40 (ماسنجر) / 15 (بارد) | 80 | day-key UTC |
| `rate_per_hour` | 12 | 20 | نافذة منزلقة |
| `delay_min` / `delay_max` | 45s / 150s | 600s | + jitter ±20% |
| `batch_size` / `batch_pause` | 8 / 900s | 30 / 3600s | |
| `quiet_hours` | 01:00–07:00 Cairo | — | قابل للإلغاء |
| `max_errors` | 5 | 20 | consecutive |
| `retry_max` | 2 | 3 | لكل مستلم، ليس للجلسة المقيَّدة |

**الإنتاجية الواقعية:** جلستان × 40 = **~80 رسالة/يوم** بأمان. أي رقم أعلى = مقايضة بالحظر، وسنقولها للمستخدم في الـ UI بدل إخفائها.


---

## 3) الملفات: ما يُعدَّل وما لا يُلمس

### تُنشأ (جديدة)
```
supabase/migrations/2026082910_message_jobs.sql
extraction-service/src/services/message-worker.ts
extraction-service/src/services/message-sender.ts        # منطق DOM للإرسال فقط
extraction-service/src/routes/messages.ts
extraction-service/src/services/__tests__/message-pacing.test.ts
src/lib/messaging/types.ts
src/lib/messaging/message-repository.ts
src/hooks/useMessageJobs.ts
src/pages/dashboard/messenger/MessageComposerPage.tsx     # يحل محل MessengerBroadcastPage
src/pages/dashboard/messenger/MessageProgressPanel.tsx
```

### تُعدَّل (تعديل جراحي)
| الملف | التغيير |
|---|---|
| `extraction-service/src/index.ts` | سطر import + `app.use("/", messagesRouter)` + `resumeMessageJobs()` في boot |
| `extraction-service/src/routes/extract.ts` | **حذف** `POST /broadcast` + `broadcastSchema` (stub كاذب) — يُستبدل بـ `/messages/start` |
| `extraction-service/src/config.ts` | مفاتيح `msg*` الجديدة (نفس نمط `envInt`) |
| `extraction-service/src/errors.ts` | كودات: `MESSAGE_JOB_ACTIVE`, `DAILY_CAP_REACHED`, `NO_SENDABLE_RECIPIENTS` |
| `src/routes/index.tsx` | استبدال lazy import للصفحة + الحفاظ على نفس المسار `messenger/broadcast/:jobId` (توافق خلفي) + مسار جديد `messenger/compose/:jobId` |
| `src/pages/dashboard/TasksPage.tsx` | زر "مراسلة" لكل بطاقة FB بها نتائج (لا `messenger_contacts` فقط) + تعطيل مع tooltip لـ IG |
| `src/pages/dashboard/extraction/ExtractContactsPage.tsx` | `handleBroadcast` → المسار الجديد |
| `src/i18n/locales/ar.json` / `en.json` | مفاتيح `messaging.*` (شكل نقطي مطابق لما يناديه الكود) |
| `src/types/database.types.ts` | إضافة أنواع `message_jobs` / `message_recipients` / `message_send_counters` |

### لا تُلمس إطلاقاً
`extractors/**` (كل المستخرجات) · `services/publish-worker.ts` · `routes/publish.ts` · `wa/**` · `services/enrichment-*.ts` · `services/job-queue.ts` · `services/context-manager.ts` · `services/browser-pool.ts` · أي migration قديم.

> **سبب:** الميزة إرسال، والاستخراج مستقر ومُجرَّب. أي لمسة في `extractors/` أو `context-manager` = خطر regression على مسارات تعمل.


---

## 4) خطة التنفيذ خطوة بخطوة

### Task 0: إثبات المسار قبل بناء أي شيء (probe — إلزامي)
**Objective:** إثبات أن الإرسال من `messages/t/<id>` يعمل فعلاً بجلسة حقيقية، وتسجيل الـ selectors الحقيقية. **بدون هذا لا نكتب المُرسل.**

**Files:** `extraction-service/src/debug-msg-send.ts` (probe مؤقت، يُحذف في Task 7)

**Step 1** — اكتب probe (نمط `debug-ig-dialog.ts`): `await browserPool.init()` أولاً، ثم `contextManager.createContext(sessionId, ...)`، `goto('https://www.facebook.com/messages/t/<REAL_ID>')`، ثم dump:
- هل يوجد `div[role="textbox"][contenteditable="true"]`؟ وما `aria-label` الفعلي؟
- هل يوجد زر إرسال (`[aria-label*="Send"]`, `[aria-label*="إرسال"]`)؟
- هل يوجد زر مرفقات (`input[type="file"]`)؟ وما `accept`؟
- نص أي بانر تقييد ظاهر.

> **مصيدة (من مهارة المشروع):** استخدم `page.evaluate(\`(() => {...})()\`)` كنص template وليس دالة — tsx يحقن `__name` فيسبب `ReferenceError`.

**Step 2** — شغّل على `PORT=3200` (لا 3100 أبداً)، بعد التأكد بـ `Get-NetTCPConnection -LocalPort 3200` أن البورت فاضي.
Run: `cd extraction-service && PORT=3200 npx tsx src/debug-msg-send.ts`
Expected: طبع الـ selectors الحقيقية + **رسالة واحدة تجريبية وصلت فعلاً** (تحقق بصرياً).

**Step 3** — سجّل النتيجة في الخطة (قسم "نتائج الـ probe") قبل المتابعة. لو الـ textbox غير موجود ⇒ توقف واستخدم `systematic-debugging`؛ لا تخمّن selector.

**Step 4** — Commit: `git add extraction-service/src/debug-msg-send.ts && git commit -m "chore(msg): live probe for messenger send DOM"`

---

### Task 1: Migration — جداول الرسائل
**Objective:** جداول `message_jobs` + `message_recipients` + `message_send_counters` مع RLS على `user_id`.

**Files:** Create `supabase/migrations/2026082910_message_jobs.sql`

**Step 1** — اكتب الـ migration:
```sql
CREATE TABLE IF NOT EXISTS public.message_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_job_id uuid REFERENCES public.extraction_jobs(id) ON DELETE SET NULL,
  name text,
  status text NOT NULL DEFAULT 'queued',
  session_ids uuid[] NOT NULL DEFAULT '{}',
  content jsonb NOT NULL DEFAULT '{}',   -- {body, media_keys[], media_mime[]}
  config  jsonb NOT NULL DEFAULT '{}',   -- pacing
  progress jsonb NOT NULL DEFAULT '{}',  -- {sent,failed,skipped,current_idx,stop_reason}
  started_at timestamptz, completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.message_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_job_id uuid NOT NULL REFERENCES public.message_jobs(id) ON DELETE CASCADE,
  fb_id text NOT NULL,
  thread_id text NOT NULL,          -- fb_id بعد إزالة بادئة msg_
  name text,
  status text NOT NULL DEFAULT 'pending',  -- pending|sent|failed|skipped
  attempts int NOT NULL DEFAULT 0,
  sent_via_session_id uuid,
  error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_message_recipients_job_fb
  ON public.message_recipients (message_job_id, fb_id);
CREATE INDEX IF NOT EXISTS idx_message_recipients_pick
  ON public.message_recipients (message_job_id, status, attempts);

CREATE TABLE IF NOT EXISTS public.message_send_counters (
  session_id uuid NOT NULL,
  day_key date NOT NULL,
  sent_count int NOT NULL DEFAULT 0,
  cooldown_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, day_key)
);
```
+ `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` على الثلاثة، وسياسات:
- `message_jobs`: `user_id = auth.uid() OR is_super_admin()` للأربع عمليات (نفس نمط `2026072817`).
- `message_recipients`: عبر `EXISTS (SELECT 1 FROM message_jobs j WHERE j.id = message_job_id AND j.user_id = auth.uid())`.
- `message_send_counters`: SELECT فقط للمالك عبر `fb_sessions`; الكتابة للـ service_role.
+ trigger `enforce_message_jobs_active_limit()` → مهمة نشطة واحدة (`queued|running|paused`) لكل مستخدم، تُرفع `P0001` برسالة عربية (نفس نمط `enforce_fb_sessions_limit`).

**Step 2** — طبّق عبر Management API (راجع `references/supabase-management-api.md`) **بيان بيان**، ثم أثبت:
```sql
select table_name from information_schema.tables where table_name like 'message_%';
select count(*) from pg_policies where tablename like 'message_%';
```
Expected: 3 جداول، ≥9 سياسات.

**Step 3** — Commit: `feat(db): message_jobs/recipients/counters + RLS + active-job trigger`

> **مصيدة:** `message_jobs.status` هو **text** وليس enum مقصوداً — لتجنّب مصيدة `ALTER TYPE ... ADD VALUE` التي كلّفت المشروع وقتاً في `extraction_jobs.type`.


---

### Task 2: دوال pacing نقية + اختبارها (TDD أولاً — لا متصفح)
**Objective:** كل منطق ضد الحظر في دوال نقية قابلة للاختبار قبل لمس Playwright.

**Files:** Create `extraction-service/src/services/message-pacing.ts` · Test `extraction-service/src/services/__tests__/message-pacing.test.ts`

**Step 1 — اكتب الاختبار الفاشل أولاً:**
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { dayKeyUtc, nextDelayMs, renderTemplate, isQuietHour, pickSession, detectBlockSignal } from "../message-pacing.js";

test("dayKeyUtc is calendar-day UTC, not rolling 24h", () => {
  assert.equal(dayKeyUtc(new Date("2026-08-29T23:59:00Z")), "2026-08-29");
  assert.equal(dayKeyUtc(new Date("2026-08-30T00:01:00Z")), "2026-08-30");
});

test("nextDelayMs stays in range with jitter and never repeats exactly", () => {
  const vals = Array.from({ length: 50 }, () => nextDelayMs(45, 150));
  for (const v of vals) { assert.ok(v >= 36_000 && v <= 180_000, `out of range: ${v}`); }
  assert.ok(new Set(vals).size > 40, "delays look deterministic");
});

test("renderTemplate resolves {{name}} and spintax", () => {
  const out = renderTemplate("{مرحبا|أهلا} {{name}}", { name: "خالد" });
  assert.ok(out === "مرحبا خالد" || out === "أهلا خالد", out);
});

test("renderTemplate flags a non-varying template", () => {
  assert.equal(renderTemplate.hasVariation("نص ثابت"), false);
  assert.equal(renderTemplate.hasVariation("{a|b} نص"), true);
});

test("isQuietHour blocks 01:00-07:00 Cairo", () => {
  assert.equal(isQuietHour(new Date("2026-08-29T00:30:00Z")), true);  // 03:30 Cairo
  assert.equal(isQuietHour(new Date("2026-08-29T09:00:00Z")), false); // 12:00 Cairo
});

test("pickSession skips capped, cooling-down and closed sessions", () => {
  const chosen = pickSession([
    { sessionId: "a", sentToday: 40, dailyCap: 40, sentLastHour: 0, ratePerHour: 12, cooldownUntil: null, closed: false },
    { sessionId: "b", sentToday: 5,  dailyCap: 40, sentLastHour: 0, ratePerHour: 12, cooldownUntil: null, closed: false },
  ]);
  assert.equal(chosen?.sessionId, "b");
  assert.equal(pickSession([{ sessionId: "a", sentToday: 40, dailyCap: 40, sentLastHour: 0, ratePerHour: 12, cooldownUntil: null, closed: false }]), null);
});

test("detectBlockSignal recognizes FB restriction copy (ar + en)", () => {
  assert.equal(detectBlockSignal("You've reached the message request limit"), "rate_limited");
  assert.equal(detectBlockSignal("لا يمكنك إرسال رسائل الآن"), "rate_limited");
  assert.equal(detectBlockSignal("Log in to Facebook"), "session_dead");
  assert.equal(detectBlockSignal("hello there"), null);
});
```

**Step 2** — شغّله للتأكد من الفشل:
Run: `cd extraction-service && npx tsx --test "src/services/__tests__/message-pacing.test.ts"`
Expected: FAIL — `Cannot find module '../message-pacing.js'`

**Step 3** — اكتب أقل تنفيذ يُنجح الاختبارات في `message-pacing.ts` (دوال نقية فقط: `dayKeyUtc`, `nextDelayMs`, `renderTemplate` + `renderTemplate.hasVariation`, `isQuietHour`, `pickSession`, `detectBlockSignal`, `normalizeThreadId`).
`normalizeThreadId(fb_id)` → يزيل بادئة `msg_` ويرفض ما ليس `^\d{5,}$` (يرجع `null` ⇒ المستلم `skipped` بسبب `unsupported_id`).

**Step 4** — أعد التشغيل: Expected: **7 passed**.
**Step 5** — `npm run build` (tsc يشمل `*.test.ts` — مصيدة معروفة في هذا المشروع).
**Step 6** — Commit: `feat(msg): pure pacing/anti-block helpers + tests`

---

### Task 3: `message-sender.ts` — طبقة DOM للإرسال فقط
**Objective:** دالة واحدة `sendOne(page, threadId, text, mediaPaths)` ترجع نتيجة صريحة، مبنية على selectors **من Task 0**.

**Files:** Create `extraction-service/src/services/message-sender.ts`

**Step 1** — التوقيع:
```ts
export type SendOutcome =
  | { ok: true }
  | { ok: false; kind: "rate_limited" | "session_dead" | "thread_unavailable" | "send_failed"; detail: string };

export async function sendOne(page: Page, threadId: string, text: string, mediaPaths: string[]): Promise<SendOutcome>;
```

**Step 2** — التنفيذ بالترتيب:
1. `goto(https://www.facebook.com/messages/t/<threadId>, { waitUntil: "domcontentloaded", timeout: config.fbNavTimeoutMs })` ثم `waitForTimeout(1500 + rnd*2500)`.
2. `detectBlockSignal(await page.content())` — لو رجّع شيئاً ⇒ ارجع الفشل المناسب **فوراً بدون كتابة**.
3. `page.waitForSelector(TEXTBOX, { timeout: 12_000 })` — لو فشل ⇒ `thread_unavailable`.
4. لو `mediaPaths.length` ⇒ `page.setInputFiles('input[type="file"]', mediaPaths)` ثم انتظار رفع المعاينة (`waitForSelector` على معاينة المرفق، timeout 30s).
5. `locator(TEXTBOX).click()` ثم `type(text, { delay: 40 + rnd*50 })`.
6. `waitForTimeout(600-1400)` ثم `press("Enter")`.
7. تأكيد الوصول: `waitForFunction` أن آخر فقاعة صادرة تحتوي أول 25 حرفاً من النص (أو أن المرفق ظهر)، timeout 15s. **لا نرجع `ok: true` إلا بعد هذا التأكيد** — وإلا `send_failed`.
8. أعد فحص `detectBlockSignal` بعد الإرسال (البانر يظهر بعد الإرسال أحياناً).

**Step 3** — `npm run build` ⇒ لا أخطاء.
**Step 4** — Commit: `feat(msg): DOM send layer with delivery confirmation`

> **مصيدة:** لا تستخدم `el.innerText = msg` كما في `publish-worker.ts` — محرر الماسنجر (Lexical) لا يسجّل التغيير ويبقى زر الإرسال معطّلاً. الكتابة الحقيقية بـ `type()` إلزامية.


---

### Task 4: `message-worker.ts` — المحرك (نمط `publish-worker.ts` حرفياً)
**Objective:** worker يستهلك `message_recipients` بالتباعد والحدود، يوزّع على الجلستين، يعمل checkpoint، ويتوقف بلطف.

**Files:** Create `extraction-service/src/services/message-worker.ts`

**Step 1** — الهيكل (مطابق `publish-worker.ts:10-21`):
```ts
const workers = new Map<string, boolean>();
export function startMessageWorker(jobId: string) { /* نفس النمط */ }
export function stopMessageWorker(jobId: string) { /* نفس النمط */ }
export async function resumeMessageJobs(): Promise<void> { /* status in (running) → أعد التشغيل */ }
```

**Step 2** — `runMessageWorker(jobId)`:
1. اقرأ الـ job؛ لو غير موجود ⇒ log + return.
2. أنشئ سياقاً لكل جلسة في `session_ids` عبر `contextManager.createContext` — **تخطَّ** (لا تُفشِل) أي جلسة ترمي `SESSION_EXPIRED` / `SESSION_NOT_CONNECTED` / `SESSION_IN_USE` (نفس نمط `extract.ts:203-217`). لو صفر جلسات صالحة ⇒ `failed` برسالة عربية واضحة.
3. نزّل المرفقات مرة واحدة من Storage إلى ملفات مؤقتة تحت `$LOCALAPPDATA/Temp` (Playwright `setInputFiles` يحتاج مسار قرص) واحفظ المسارات لكل المهمة.
4. الحلقة: اسحب مستلماً واحداً (`status in (pending, failed) and attempts < retry_max` مرتّباً بـ `created_at`, `limit 1`) — نفس أسلوب `campaign-worker.ts:42-49`.
5. لو `isQuietHour(now)` ⇒ نم 10 د وأعد المحاولة (بدون استهلاك).
6. `pickSession(...)` بعد قراءة العدّادات + `page.isClosed()`. لو `null` ⇒ `paused` + `stop_reason` (`daily_cap_reached` أو `quiet_hours` أو `all_sessions_cooling`) و**اخرج** (لا حلقة انتظار مفتوحة).
7. `renderTemplate(body, { name })` → `sendOne(...)`.
8. النتائج:
   - `ok` ⇒ `sent`, `sent_at`, `sent_via_session_id`; ازِد `message_send_counters` (upsert على `(session_id, day_key)`)؛ صفّر `consecutiveErrors`.
   - `rate_limited` / `session_dead` ⇒ اكتب `cooldown_until = now + 24h` للجلسة، أعد المستلم إلى `pending` (**بدون** زيادة `attempts` — الخطأ من الجلسة لا من المستلم)، وانتقل للجلسة الأخرى.
   - `thread_unavailable` ⇒ `skipped`.
   - `send_failed` ⇒ `attempts + 1`؛ عند `attempts >= retry_max` ⇒ `failed`.
9. `updateProgress` بعد كل مستلم، `saveCheckpoint` كل 5 (نفس `publish-worker.ts:88-101`).
10. `consecutiveErrors >= max_errors` ⇒ checkpoint + `paused` + `stop_reason='too_many_errors'`.
11. عند اكتمال الدفعة (`% batch_size === 0`) ⇒ checkpoint ثم `sleep(batch_pause)` مع فحص `workers.get(jobId)` قبل وبعد.
12. تباعد: `sleep(nextDelayMs(delay_min, delay_max))`.
13. `finally`: أفرج عن **كل** السياقات + امسح الملفات المؤقتة (حتى عند الاستثناء).

**Step 3** — تحقق بلا متصفح: أضف اختباراً يحقن `sendOne` وهمية (dependency injection عبر باراميتر اختياري) ويؤكد: `daily_cap` يوقف، `rate_limited` يبدّل الجلسة ولا يزيد `attempts`, `retry_max` يُنهي المستلم كـ `failed`.
Run: `npx tsx --test "src/services/__tests__/*.test.ts"` ⇒ Expected: كل الاختبارات تمر.

**Step 4** — `npm run build`.
**Step 5** — Commit: `feat(msg): message worker with per-session caps, cooldown, checkpointing`

---

### Task 5: `routes/messages.ts` — الـ API
**Objective:** مسارات التحكم بنفس شكل `/publish/*`.

**Files:** Create `extraction-service/src/routes/messages.ts` · Modify `index.ts`, `extract.ts`, `config.ts`, `errors.ts`

**Step 1** — المسارات:
| Method | Path | الوظيفة |
|---|---|---|
| POST | `/messages/start` | ينشئ الـ job + **يُجسّد المستلمين** من `source_job_id` (نسخ من `extraction_results` مع `normalizeThreadId`) ثم `startMessageWorker` |
| POST | `/messages/preview` | يرجع `{ eligible, skipped_unsupported, est_days, sample: [3 نصوص مُصاغة] }` — قبل البدء، بدون إرسال |
| POST | `/messages/media/upload` | multer (صور/فيديو، ≤25MB، `image/*`+`video/*` فقط) → Storage bucket `fb-message-media` |
| POST | `/messages/pause` \| `/resume` \| `/stop` | نفس نمط `publish.ts:65-102` |
| GET | `/messages/:jobId` | job + آخر 50 مستلماً (للتقدّم) |

**Step 2** — `zod` للـ start:
```ts
const startSchema = z.object({
  source_job_id: z.string().uuid(),
  session_ids: z.array(z.string().uuid()).min(1).max(2),
  name: z.string().max(120).optional(),
  body: z.string().min(1).max(2000),
  media_keys: z.array(z.string()).max(4).default([]),
  daily_cap: z.number().int().min(1).max(80).default(40),
  rate_per_hour: z.number().int().min(1).max(20).default(12),
  delay_min: z.number().int().min(20).max(600).default(45),
  delay_max: z.number().int().min(20).max(600).default(150),
  batch_size: z.number().int().min(1).max(30).default(8),
  batch_pause: z.number().int().min(60).max(3600).default(900),
  respect_quiet_hours: z.boolean().default(true),
  max_errors: z.number().int().min(1).max(20).default(5),
  retry_max: z.number().int().min(1).max(3).default(2),
}).refine(d => d.delay_max >= d.delay_min, { message: "delay_max must be >= delay_min" });
```

**Step 3** — تحققات إلزامية قبل الإنشاء:
- الـ `source_job_id` مملوك لنفس `user_id` للجلسات (وإلا 403). **لا تعتمد على RLS** — الخدمة تعمل بـ service-role.
- كل `session_ids` حالتها `connected` وتنتمي لنفس المستخدم.
- المستلمون المؤهلون > 0 وإلا 400 `NO_SENDABLE_RECIPIENTS`.
- منع تكرار: `message_jobs` نشطة للمستخدم ⇒ 409 `MESSAGE_JOB_ACTIVE`.
- **`platform='instagram'` مرفوض** بـ 400 برسالة عربية صريحة.

**Step 4** — عدّل `index.ts`: `import messagesRouter` + `app.use("/", messagesRouter)` + `await resumeMessageJobs()` بعد `resumeQueuedJobs()`. واحذف `POST /broadcast` من `extract.ts` (مع `broadcastSchema`).

**Step 5** — تحقق حقيقي:
```bash
curl -s -X POST localhost:3200/messages/preview -H "X-API-Key: $KEY" \
  -H 'Content-Type: application/json' -d '{"source_job_id":"<real>","body":"{مرحبا|أهلا} {{name}}"}' | jq
```
Expected: أعداد حقيقية مطابقة لـ `select count(*) from extraction_results where job_id='<real>'`.
> **مصيدة Windows/bash:** استخرج المفتاح بـ `| tr -d '\r'` وإلا يفشل curl بـ "No host part in URL".

**Step 6** — Commit: `feat(msg): /messages API (start/preview/pause/resume/stop/media) + drop fake /broadcast`


---

### Task 6: الواجهة — طبقة البيانات + الصفحة + زر البطاقة
**Objective:** UI بنفس Design System الحالي: محرر رسالة + مرفقات + إعدادات تباعد + معاينة + تقدّم حقيقي، وزر "مراسلة" في كل بطاقة مهمة.

**Files:**
- Create `src/lib/messaging/types.ts`, `src/lib/messaging/message-repository.ts`, `src/hooks/useMessageJobs.ts`
- Create `src/pages/dashboard/messenger/MessageComposerPage.tsx`, `MessageProgressPanel.tsx`
- Modify `src/routes/index.tsx`, `src/pages/dashboard/TasksPage.tsx`, `src/pages/dashboard/extraction/ExtractContactsPage.tsx`, `src/i18n/locales/{ar,en}.json`, `src/types/database.types.ts`
- Delete `src/pages/dashboard/messenger/MessengerBroadcastPage.tsx`

**Step 1 — repository + hooks** بنفس نمط `extraction-repository.ts` (`readFetchError`, `EXTRACTION_API_URL`, `X-API-Key`) و`useExtractionJobs` (`refetchInterval` 3000 عند `running|queued|paused`، وإلا `false`). **لا تكرر** منطق fetch — استخرج `postJson()` مشترك داخل الملف الجديد فقط.

**Step 2 — `MessageComposerPage.tsx`** بنيتان (نفس بنية `PublishTab.tsx` — عمودان `xl:col-span-3` / `xl:col-span-2`):
- يسار: textarea (`maxLength=2000` + عدّاد أحرف) · شريط مرفقات (`Paperclip`, `accept="image/*,video/*"`, حتى 4) بنفس أزرار `PublishTab:87-100` · **شريحة تلميح spintax** مع زر "إدراج بديل".
- يمين: اختيار الجلسات (checkbox متعدد من `useActiveSessionsForSelect`) · إعدادات التباعد (defaults من القسم 2.3) · **بطاقة معاينة** من `/messages/preview`: عدد المؤهلين، غير المدعومين، **الأيام المتوقعة**، و3 نماذج نصية · زر البدء.
- تحذيرات لازمة:
  - نص بلا تنويع (`hasVariation === false`) ⇒ بانر warning + الزر يظل مفعّلاً بعد إقرار المستخدم.
  - المصدر ليس `messenger_contacts` ⇒ بانر "إرسال بارد: خطر تقييد أعلى، الحد اليومي 15".
- الحالات المطلوبة كلها: Loading (Skeleton)، Error (`error-state.tsx`)، Empty (`EmptyState` عند صفر مؤهلين)، Hover/Focus (من `Button`/`Card` القياسيين)، RTL بـ `ms-/me-/ps-/pe-` فقط (لا `rtl:` — قاعدة AGENTS.md)، `aria-*` على شريط التقدّم و`aria-live="polite"` على العدّادات.

**Step 3 — `MessageProgressPanel.tsx`**: نظير `ProgressDashboard.tsx` (polling 3s) لكن يقرأ `GET /messages/:jobId`: بطاقات (إجمالي/أُرسل/فشل/تخطي) + شريط تقدّم + سجل آخر 20 مستلماً + أزرار إيقاف مؤقت/استئناف/إيقاف + شارة الجلسة المستخدمة + بانر `stop_reason` مترجم.

**Step 4 — الراوت + الأزرار:**
- `src/routes/index.tsx`: `messenger/compose/:jobId` → `MessageComposerPage`، وأبقِ `messenger/broadcast/:jobId` يشير لنفس المكوّن (توافق خلفي للروابط القديمة).
- `TasksPage.tsx` — استبدل الشرط الحالي:
```tsx
{job.type === "messenger_contacts" && (<Button ...>)}
```
بـ:
```tsx
{canMessage(job) && (
  <Button variant="primary" size="sm" onClick={() => navigate(`/dashboard/messenger/compose/${job.id}`)}>
    <Send className="size-3.5" />{t("messaging.sendTo", { count: job.result_count })}
  </Button>
)}
```
مع `canMessage(job)` = `!job.isPublish && job.result_count > 0 && !String(job.type).startsWith("ig_")`. وللـ IG: زر معطّل + `title` يشرح أن المراسلة متاحة لفيسبوك فقط حالياً. **`canDownload` و`isEnriching` لا يتغيران** — لكن زر المراسلة يظهر بمجرد وجود نتائج (لا يحتاج انتظار الإثراء).
- `ExtractContactsPage.tsx:176-179`: `handleBroadcast` → `/dashboard/messenger/compose/${activeJob.id}`.

**Step 5 — i18n:** أضف كتلة `messaging` في `ar.json` و`en.json` **بنفس الشكل النقطي الذي يناديه الكود**: `messaging.title`, `sendTo`, `body`, `attachments`, `pacing.*`, `preview.*`, `warn.noVariation`, `warn.coldOutreach`, `status.*`, `stopReason.daily_cap_reached|too_many_errors|all_sessions_cooling|quiet_hours`, `progress.*`.
> **مصيدة معروفة في المشروع:** لو الكود ينادي `t(\`messaging.stopReason.${x}\`)` فالمفتاح لازم يكون متداخلاً `stopReason: { daily_cap_reached: "..." }` — مفتاح مسطّح `stopReasondaily_cap_reached` يطبع النص الخام على الشاشة.

**Step 6** — تحقق: `npm run typecheck` ثم `npm run build` ⇒ ينجحان. ثم `npm run dev` وافتح `/dashboard/tasks`: تأكد أن الزر ظهر على مهمة `groups` حقيقية وأن `/messages/preview` رجّع أعداداً مطابقة للـ DB.
**Step 7** — Commit: `feat(msg): composer + progress UI, message button on every FB task card`

---

### Task 7: تشغيل حقيقي كامل + إثبات بالأرقام
**Objective:** إثبات أن الإرسال يعمل فعلاً بدون حظر — لا "الكود يبني" ولا "لا يوجد syntax error".

**Step 1** — نظّف: احذف `debug-msg-send.ts`، وأي ملف مؤقت. تأكد `.gitignore` يغطي الوسائط المؤقتة.
**Step 2** — أنشئ مهمة رسائل حقيقية على **5 مستلمين فقط** من مهمة `messenger_contacts` حقيقية، بجلستين، `delay_min=45 delay_max=90 batch_size=3 batch_pause=120`.
**Step 3** — راقب: `node scripts/monitor-job.mjs` (معدّل لجدول `message_jobs`) في terminal خلفي + `notify_on_complete`.
**Step 4** — أثبت بالأرقام (SQL فعلي):
```sql
select status, count(*) from message_recipients where message_job_id='<id>' group by status;
select session_id, day_key, sent_count from message_send_counters where day_key = current_date;
select progress, stop_reason from message_jobs where id='<id>';
```
والتحقق البشري: الرسائل ظهرت فعلاً في الماسنجر بنص متنوّع وبمرفق.
**Step 5** — جدول الإثبات النهائي المطلوب: `sent / failed / skipped / duration / avg gap (s) / per-session counts / stop_reason / حالة الجلسات بعد التشغيل (connected؟)`.
**Step 6** — امسح مهمة الاختبار: `delete from message_jobs where id='<id>'` (cascade يمسح المستلمين).
**Step 7** — Commit + push إلى `main`، ثم **انتظر** `conclusion: success` من GitHub Actions على نفس `head_sha` قبل قول "نُشر". أبلغ خالد بـ `Ctrl+Shift+R` للـ cache.

---

## 5) الاختبار والتحقق

| الطبقة | الأمر | المتوقع |
|---|---|---|
| Unit (pacing/worker) | `cd extraction-service && npx tsx --test "src/services/__tests__/*.test.ts"` | كل الاختبارات تمر |
| Build الخدمة | `cd extraction-service && npm run build` | صفر أخطاء tsc (**يشمل ملفات الاختبار**) |
| Typecheck الواجهة | `npm run typecheck` | صفر أخطاء |
| Build الواجهة | `npm run build` | ينجح |
| Lint | `npm run lint` | لا أخطاء جديدة |
| API حقيقي | `curl /messages/preview` ثم `/messages/start` | أعداد مطابقة للـ DB |
| تشغيل حقيقي | 5 مستلمين، جلستان | رسائل وصلت + عدّادات صحيحة + جلسات لا تزال `connected` |

**لا تُعتبر المهمة مكتملة** إلا بعد: بناء ناجح + اختبارات تمر + **رسائل وصلت فعلاً** + الجلسات لم تُحظر + Code Review نظيف + `git diff` لا يحتوي تغييرات غير مرتبطة.

---

## 6) المخاطر والمقايضات

| الخطر | الاحتمال | التخفيف |
|---|---|---|
| **حظر/تقييد الجلسة** — الخطر الأول | مرتفع للإرسال البارد | حدود متحفظة + تنويع نص إلزامي + circuit breaker 24h + راحة ليلية + تحذير صريح في الـ UI. **لا نستطيع إلغاء الخطر، فقط تقليصه؛ الإرسال البارد لغرباء يبقى مخالفاً لروح سياسة ميتا وقد يقيّد الحساب.** |
| `SESSION_IN_USE` — استخراج جارٍ على نفس الجلسة | متوسط | القفل الحالي يرمي خطأً واضحاً؛ نتخطى الجلسة ونعمل بالأخرى، والـ UI يبيّن السبب. لا نلمس القفل. |
| منافسة على `browserPool` (حجم 2) | متوسط | مهمة رسائل واحدة/مستخدم + `MAX_MESSAGE_JOBS_GLOBAL=2`؛ سياق واحد ثابت لكل جلسة بدل فتح/إغلاق. |
| تغيّر DOM الماسنجر يكسر الـ selectors | مرتفع مع الوقت | كل الـ selectors في `message-sender.ts` فقط، بقوائم بدائل ar+en، وتُثبت أولاً بـ probe (Task 0). |
| `restart` الخدمة يقتل مهمة جارية | متوسط | `resumeMessageJobs()` على الـ boot + checkpoint كل 5. **لا نستخدم `cleanupOrphanedJobs`** (مصيدة معروفة قتلت مهاماً حقيقية). |
| رفع فيديو كبير يبطئ المهمة | منخفض | حد 25MB، تنزيل مرة واحدة لكل المهمة لا لكل رسالة. |
| RLS: الخدمة service-role تتجاوز الـ RLS | متوسط | تحقق ملكية صريح في `/messages/start` (source job + sessions لنفس `user_id`). |

---

## 7) أسئلة مفتوحة (تحتاج قرار خالد قبل/أثناء التنفيذ)

1. **هل نسمح بالإرسال البارد أصلاً؟** الخطة تسمح به بحدود 15/يوم + تحذير. البديل الأكثر أماناً: قصره على `messenger_contacts` فقط في الإصدار الأول.
2. **الحد اليومي 40:** أقبله كافتراضي أم تريد رقماً آخر؟ (السقف الصلب 80 مقصود كحماية.)
3. **الراحة الليلية 01:00–07:00 القاهرة:** مناسبة أم نغيّرها؟
4. **Instagram DM:** خارج النطاق الآن (زر معطّل). نجعلها مرحلة ثانية؟
5. **قوالب محفوظة** (مثل `wa_templates`): مطلوبة الآن أم لاحقاً؟ (YAGNI ⇒ لاحقاً.)

---

## 8) نتائج الـ probe (منفَّذ 2026-08-29 — جلسة حقيقية `new` / thread `74100576336`)

```
TEXTBOX selector      : div[contenteditable="true"][role="textbox"]  (aria-label="Write to <name>")
                        يظهر خلال ~6 ثواني من فتح /messages/t/<id> — لازم polling لا wait ثابت
SEND button selector  : غير مطلوب — Enter من لوحة المفاتيح يرسل (زر غير مستقر خلف overlays)
FILE input selector   : input[type="file"] (multiple, بلا accept محدد)
نص بانر التقييد       : لا يوجد حالياً؛ صيغ المراقبة: "message request limit" /
                        "You can't currently message" / "لم يتم إرسال" / "Log in to Facebook"
تأكيد وصول الرسالة    : نص الرسالة يظهر في document.body.innerText — نمط "You: <أول 15 حرفاً>"
                        أو ظهوره في رأس القائمة "You: <text> · Xm" (مثبت في probe v2:
                        body احتوى "You: رسالة اختبار FlowTix v2 — تجاهل · 1m")
```

**إضافات مثبتة من الـ probe:**
1. **Overlays تحجب النقر**: بانر "Create a PIN" / E2E-encryption يغطي الصفحة — `elementHandle.click()` يفشل بـ `intercepts pointer events`. الحل المُثبت: `page.focus(selector)` + `page.keyboard.type()` — **لا نقر بالماوس على المحرر**.
2. **resource blocking**: `BLOCK_RESOURCES=true` (الافتراضي في المشروع) **لا يمنع** ظهور المحرر أو الإرسال.
3. **first Enter قد لا يرسل** في بعض بنيات المحرر — المُرسل سيضغط Enter ثانية إن لم يظهر النص في `body` خلال 2.5s.
4. الجلسة بعد الـ probe: لا checkpoint، لا بانر تقييد — `stillOnThread: true`.
5. ملاحظة بيانات: المستلم الأول في DB كان `Meta for Business` (صفحة) — الفلترة في `normalizeThreadId` فقط لا تكفي؛ **يجب تخطي المستلمين الذين اسمهم مطابق لصفحات Meta الرسمية؟ لا** — قرار التخطي نتركه للمستخدم في الـ UI، والمحرك يرسل لأي thread رقمي يفتح.

