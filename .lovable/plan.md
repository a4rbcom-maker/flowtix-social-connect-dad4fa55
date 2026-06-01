## التغييرات

**1) إزالة رابط "لوحة المستخدم" من شريط السوبر أدمن**
- `src/components/admin/AdminLayout.tsx` — حذف الرابط (`<Link to="/dashboard">`) في الفوتر (سطور 180–187) مع استيراد `ArrowLeft` لو ما عادش مستخدم.

**2) توجيه تلقائي بعد تسجيل الدخول حسب الدور**
- `src/routes/login.tsx` — بعد `signInWithPassword` الناجح، نستعلم من جدول `user_roles` للمستخدم الحالي:
  - لو عنده `role = 'admin'` → `navigate({ to: "/admin" })`
  - غير كده → `navigate({ to: "/dashboard" })`
- نفس المنطق نضيفه على صفحة `/login` في `beforeLoad` لو فيه جلسة شغالة فعلاً (عشان لو دخل /login وهو مسجّل بالفعل يروح للمكان الصح بدل ما يفضل في dashboard).

**3) ترقية الحساب `khaled.tqnee` إلى سوبر أدمن**
- نحتاج نلاقي الـ user_id من `auth.users` عن طريق الإيميل (`%khaled%tqnee%`) ونضيف صف في `user_roles` بـ `role = 'admin'` (مع `ON CONFLICT DO NOTHING`) عبر migration.
- ملاحظة: حساب `Eng. Khaled Abdulrahman` (`3aea1038…`) موجود كأدمن بالفعل من قبل — لو ده نفسه الحساب فالعملية idempotent، ولو حساب تاني هيتضاف بشكل مستقل.

## ملاحظة فنية

كل قراءة لدور المستخدم بعد الدخول بتمر عبر RLS policy `Users can view own roles` على `user_roles` (المستخدم يقدر يقرأ أدواره فقط) — مفيش أي تسريب.