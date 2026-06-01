
## خطة ربط kie.ai كمزود AI لوكلاء الواتساب

### الهدف
استبدال Lovable AI في ردود الواتساب الآلية بمزود **kie.ai** مع:
- Pool مركزي يديره السوبر أدمن (20+ مفتاح API)
- تدوير تلقائي عند فشل المفتاح (401/402/429)
- تصنيف موديلات لكل وكيل (3 طبقات: بسيط / متوسط / تفاوض ذكي)

---

### 1. قاعدة البيانات (Migration)

**جدول `ai_provider_accounts`** (يديره السوبر أدمن فقط)
- `id`, `label` (اسم مرجعي مثل "kie-account-1")
- `provider` text default `'kie'`
- `api_key_encrypted` (مشفّر بـ BOT_ENCRYPTION_KEY)
- `status` enum: `active | exhausted | disabled | error`
- `priority` int (ترتيب الاستخدام)
- `last_used_at`, `last_error_at`, `last_error_message`
- `requests_count`, `failed_count`
- `cooldown_until` timestamptz (يُسترجع تلقائياً بعد فترة من 429)
- RLS: قراءة/كتابة للسوبر أدمن فقط (`has_role(auth.uid(), 'admin')`)

**جدول `ai_model_tiers`** (إعدادات عامة للمنصة)
- `id`, `tier` enum: `simple | smart | negotiation`
- `model_name` text (مثل `gpt-4o-mini`, `claude-3-5-sonnet`)
- `display_name_ar`, `display_name_en`
- `description`, `enabled` bool
- `max_tokens`, `temperature`
- يديرها السوبر أدمن من لوحة `/admin/ai`

**تعديل `whatsapp_settings`**: إضافة
- `ai_provider` text default `'lovable'` → نحول إلى `'kie'`
- `ai_tier_simple`, `ai_tier_smart`, `ai_tier_negotiation` (model names للوكيل)
- `ai_default_tier` enum (افتراضي للردود)

**جدول `ai_usage_logs`** (تتبع استخدام كل مفتاح)
- `account_id`, `user_id`, `tier`, `model`, `tokens_in`, `tokens_out`, `latency_ms`, `status`, `error_code`
- RLS: السوبر أدمن يرى الكل، العميل يرى استخداماته

---

### 2. منطق التدوير (Server)

**`src/lib/ai-pool.server.ts`** — مدير Pool مركزي:
- `getNextAvailableKey(tier)` — يختار أول مفتاح `active` بترتيب `priority` ولم يصل `cooldown_until`
- `markKeyFailed(accountId, errorCode)`:
  - 401/403 → `status = 'error'` (يحتاج تدخل أدمن)
  - 402 (نفاد رصيد) → `status = 'exhausted'`
  - 429 (rate limit) → `cooldown_until = now() + 5min`، يبقى active بعدها
- `callKieAI(prompt, tier, userId)` — يحاول حتى 3 مفاتيح قبل الفشل النهائي

**استبدال `wa-ai.server.ts`**:
- بدل `LOVABLE_API_KEY` + `ai.gateway.lovable.dev` → استخدم `callKieAI`
- نقطة النهاية: `https://api.kie.ai/v1/chat/completions` (متوافقة مع OpenAI)
- اختيار الـ tier حسب طول/نوع الرسالة أو إعداد العميل

**Cron يومي** يعيد تفعيل المفاتيح `exhausted` بعد تجديد الاشتراك (اختياري لاحقاً).

---

### 3. واجهة السوبر أدمن (`/admin/ai`)

تطوير الصفحة الحالية لتشمل **3 تبويبات**:

**تبويب "حسابات kie.ai"**
- جدول يعرض كل المفاتيح: label, status badge, آخر استخدام, عدد الطلبات, عدد الفشل
- زر **+ إضافة حساب** (label + API key، يُشفّر فوراً)
- إجراءات: تفعيل/تعطيل، حذف، إعادة تعيين العداد، اختبار المفتاح (ping)
- بطاقات إحصائية أعلى: إجمالي المفاتيح / النشط / المستنفد / المعطل

**تبويب "الموديلات"**
- إدارة `ai_model_tiers`: لكل tier (simple/smart/negotiation) قائمة موديلات
- اقتراح افتراضي:
  - **simple**: `gpt-4o-mini` (ردود سريعة قصيرة)
  - **smart**: `claude-3-5-sonnet` أو `gpt-4o` (تفاهم متوسط)
  - **negotiation**: `gpt-4o` أو `claude-3-opus` (تفاوض ذكي طويل)
- تفعيل/تعطيل، تعديل max_tokens & temperature

**تبويب "سجل الاستخدام"**
- جدول `ai_usage_logs` آخر 100 صف
- فلاتر: حسب الحساب، حسب المستخدم، حسب الـ tier، حسب الحالة
- رسم بياني: طلبات / يوم آخر 30 يوم

كل ذلك بتصميم بريميوم متطابق مع لوحة الأدمن الحالية (CardStat, Tabs, Badges).

---

### 4. واجهة العميل (`/dashboard/whatsapp/settings`)

- إخفاء حقل `ai_model` الحر
- استبداله بـ **3 dropdowns** (نقرأ من `ai_model_tiers`):
  - "موديل الردود البسيطة"
  - "موديل المحادثات الذكية"
  - "موديل التفاوض على الأسعار"
- العميل لا يرى أي مفاتيح أو معلومات Pool

---

### 5. الأمان

- المفاتيح مشفّرة بـ AES-GCM باستخدام `BOT_ENCRYPTION_KEY` الموجود
- جميع server functions لإدارة الحسابات محمية بـ `requireSupabaseAuth` + فحص `has_role(uid, 'admin')`
- لا يُرجع المفتاح أبداً للواجهة (فقط مقتطف `kie-...XXXX`)
- Rate limit داخلي لكل عميل (منع إساءة استخدام Pool)

---

### 6. التنفيذ على مراحل

```text
1. Migration: 3 جداول + تعديل whatsapp_settings + GRANTs + RLS
2. ai-pool.server.ts: التشفير + اختيار المفتاح + التدوير
3. تعديل wa-ai.server.ts للاتصال بـ kie.ai بدل Lovable
4. صفحة /admin/ai: 3 تبويبات (حسابات / موديلات / سجل)
5. تعديل صفحة إعدادات الواتساب للعميل (3 dropdowns)
6. اختبار: إضافة مفتاح، محاكاة 402، التأكد من التدوير
```

---

### ملاحظة فنية
kie.ai endpoint متوافق مع OpenAI Chat Completions API، لذا التكامل بسيط (POST JSON بنفس بنية OpenAI). الموديلات المتاحة على kie.ai تشمل: GPT-4o, Claude 3.5 Sonnet, Gemini, DeepSeek وغيرها — سنحدد القائمة النهائية لاحقاً من سوقهم.
