
# خطة لوحة تحكم السوبر أدمن — Flowtix Tools

## 1) المعمارية والحماية

### بنية المسارات
```
src/routes/
  _admin.tsx                    ← Layout محمي (يتحقق من has_role(uid,'admin'))
  _admin/admin.tsx              ← redirect → /admin/overview
  _admin/admin.overview.tsx     ← الصفحة الرئيسية (KPIs + Charts)
  _admin/admin.users.tsx        ← إدارة المستخدمين
  _admin/admin.users.$id.tsx    ← ملف مستخدم تفصيلي
  _admin/admin.roles.tsx        ← إدارة الصلاحيات والأدوار
  _admin/admin.subscriptions.tsx← الباقات والاشتراكات
  _admin/admin.facebook.tsx     ← مراقبة حسابات/حملات فيسبوك
  _admin/admin.whatsapp.tsx     ← مراقبة جلسات/محادثات واتساب
  _admin/admin.ai.tsx           ← استهلاك Lovable AI + النماذج
  _admin/admin.jobs.tsx         ← قائمة المهام (fb_jobs + bulk_jobs)
  _admin/admin.logs.tsx         ← سجلات الإرسال والأخطاء
  _admin/admin.notifications.tsx← إرسال إشعارات/إعلانات للمستخدمين
  _admin/admin.settings.tsx     ← إعدادات النظام العامة
  _admin/admin.security.tsx     ← Audit log + جلسات Auth
```

### طبقة الحماية (مهم)
- **Route Guard** عبر `_admin.tsx`: `beforeLoad` يستدعي server fn `requireAdmin` (يستخدم `requireSupabaseAuth` + `has_role(uid,'admin')`). فشل ⇒ redirect إلى `/dashboard`.
- **كل قراءة Admin** عبر `createServerFn` تستخدم `requireSupabaseAuth` ثم تتحقق من الدور قبل استعمال `supabaseAdmin` (تجاوز RLS) لجلب بيانات كل المستخدمين.
- **لا** نضيف policies تكشف بيانات المستخدمين لـ anon/authenticated — كل وصول الأدمن يمر بـ server functions فقط.

### بنية الـ DB المطلوبة (Migration واحد)
1. **`admin_audit_log`** — جدول لتسجيل كل إجراء أدمن (action, target_user_id, payload, ip, created_at).
2. **`platform_settings`** — key/value لإعدادات عامة (maintenance_mode, default_plan, signup_enabled…).
3. **`platform_announcements`** — إعلانات/إشعارات نظامية للمستخدمين.
4. **View `admin_user_overview`** — تجميع لكل مستخدم: profile + plan + روابط fb + جلسات wa + عدّاد contacts/campaigns/messages + last_active.
5. **RPC `admin_kpi_snapshot()`** — يرجّع KPIs (عدد مستخدمين/نشطين/رسائل اليوم…).
6. **Grants** فقط لـ `service_role` على هذه الجداول/الـ views، مع RLS مفعّل وسياسات admin-only تستخدم `has_role`.

## 2) صفحة Overview (القلب)

تصميم بريميوم: شبكة Bento + Glassmorphism خفيف على خلفية البنفسجي (مطابق Botxtra).

**KPI Cards (شبكة 4×):**
- إجمالي المستخدمين + نمو 7 أيام (sparkline)
- المستخدمين النشطين اليوم (DAU) / الأسبوع (WAU)
- إجمالي الرسائل المرسلة (FB + WA) — اليوم/الأسبوع/الشهر
- معدل النجاح/الفشل للمهام
- استهلاك Lovable AI (tokens + cost approx)
- اشتراكات فعّالة per plan

**رسوم بيانية (Recharts):**
- Area chart: نمو المستخدمين 30 يوم
- Stacked bar: رسائل FB vs WA يومياً (14 يوم)
- Donut: توزيع المستخدمين على الباقات
- Heatmap: ساعات الذروة للإرسال
- Top 10 users by activity (جدول مع mini-bars)

**Live activity feed:** آخر 20 حدث (signup، حملة جديدة، فشل WA session…) مع SSE/realtime.

## 3) إدارة المستخدمين

**جدول قوي (TanStack Table):**
- بحث، فلترة (plan, role, status, has_fb, has_wa, signup_date range)
- أعمدة: avatar+name, email, plan, role, #contacts, #campaigns, last_active, status
- Bulk actions: تغيير الباقة، تعطيل، حذف، تصدير CSV
- صف قابل للنقر ⇒ Drawer جانبي تفصيلي

