# Research: استخراج إنستجرام — قرارات Phase 0

**التاريخ**: 2026-08-18 | **المرجع**: [spec.md](./spec.md) + فحص الكود القائم

## R1: تخزين الجلسات — جداول منفصلة أم عمود platform؟

- **القرار**: جدولان جديدان `ig_sessions` و`ig_browser_profiles` (مرآة مخطط fb_*)
- **المبرر**: الحد الأدنى من التغيير الآمن — سياسات RLS وكل hooks الواجهة لـ `fb_sessions` تعمل دون مساس؛ فشل迁移 IG لا يهدد جلسات فيسبوك الحية في الإنتاج. الـ spec (FR-002) يشترط عزلاً تاماً للجلسات
- **البدائل المرفوضة**: عمود `platform` داخل `fb_sessions` — أنظف نظرياً لكنه يلمس 6+ سياسات RLS قائمة وكل استعلام في `supabase.ts`/hooks الواجهة، مخاطرة regression غير مبررة في v1
- **مرجع التنفيذ** (T002): `parseCookiesToPlaywright` في `extraction-service/src/services/supabase.ts:55` (غير مُصدَّر حالياً — يُصدَّر في T005 لإعادة الاستخدام في `ig-supabase.ts`)؛ `getSessionAndCookies` في `supabase.ts:129` و`storeResults` في `supabase.ts:266` و`resolveProxyForSession` في `supabase.ts:436` نماذج تُعكس على IG

## R2: طريقة الاستخراج — DOM أم GraphQL الخاص؟

- **القرار**: أتمتة واجهة instagram.com web عبر Playwright + stealth (نفس مكدس فيسبوك) مع التقاط استجابات الشبكة أثناء التمرير عند توفرها (نمط `graphql-interceptor.ts` القائم) — بدون استدعاء مباشر لـ endpoints الخاصة بـ i.instagram.com
- **المبرر**: نفس البنية التحتية والحفظ التدريجي وآليات الحظر؛ التقاط الشبكة يزيد الدقة دون مخاطرة إضافية لأنه passive
- **البدائل المرفوضة**: الاستدعاء المباشر لـ private GraphQL API (أسرع لكن توقيع الطلبات `X-Ig-App-Id`/headers يتغير، ونمط الطلبات غير الطبيعية يرفع معدل الحظر بشكل حاد — يتعارض مع هدف حماية الجلسات)

## R3: آلية كل نوع استخراج على واجهة الـ web

- **القرار** (مبني على سلوك الواجهة المعروف):
  - **followers/following**: فتح الملف → النقر على عدّاد المتابعين → dialog بقائمة lazy-loaded → تمرير داخل الـ dialog حتى النفاد أو ceiling؛ العدد الإجمالي من رأس الملف
  - **post_commenters**: فتح رابط المنشور → تحميل التعليقات → "View more comments"/التمرير داخل صندوق التعليقات loop؛ الحد المرجعي = عدّاد التعليقات الظاهر
  - **hashtag_posts**: `instagram.com/explore/tags/{tag}/` → grid + فتح المودال للتمرير (النتائج جزئية بحكم إنستجرام — يُعلن دوماً)
  - **profile_info**: فتح الملف مباشرة وقراءة الرأس والـ bio؛ استخلاص email/phone من نص الـ bio بـ regex موحّد (مع تطبيع الأرقام المصرية: مسافات/شرطات/+20)
- **المبرر**: كلها مسارات تراها الجلسة المسجلة نفسها — متوافقة مع "القاعدة الحاكمة" في الـ spec

## R4: توحيد النتائج مع جهات فيسبوك (قرار Clarifications: A)

- **القرار**: إعادة استخدام جدول `extraction_results` مع عمود جديد `platform TEXT NOT NULL DEFAULT 'facebook'`؛ نتائج IG تخزن `fb_id = username` (مفتاح dedupe) و`data.username/full_name/profile_url/avatar/bio_fields` و`fb_type` من أنواع `ig_*`
- **المبرر**: DEFAULT يبقي كل الكود القائم سليماً؛ الفلترة حسب المنصة استعلام واحد؛ جهات IG تدخل نفس صفحة الجهات (Contacts) بلا مزج تلقائي
- **البدائل المرفوضة**: جدول `ig_results` منفصل — يكسر قرار الدمج A ويتطلب مضاعفة كل منطق التصدير/العرض

## R5: الإثراء بشارة ثقة (قرار Clarifications: C)

