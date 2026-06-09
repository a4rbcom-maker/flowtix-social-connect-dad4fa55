
# نظام Facebook Auto-Reply — الرد التلقائي على التعليقات

## نظرة عامة
ربط صفحات فيسبوك للعميل (رسمياً عبر Graph API أو احتياطياً عبر البوت الموجود)، ثم تشغيل قواعد رد تلقائية على التعليقات: تعليق عام + رسالة خاصة (Comment + DM)، مع فلاتر كلمات مفتاحية ونطاق (بوست محدد / كل البوستات) وحماية من السبام.

## 1. قاعدة البيانات (Migration واحد)

### `fb_pages` — صفحات الفيسبوك المربوطة
- `user_id`, `page_id` (FB), `page_name`, `avatar_url`
- `connection_type`: `'official' | 'bot'`
- `access_token_encrypted` (للرسمي فقط، مُشفّر بـ BOT_ENCRYPTION_KEY)
- `bot_account_id` (للبوت — يرجع لـ `fb_bot_accounts`)
- `status`: `'active' | 'expired' | 'disconnected'`
- `webhook_subscribed`: bool

### `fb_autoreply_rules` — قواعد الرد
- `user_id`, `page_id`, `name`, `enabled`
- `scope`: `'specific_post' | 'all_posts'`
- `post_id` (اختياري — للنطاق `specific_post`)
- `trigger_type`: `'keywords' | 'any_comment'`
- `keywords` (text[]) — كلمات مفتاحية (تطابق جزئي + case-insensitive + يدعم RTL)
- `match_mode`: `'any' | 'all' | 'exact'`
- `reply_comment_enabled` (bool) + `reply_comment_text`
- `reply_dm_enabled` (bool) + `reply_dm_text` + `reply_dm_buttons` (jsonb)
- `ignore_admin_comments` (default true)
- `dedupe_per_user` (default true) — لا يكرر الرد لنفس الشخص
- `priority` (int) — لو تعليق طابق عدة قواعد
- `cooldown_seconds` (default 0)

### `fb_autoreply_log` — سجل التنفيذ
- `rule_id`, `page_id`, `post_id`, `comment_id`, `commenter_id`, `commenter_name`
- `action_taken`: `'comment' | 'dm' | 'both' | 'skipped'`
- `skip_reason`: nullable (`'admin'|'duplicate'|'spam'|'cooldown'`)
- `status`: `'success' | 'failed'`, `error_message`, `fb_response` (jsonb)

### Indices
- `(page_id, enabled)` على القواعد
- `(rule_id, commenter_id)` فريد جزئياً للـ dedupe
- `(comment_id)` فريد على اللوج لمنع التكرار

## 2. الربط الرسمي (Graph API)

### Server functions في `src/lib/fb-pages.functions.ts`
- `startFbOAuth()` — يرجّع رابط Facebook Login مع scopes: `pages_show_list, pages_manage_engagement, pages_manage_metadata, pages_messaging, pages_read_engagement`
- `completeFbOAuth({ code })` — يتبادل code → user_token → page_tokens، ويحفظ كل صفحة
- `subscribeWebhook({ pageId })` — يشترك الصفحة في webhook fields: `feed, mention`
- `disconnectPage({ pageId })`

### Webhook (Server Route)
`src/routes/api/public/webhooks/facebook.ts`
- GET: verification challenge
- POST: استقبال أحداث التعليقات → التحقق من توقيع `x-hub-signature-256` → مطابقة القواعد → تنفيذ
- يستخدم `supabaseAdmin` (بعد التحقق من التوقيع فقط)

### المحرّك (Engine) في `src/lib/fb-autoreply-engine.server.ts`
- `matchRules(comment, pageId)` — يجلب القواعد المُفعّلة ويطبّق:
  - فلتر الإدارة (يتجاهل تعليقات صاحب الصفحة/الأدمنز)
  - فلتر السبام البسيط (تكرار حرفي >5، روابط مشبوهة، طول مفرط)
  - مطابقة الكلمات (any/all/exact) مع تطبيع عربي (إزالة التشكيل، توحيد الألف)
  - dedupe لكل (rule, user)
  - cooldown
- `executeRule(rule, comment)` — يرسل التعليق + DM عبر Graph API ويسجّل اللوج

## 3. البوت الاحتياطي

### `bot-worker/actions/autoreply-poll.js` (جديد)
- يفتح الصفحة كل X ثانية، يجلب آخر تعليقات (DOM scraping)
- يمرّر كل تعليق على نفس `fb-autoreply-engine` (عبر استدعاء server fn)
- ينفّذ الرد بكتابة تعليق + فتح Messenger وإرسال DM

### نوع Job جديد: `autoreply_monitor`
- يستمر يعمل (long-running) ويراقب الصفحات المربوطة كـ `connection_type='bot'`
- له `stop` action لإيقافه

## 4. واجهة المستخدم

### تعديل `dashboard.facebook.tsx` (Connect & Status)
قسم جديد: **"صفحات الرد التلقائي"**
- زر **"ربط صفحة (رسمي)"** → يفتح OAuth
- زر **"ربط عبر البوت"** → يختار حساب bot موجود
- جدول الصفحات المربوطة مع status badges وزر فصل

### مسار جديد `dashboard.facebook.autoreply.tsx`
**Tabs:**
1. **القواعد** — جدول كل القواعد + زر إنشاء/تعديل
2. **منشئ القاعدة** (Dialog/Sheet):
   - اختيار الصفحة
   - النطاق: بوست محدد (مع جلب آخر 25 بوست) / كل البوستات
   - المحفّز: كلمات مفتاحية (chips) + match mode / أي تعليق
   - محتوى الرد: toggle تعليق + toggle DM (كلاهما اختياري لكن واحد على الأقل)
   - خيارات متقدمة: تجاهل الإدارة، dedupe، cooldown، أولوية
3. **السجل** — جدول مباشر للتنفيذ مع فلاتر (نجح/فشل/سبام) و CSV

### Sidebar
إضافة عنصر **"الرد التلقائي"** تحت Facebook في `DashboardLayout.tsx`

## 5. الأمان والصلاحيات
- RLS على الجداول الثلاثة: `user_id = auth.uid()` للقراءة/التعديل
- `service_role` للويبهوك والمحرّك
- Webhook signature verification إلزامية
- تشفير `access_token` بـ `BOT_ENCRYPTION_KEY` الموجود

## 6. الأسرار المطلوبة (Build Secrets — رسمي فقط)
- `FB_APP_ID`
- `FB_APP_SECRET`
- `FB_WEBHOOK_VERIFY_TOKEN`
سأطلبها عبر `add_secret` بعد موافقتك على الخطة.

## 7. الترتيب الزمني
1. Migration للجداول (مع GRANTs)
2. Server functions للقواعد (CRUD) + المحرّك
3. UI: صفحة القواعد + سجل
4. الربط الرسمي + Webhook
5. تكامل البوت الاحتياطي
6. اختبار End-to-end

## ملاحظة تقنية
- DM للمعلق مدعوم رسمياً من Facebook فقط خلال **7 أيام** من التعليق (Messenger Private Reply API).
- البوت الاحتياطي ليس عليه هذا القيد لكن أبطأ وأخطر.
- التطبيع العربي للكلمات (إزالة "ـ"، توحيد "أإآ→ا"، "ى→ي"، "ة→ه") سيُطبَّق على الكلمات والتعليق معاً لزيادة دقة المطابقة.