**صفحة `admin.users.$id`:** 
- Header: avatar, name, email, plan, role badges
- تابات: Overview · Facebook · WhatsApp · Activity · Billing · Audit
- إجراءات (محمية بـ confirm): تعيين/إزالة admin، تغيير الباقة، Force logout، حذف الحساب (cascade)، Impersonate (token مؤقت)

## 4) صفحات تخصصية

- **Facebook:** كل الحسابات/الحملات/المهام عبر النظام، فلترة per-user، قتل مهمة، إعادة جدولة، عرض الأخطاء.
- **WhatsApp:** كل الجلسات + حالتها، آخر QR، عدد المحادثات/الرسائل، إجبار قطع اتصال.
- **AI Usage:** sum من `wa_ai_logs` (tokens, latency, errors per model)، رسم خطي + جدول top consumers.
- **Jobs:** view موحّد لـ fb_jobs + bulk_jobs مع status filters و retry/cancel.
- **Logs:** stream من `send_log` + `admin_audit_log` مع بحث متقدم.
- **Notifications:** form لإرسال إعلان (target: all / by plan / by user list) ⇒ يكتب في `platform_announcements` ويظهر للمستخدم في NotificationsBell.
- **Settings:** maintenance mode, signup toggle, default plan, AI model defaults, rate limits.
- **Security:** آخر تسجيلات دخول، محاولات فاشلة، audit log كامل، Auth provider settings.

## 5) التصميم البريميوم (مطابق هوية Botxtra)

- **Layout:** Sidebar مطوي قابل للتوسعة + Topbar بحث عام (Cmd+K) + theme toggle + admin avatar.
- **Palette:** نفس tokens الموقع (vivid violet primary) + تمييز Admin بـ accent ذهبي خفيف `oklch(0.78 0.14 85)` على البادج "Admin Mode".
- **Cards:** زجاجية مع gradient border خفيف، shadow ناعم، hover lift.
- **Charts:** ألوان من design tokens فقط، tooltips مخصصة، skeletons أثناء التحميل.
- **Motion:** framer-motion — stagger للبطاقات، fade للجداول، count-up للأرقام.
- **RTL/LTR:** كامل عبر I18nProvider الموجود.
- **Density toggle:** Comfortable / Compact للجداول.
- **Empty states + Skeletons + Error boundaries** على كل صفحة.

## 6) Server Functions المطلوبة

```
src/lib/admin/
  admin-guard.server.ts        ← requireAdmin middleware
  admin-kpis.functions.ts      ← getOverviewKpis, getTimeseries
  admin-users.functions.ts     ← listUsers, getUserDetail, updateUserPlan, setRole, deleteUser, impersonate
  admin-jobs.functions.ts      ← listAllJobs, cancelJob, retryJob
  admin-ai.functions.ts        ← aiUsageStats
  admin-notifications.functions.ts ← broadcastAnnouncement
  admin-settings.functions.ts  ← getSettings, updateSetting
  admin-audit.server.ts        ← logAdminAction helper
```

كل mutation تكتب صف في `admin_audit_log`.

## 7) خطوات التنفيذ (مراحل)

**المرحلة A — الأساس (هذه الخطة):**
1. Migration: جداول admin + view + RPC + grants/policies + تعيين أول أدمن (user_id الحالي).
2. `_admin` layout + guard + admin sidebar.
3. صفحة Overview كاملة (KPIs + 4 charts + activity feed).
4. صفحة Users (جدول + drawer تفصيلي + بحث/فلترة).

**المرحلة B:**
5. صفحات Facebook / WhatsApp / Jobs / AI Usage.
6. Logs + Audit.

**المرحلة C:**
7. Notifications broadcast + Settings + Security.
8. Cmd+K command palette + density toggle + تصدير CSV.

## 8) نقاط تحتاج قرارك قبل البدء

1. **مَن أول سوبر أدمن؟** هل أعيّنك تلقائياً (user_id الحالي من جلستك) أم تريد إيميل محدد؟
2. **Impersonate user:** هل نضيفها (مفيدة للدعم لكنها حساسة)؟
3. **هل نبدأ بالمرحلة A فقط** (Overview + Users) أم نمشي على A+B معاً؟
4. **Maintenance mode**: عند تفعيله، هل يحجب كل المستخدمين عدا الأدمن؟

أكد لي الإجابات وأبدأ التنفيذ فوراً بالمرحلة A.