- **القرار**: توسيع `enrichment-service.ts` بمسار IG: (1) استخلاص phone/email من bio قبل أي استعلام → مطابقة مباشرة بأعمدة Egypt DB (`Phone`/`email`) → شارة "مؤكدة"؛ (2) وإلا مطابقة `full_name` مع `first_name || ' ' || last_name` → شارة "محتملة"
- **المبرر**: بيانات bio قطعية، الاسم احتمالي (أسماء عربية شائعة)؛ الشارة تُخزن في `metadata.match_confidence` وتظهر في الواجهة والتصدير
- **ملاحظة**: مطابقة الاسم تُقيَّد بـ exact-match على الاسم الكامل فقط (لا fuzzy في v1) — أرخص وأقل التباساً

## R6: الجلسات المتوازية وإعادة التوزيع (ملاحظة المستخدم)

- **القرار**: نفس آلية فيسبوك الحالية في `extract.ts` (مصفوفة `session_ids` + إنشاء context لكل جلسة + تمرير `secondaryPages` للمستخرِج)؛ إضافة IgBaseExtractor.switchToNextSession (موروث جاهز من BaseExtractor) + توزيع شعاعي: كل جلسة تفتح نفس المصدر وتتمرر بإزاحة مختلفة، والدمج عبر dedupe على username
- **المبرر**: إعادة استخدام كاملة للنمط القائم — نفس صفحة إنشاء المهمة ستعرض اختيار جلسات IG متعددة كما في fb
- **مرجع التنفيذ** (T002): `switchToNextSession` في `extraction-service/src/extractors/base.ts:443`، `processBatch` في `base.ts:597`، `checkCanceled` في `base.ts:592`، `smartScrollDialog` في `base.ts:520`، `detectRateLimit` في `base.ts:482`، `delay`/`restDelay` في `base.ts:471`/`base.ts:430` (قابلة للتخصيص في IgBaseExtractor)

## R7: الحظر وrate limiting

- **القرار**: pacing لكل جلسة 1.5–3 ثوانٍ بين التمريرات (أطول من فيسبوك 600ms)، راحة 15 ثانية كل 10 تمريرات، وعند رصد "Action Blocked"/checkpoint: إيقاف تلك الجلسة فوراً + محاولة switchToNextSession + تعليم الجلسة "disconnected" في قاعدة البيانات؛ إن لم تبق جلسات → المهمة "paused" قابلة للاستئناف
- **المبرر**: IG يحظر أسرع من fb — الأولوية لحماية الجلسات على السرعة (الـ spec: Edge Cases)

## R8: تعارض IP وproxy

- **القرار**: نفس نمط fb: `IG_PROXY_{SESSION_ID}` في `.env` يُحل عبر `resolveProxyForSession` المعمم؛ الجلسة تُنشأ context بخيارات instagram.com (UA/viewport مستقل) عبر `ig-context-manager.ts` جديد يشارك browserPool نفسه
- **المبرر**: لا يمكن دمج context-manager الحالي كما هو لأنه يتحقق من facebook.com — الفصل يمنع تلويث منطق fb بفحص ig

## R9: الكوكيز الحاسمة وفحص الجلسة

- **القرار**: الجلسة تعتبر صالحة عند وجود `sessionid` + `ds_user_id` + `csrftoken`؛ الفحص يفتح `instagram.com/` ويجب ألا يُعاد توجيه إلى `/accounts/login`؛ اسم الحساب وصورته يُقرآن من عنصر الترويسة ويُخزنان في `ig_sessions`
- **المبرر**: نفس دلالات c_user/xs في fb — يغذي FR-001/FR-002

## R10: الربط بالواجهة والترجمة

- **القرار**: صفحتان جديدتان (جلسات IG + إنشاء مهمة IG) بنفس مكونات fb القائمة؛ النتائج والتصدير والجهات تُعاد كما هي مع فلتر منصة؛ كل النصوص الجديدة في `ar.json` و`en.json` معاً (شرط AGENTS.md)
- **المبرر**: Minimum Safe Change + شرط الترجمة الإلزامي

## خلاصة الغموضات

كل NEEDS CLARIFICATION في Technical Context = لا شيء متبقٍ — البنود أعلاه تحسم القرارات العشرة الجوهرية، وتفاصيل التنفيذ الدقيقة (selectors الدقيقة وحجم الدفعات) تُثبَّت أثناء التنفيذ عبر مهام tasks.md مع اختبارات quickstart.md.
