## التشخيص

الرسالة الظاهرة في الصورة ليست من كوكيز فيسبوك نفسها، بل من جلسة دخول التطبيق عند استدعاء دوال محمية مثل حفظ حساب Cookies. الكود الحالي في `useFacebookApi` يحاول تحديث جلسة التطبيق عند أي خطأ مصادقة، وإذا كان refresh token منتهيًا/تالفًا يظهر النص الخام: `Session refresh failed` داخل Toast.

## الخطة

1. **إصلاح طبقة استدعاء دوال فيسبوك**
   - تعديل `src/features/facebook/api.ts` بحيث لا يعرض رسالة تقنية خام مثل `Session refresh failed`.
   - عند فشل تحديث الجلسة، يتم تصنيف الخطأ كجلسة تطبيق منتهية برسالة عربية واضحة: “انتهت جلسة الدخول، سجّل الدخول مرة أخرى”.
   - تنظيف الجلسة التالفة محليًا بدل ترك المستخدم في حالة تبدو أنه مسجل دخول لكنها تفشل عند الحفظ.

2. **حماية صفحة حسابات البوت من الجلسة المنتهية**
   - تعديل `src/routes/dashboard.facebook.bot.tsx` لعرض رسالة مناسبة أو توجيه المستخدم لتسجيل الدخول إذا انتهت جلسة التطبيق.
   - استخدام `describeFbError` بدل `String(e)` في عمليات: تحميل الحسابات، حفظ Cookies، حذف الحساب، والفحص.
   - منع ظهور Toast “فشل ربط الحساب / Session refresh failed” كحلقة متكررة.

3. **تحسين منطق المصادقة العام**
   - مراجعة `src/lib/auth.tsx` بحيث يتحقق من المستخدم الحقيقي عبر الجلسة الحالية، ويتعامل مع الجلسات التالفة بشكل نظيف.
   - الحفاظ على تجربة المستخدم الحالية، لكن بدون إبقاء واجهة الداشبورد مفتوحة بجلسة غير صالحة.

4. **عدم المساس بحسابات العملاء الحالية**
   - لا توجد حاجة لتعديل قاعدة البيانات أو حذف حسابات أو كوكيز أو مهام.
   - التغيير سيكون في طبقة الجلسة والرسائل فقط، لذلك لن يؤثر على الحسابات الشغالة حاليًا أو الـ VPS Worker.

5. **التحقق بعد التنفيذ**
   - فتح `/dashboard/facebook/bot` بجلسة صالحة والتأكد أن حفظ Cookies يعمل أو يعطي خطأ مفهوم.
   - محاكاة جلسة منتهية والتأكد أن الصفحة تطلب تسجيل الدخول بدل إظهار `Session refresh failed`.
   - التأكد أن رسائل `/me` القديمة لا تعود للظهور.

## الملفات المتوقعة

- `src/features/facebook/api.ts`
- `src/routes/dashboard.facebook.bot.tsx`
- `src/lib/auth.tsx`

<presentation-actions>
  <presentation-open-history>View History</presentation-open-history>
</presentation-actions>

<presentation-actions>
<presentation-link url="https://docs.lovable.dev/tips-tricks/troubleshooting">Troubleshooting docs</presentation-link>
</presentation-actions>