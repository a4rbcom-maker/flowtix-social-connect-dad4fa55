
# نظام الإشعارات المتكامل

النظام الحالي عنده الأساسيات: جدول `platform_announcements` + صفحة أدمن للإنشاء والحذف + جرس بسيط. سأبني عليه (مش هعيد من الصفر) عشان لا أكسر اللي موجود.

## 1. توسيع قاعدة البيانات (Migration)

أعدّل جدول `platform_announcements` وأضيف:
- `notif_type` (info, alert, update, maintenance, warning, offer)
- `priority` (low, normal, high, urgent)
- `target_kind` يُوسَّع ليشمل: `all` / `plan` / `users` / `single_user` / `active_users` / `suspended_users`
- `require_ack` (هل يلزم تأكيد القراءة قبل الإغلاق؟)
- `show_as_popup` (هل يظهر كمودال أم في الجرس فقط؟)
- `updated_at` + `updated_by` للتعديل

أنشئ جدول جديد `notification_reads` للتتبّع لكل مستخدم:
- `announcement_id`, `user_id`
- `delivered_at` (أول مرة وصل له)
- `opened_at` (فتح المودال/الجرس)
- `read_at` (تأكيد القراءة الفعلية)
- `ack_at` (تأكيد لمّا `require_ack=true`)

مع RLS: المستخدم يقرأ/يحدّث صفّه فقط، والأدمن يقرأ الكل (عبر `has_role`).

أضيف عمود `status` على `profiles` لو مش موجود (active / suspended / warned) عشان فلترة `active_users` / `suspended_users` تشتغل.

## 2. Server functions (في `src/lib/admin.functions.ts` و`src/lib/notifications.functions.ts`)

أدمن:
- `updateAnnouncement` — تعديل إعلان موجود
- `getAnnouncementStats(id)` — يرجّع: عدد المستهدفين، عدد اللي استلم، فتح، قرأ، أكّد + متوسط وقت القراءة
- تحديث `createAnnouncement` ليدعم الحقول الجديدة + الجمهور الجديد

المستخدم:
- `getMyNotifications` — يرجّع الإعلانات النشطة المستهدفة + حالة القراءة
- `markDelivered` / `markOpened` / `markRead` / `markAck`

## 3. واجهة الأدمن `/admin/notifications`

- زر **تعديل** على كل إعلان (نموذج نفسه فيه preview)
- **معاينة مباشرة** للمودال قبل النشر (Tab "معاينة")
- اختيار النوع والأولوية والجمهور الموسّع
- خانة "يتطلب تأكيد قراءة" + "إظهار كمودال"
- صفحة **إحصائيات** لكل إعلان (مودال): عدد المستلمين، الفاتحين، القارئين، المؤكدين، متوسط وقت القراءة، قائمة بالمستخدمين

## 4. تجربة العميل

**أ) مودال منبثق** (`src/components/dashboard/AnnouncementModal.tsx`):
- يظهر تلقائياً أول مرة يدخل لوحة التحكم بعد إعلان جديد مستهدف له
- تصميم بريميوم بألوان حسب النوع/الأولوية
- لو `require_ack=true` → زر "أؤكد القراءة" فقط (مينفعش يقفل بـ X)
- لو لا → زر "إغلاق" عادي
- يُسجّل `opened_at` فور الظهور، `read_at` عند الإغلاق، `ack_at` عند التأكيد
- يُحقن في `DashboardLayout` عشان يشتغل على كل صفحات لوحة العميل

**ب) مركز إشعارات** `/dashboard/notifications`:
- كل الإشعارات السابقة (مقروءة وغير مقروءة)
- فلتر: الكل / غير مقروء / حسب النوع
- تاريخ الإرسال + وقت قراءتك
- إعادة فتح إشعار قديم

**ج) تحديث `NotificationsBell`**:
- يستخدم نفس `getMyNotifications` بدل المصدر القديم
- يعرض عدد غير المقروء
- النقر يفتح نفس المودال أو يوجّه لمركز الإشعارات

## 5. الاستمرارية

كل الإشعارات في قاعدة البيانات → تظهر للمستخدم حتى لو سجّل دخول لاحقاً، ولا تُفقد عند تحديث الصفحة (الحالة محفوظة في `notification_reads`).

## 6. عدم كسر الموجود

- ما هلمسش `useSendNotifications.tsx` و`src/lib/notifications.ts` (دول لـ `send_log`، حاجة تانية خالص)
- التعديلات على `platform_announcements` كلها **إضافات** بـ defaults (مفيش breaking changes)
- صفحة الأدمن الحالية هتبقى نفسها مع توسعة، مش إعادة كتابة كاملة

## تفاصيل تقنية موجزة

- Validation بـ Zod في كل server fn
- RLS صارمة: المستخدم يرى فقط ما هو مستهدف به، الأدمن يرى الكل عبر `has_role(_user_id, 'admin')`
- GRANTs لـ `authenticated` + `service_role` على كل جدول جديد
- استخدام `requireSupabaseAuth` middleware لكل server fn
- مزامنة Realtime اختيارية على `platform_announcements` عشان لو الأدمن نشر إعلان والمستخدم فاتح اللوحة يظهر فوراً

---

**يا ريت تأكد لي:**
1. الموافقة على الخطة كاملة؟
2. أبدأ في خطوة واحدة (Migration + بنية فقط) ولا أعمل كل الحاجة في كومتس متتالية تلقائية؟
