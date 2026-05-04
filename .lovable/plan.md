## الهدف
عرض حالة ربط فيسبوك وواتساب مباشرة بجانب اسم القناة في الشريط الجانبي، مع مؤشر بصري واضح يميز: **متصل** (أخضر)، **غير متصل** (رمادي)، **تنتهي قريبًا** (كهرماني)، **منتهي/خطأ** (أحمر).

## السلوك

**فيسبوك** — يحدَّد من `inspectFacebookToken` (يوجد بالفعل):
- لا يوجد صف ⇒ **غير متصل** (نقطة رمادية)
- `valid && !expired && days > 7` ⇒ **متصل** (نقطة خضراء نابضة)
- `valid` لكن `daysUntilExpiry ≤ 7` ⇒ **تنتهي قريبًا** (نقطة كهرمانية + شارة "Xد")
- `expired` أو `!valid` ⇒ **منتهي** (نقطة حمراء)

**واتساب** — يحدَّد من `whatsapp_settings`:
- لا يوجد صف أو `is_connected=false` ⇒ **غير متصل** (رمادي)
- `is_connected=true` ⇒ **متصل** (أخضر نابض)
- (لاحقًا: لو احتجنا انتهاء صلاحية لتوكن Meta نضيفه؛ حاليًا الجدول لا يحوي حقل expiry)

## التصميم البصري
- نقطة دائرية صغيرة (8×8) بجانب اسم القناة في زر المجموعة (Facebook/WhatsApp).
- الحالة "متصل" تستخدم `animate-pulse` + glow خفيف بلون الحالة.
- الحالة "تنتهي قريبًا" تعرض شارة صغيرة بعدد الأيام بجانب النقطة (مثلاً `5d` / `٥ي`) — تختفي عند طي الشريط.
- في وضع الشريط المطوي (icon-only): النقطة تظهر فوق-يمين الأيقونة (absolute) كـ status dot صغير (10px).
- Tooltip عند hover يصف الحالة بلغة المستخدم: "متصل · ينتهي خلال 5 أيام" / "غير متصل" / "انتهت الصلاحية — أعد الربط".

## البنية التقنية

**1. Hook جديد** `src/hooks/useChannelStatus.ts`:
- يجلب الحالتين بالتوازي عند تحميل اللوحة.
- فيسبوك: استدعاء `inspectFacebookToken` (موجود في `src/server/facebook.functions.ts`) → يحسب `daysUntilExpiry` من `expiresAt`.
- واتساب: `supabase.from("whatsapp_settings").select("is_connected, last_connected_at").maybeSingle()`.
- يحفظ النتيجة في React state، يعيد المزامنة كل 5 دقائق + عند العودة إلى التبويب (`visibilitychange`).
- يعيد: `{ facebook: ChannelState, whatsapp: ChannelState, refresh }` حيث `ChannelState = { status: "connected"|"disconnected"|"expiring"|"expired"|"loading", daysLeft?: number, label: string }`.

**2. مكوّن صغير** `src/components/dashboard/ChannelStatusDot.tsx`:
- props: `status`, `daysLeft?`, `compact?` (للوضع المطوي), `lang`.
- يرندّر النقطة الملوّنة + (اختياريًا) شارة الأيام + tooltip.
- خرائط الألوان: connected=`bg-emerald-500`, expiring=`bg-amber-500`, expired=`bg-red-500`, disconnected=`bg-muted-foreground/40`, loading=`bg-muted-foreground/30 animate-pulse`.

**3. تعديل** `src/components/dashboard/DashboardLayout.tsx`:
- استدعاء `useChannelStatus()` داخل المكوّن.
- في زر المجموعة (`item.kind === "group"`): إذا `item.key === "facebook"` أو `"whatsapp"` نمرّر الحالة المناسبة ونرندّر `<ChannelStatusDot />`:
  - في الوضع الموسّع: بين أيقونة القناة والنص (أو يسار chevron).
  - في الوضع المطوّع: مطلق فوق الأيقونة.

**4. i18n**: نصوص الحالات داخل الـ hook نفسه (ar/en) لتفادي تضخّم ملف اللوحة.

## الملفات المتأثرة
```text
src/hooks/useChannelStatus.ts                  (جديد)
src/components/dashboard/ChannelStatusDot.tsx  (جديد)
src/components/dashboard/DashboardLayout.tsx   (تعديل: استدعاء hook + رندر النقطة)
```

## اختبار
1. بدون توكن فيسبوك ⇒ نقطة رمادية بجانب "فيسبوك".
2. بعد ربط توكن صالح ⇒ نقطة خضراء نابضة.
3. توكن قريب الانتهاء (≤7 أيام) ⇒ نقطة كهرمانية + شارة الأيام.
4. توكن منتهي ⇒ نقطة حمراء + tooltip "أعد الربط".
5. تفعيل/تعطيل واتساب يحدّث النقطة فورًا (refresh عند الرجوع للتبويب).
6. التحقق من الوضعين: شريط موسّع + شريط مطوّع (icon-only).
7. RTL + LTR: موقع النقطة والشارة صحيح في الاتجاهين.