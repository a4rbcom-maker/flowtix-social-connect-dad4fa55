## الوضع الحالي

- لوحة السوبر أدمن **موجودة وشغالة** على المسار `/admin` مع كل الصفحات الفرعية:
  `/admin`, `/admin/users`, `/admin/facebook`, `/admin/whatsapp`, `/admin/ai`, `/admin/jobs`, `/admin/logs`, `/admin/notifications`, `/admin/settings`, `/admin/security`.
- محمية مركزياً بـ `requireAdmin` middleware + RLS عبر دالة `has_role(auth.uid(), 'admin')`.
- لوحة العميل المشترك جاهزة على `/dashboard` (Facebook, WhatsApp Bot, Contacts, Bulk, Scheduled, إلخ).
- منصة SaaS مكتملة: تسجيل/دخول → profile + plan → role-based gating.

## حساب السوبر أدمن الحالي

| الاسم | User ID | الدور |
|---|---|---|
| Eng. Khaled Abdulrahman | `3aea1038-181a-492c-abd7-af9ed7c6e18f` | `admin` ✅ |

**حسابك بالفعل سوبر أدمن** — مفيش حاجة في الـ DB محتاجة تتغير.

## كيفية الدخول للوحة الآن

1. افتح `/login` وسجّل دخول بإيميل وباسورد حسابك.
2. اكتب `/admin` في شريط العنوان → هتدخل اللوحة مباشرة.

## التغيير المطلوب في الكود

إضافة لينك "لوحة الإدارة" يظهر **تلقائياً للأدمن فقط** في الـ navigation:

### الخطوات

1. **Server function للتحقق من الدور (لو مش موجود بشكل خفيف للـ client)**
   - استخدم `checkIsAdmin` الموجود في `src/lib/admin.functions.ts` عبر `useQuery` ليرجع `boolean`.
   - Hook صغير: `src/hooks/useIsAdmin.ts` يلف الـ query ويرجع `{ isAdmin, isLoading }`.

2. **إضافة اللينك في dashboard layout**
   - في `src/components/dashboard/DashboardLayout.tsx` (أو الـ sidebar/topbar المستخدم):
     - لو `isAdmin === true` → اعرض item جديد:  
       - أيقونة: `Shield` (lucide-react)  
       - النص: AR "لوحة السوبر أدمن" / EN "Super Admin"  
       - يوجّه إلى `/admin`  
       - بـ badge/لون مميز (violet) لتمييزه.

3. **إضافة لينك مماثل في الـ navbar العامة** (لو الأدمن في صفحة public):
   - في `src/components/layout/SiteHeader.tsx` (أو ما يعادله) — يظهر فقط للأدمن.

4. **اختبار سريع**
   - دخول بحساب عادي (غير admin) → اللينك ما يظهرش.
   - دخول بحساب admin → اللينك يظهر، الضغط عليه يفتح `/admin` بدون 403.
   - زيارة `/admin` مباشرة بحساب غير admin → redirect أو 403 (مغطّى بالـ middleware).

## ما لن يتغير

- لا تعديلات على RLS أو user_roles (الدور موجود بالفعل).
- لا migrations جديدة.
- لا تغيير في حسابك أو إنشاء حساب جديد.

## ملف(ات) متوقع تعديلها

- `src/hooks/useIsAdmin.ts` (جديد)
- `src/components/dashboard/DashboardLayout.tsx` (تعديل — إضافة شرطية للينك)
- `src/components/layout/SiteHeader.tsx` أو ما يعادله (تعديل — إضافة شرطية)

بعد التطبيق: سجّل دخول وهتلاقي لينك "لوحة السوبر أدمن" ظاهر في القائمة مباشرة.
