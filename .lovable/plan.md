## الهدف
تعديل `src/routes/dashboard.whatsapp.inbox.tsx` ليتطابق بصرياً مع صفحة المحادثات في Bot-Xtra — نفس تقسيم البانلز، نفس شكل الشات (فقاعات واتساب)، نفس درجات اللون البنفسجي. لا تغييرات في البيانات أو الـ APIs.

## النطاق
- شكل وألوان فقط.
- نفس server functions (`listConversations`, `getConversationMessages`, `sendChatMessage`, `toggleConversationAi`, `markConversationRead`).
- لا CRM، لا تاجز، لا مهام، لا Sales Intelligence — تتأجل لمراحل لاحقة.

## التغييرات البصرية

### 1. التخطيط العام
- استبدال الشبكة الحالية `grid-cols-[340px_1fr]` بـ ResizablePanelGroup من `@/components/ui/resizable` بحجم افتراضي 28% / 72%.
- ارتفاع كامل: `h-[calc(100dvh-7rem)]` بدون حواف خارجية مزدوجة — البانلز نفسها تحمل البوردر.
- الخلفية: تدرّج خفيف بنفسجي على المساحة الفاضية (`bg-gradient-to-br from-primary/[0.04] via-background to-primary/[0.06]`).

### 2. عمود قائمة المحادثات (Sidebar)
- هيدر فيه:
  - عنوان «المحادثات» + Badge عدد غير المقروء الإجمالي.
  - زرّان أيقونيان: تحديث + تفعيل/كتم صوت الإشعارات (UI فقط، يستخدم localStorage زي Bot-Xtra).
- بحث برأس مستدير `rounded-2xl`، أيقونة Search داخل الـ input.
- شريط فلاتر سريع (Chips): **الكل · غير مقروء · AI مفعّل** — فلترة محلية على نفس `convQuery.data`.
- عناصر القائمة:
  - Avatar دائري 44px بتدرّج بنفسجي + حروف أولى بيضاء عند عدم وجود صورة.
  - السطر الأول: اسم بولد + وقت آخر رسالة (مع شارة “الآن/د/س/أمس” بالعربي/إنجليزي).
  - السطر الثاني: أيقونة نوع الرسالة (📷 صورة، 🎙 صوت، 📄 ملف) لو الرسالة media + نصها المختصر.
  - شارات يمين: نقطة AI + شارة دائرية لعدد غير المقروء.
  - عند التحديد: خلفية `bg-primary/8` + بوردر يسار/يمين (RTL-aware) بلون primary.
- Divider خفيف بين العناصر (`divide-border/30`).

### 3. عمود الشات (Chat Pane)
- **ChatHeader** ثابت بأعلى الشات:
  - Avatar كبير + اسم + رقم.
  - يمين: زر Toggle بشكل Switch (وليس زر) لتفعيل/إيقاف AI مع نص توضيحي صغير.
  - زر «بحث في المحادثة» (UI فقط مبدئياً، يفلتر الرسائل لو في وقت — وإلا يفتح input أعلى منطقة الرسائل).
- **منطقة الرسائل**:
  - خلفية «واتساب» ناعمة: نمط بسيط (gradient + opacity منخفض جداً) بدل اللون السادة.
  - فقاعات:
    - الصادرة: `bg-gradient-to-br from-primary to-[oklch(0.55_0.28_295)] text-primary-foreground` بزوايا `rounded-2xl rounded-br-sm` (RTL: `rounded-bl-sm`).
    - الواردة: `bg-card border border-border/60 text-foreground` بزوايا `rounded-2xl rounded-bl-sm` (RTL: `rounded-br-sm`).
    - الظل خفيف `shadow-sm`، الـ max-width: 70%.
    - الوقت داخل الفقاعة + أيقونة Bot صغيرة لو الرد من AI، + double-check للرسائل الصادرة (شكل فقط).
  - فواصل تاريخ بين الأيام (اليوم/أمس/التاريخ الكامل) — شريحة مركزية صغيرة.
- **Composer**:
  - شكل «صف» بحواف 2xl، مع أزرار أيقونية يسار: 😊 إيموجي + 📎 مرفقات (UI placeholder تعرض toast «قريباً»).
  - Textarea بدون بوردر داخل الـ wrapper، auto-grow حتى 5 أسطر.
  - زر إرسال دائري بتدرّج primary + Loader أثناء الإرسال.

### 4. الحالة الفارغة
- بدلاً من نص بسيط: لوحة مركزية بأيقونة كبيرة بإطار `ring-1 ring-primary/20`، عنوان + شرح + 3 «اقتراحات» (chip-style) مثل: «اربط حساب واتساب»، «جرّب الذكاء الاصطناعي»، «استيراد جهات اتصال» — لينكات/أزرار شكلية فقط (الأول يربط لـ `/dashboard/whatsapp/accounts`).

### 5. تجاوب الموبايل
- على الشاشات الصغيرة: عرض القائمة فقط، وعند الاختيار نخفيها ونعرض الشات بـ slide-in خفيف + زر رجوع بأيقونة سهم.
- استخدام `useIsMobile` الموجود.

## ملفات ستتغيّر
- `src/routes/dashboard.whatsapp.inbox.tsx` — إعادة بناء الـ JSX بنفس البيانات والـ hooks الحالية، مع تقسيم داخلي لكومبوننتس صغيرة (ConversationRow, ChatBubble, EmptyState, Composer) داخل نفس الملف للحفاظ على البساطة.

## ملاحظات
- لا migrations، لا server functions جديدة، لا dependencies جديدة (`resizable` و`avatar` و`switch` موجودة في `src/components/ui/`).
- ألوان الـ tokens الحالية في `src/styles.css` كافية (primary بنفسجي بالفعل) — لا تعديل على ملف الـ CSS.
- اختبار سريع في الـ preview بعد التنفيذ: عرض القائمة، اختيار محادثة، إرسال رسالة، تبديل AI.
