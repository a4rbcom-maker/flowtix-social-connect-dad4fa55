# Tasks: إعادة تصميم واجهة محادثات واتساب الاحترافية

**Input**: Design documents from `/specs/008-wa-inbox-redesign/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: لا يوجد إطار اختبار في المشروع — التحقق يدوي عبر quickstart.md

**Organization**: المهام مجمّعة حسب User Story لتمكين التنفيذ والاختبار المستقل لكل قصة.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: قابل للتنفيذ المتوازي (ملفات مختلفة، لا تبعيات)
- **[Story]**: US1-US8 — القصة المرتبط بها
- مسارات الملفات دقيقة لكل مهمة

---

## Phase 1: Setup (البنية التحتية المشتركة)

**الهدف**: تثبيت المكتبات الجديدة وإنشاء البنية الأساسية للمكونات

- [ ] T001 تثبيت `@tanstack/react-virtual` و `emoji-picker-react` عبر `npm install @tanstack/react-virtual emoji-picker-react`
- [ ] T002 إنشاء مجلد `src/components/inbox/` للمكونات الجديدة
- [ ] T003 [P] إنشاء `src/types/inbox.types.ts` بكل الـ interfaces: `ConvFilter`, `SendInput`, `MediaAttachment`, `AiAction`, `SavedReply`, `SavedReplyCategory`

---

## Phase 2: Foundational (متطلبات أساسية لحظية)

**الهدف**: إصلاح ثغرات Realtime وتحضير بنية WaInboxPage كـ orchestrator قبل أي قصة

**⚠️ حرج**: لا يمكن بدء أي User Story قبل إكمال هذه المرحلة

- [ ] T004 إصلاح فلتر Realtime في `src/hooks/useWaInbox.ts`: تغيير `user_id=eq.${ws}` إلى `workspace_id=eq.${workspaceId}` في اشتراك `wa-conv`
- [ ] T005 إصلاح event Realtime في `src/hooks/useWaInbox.ts`: تغيير `INSERT` إلى `*` في اشتراك `wa-msg` لتحديث status الرسائل (delivered/read/failed)
- [ ] T006 إصلاح `addNote` في `src/hooks/useWaInbox.ts`: إضافة `onSuccess` يستدعي re-fetch للملاحظات (تحويل الملاحظات من state محلي إلى React Query أو invalidate)
- [ ] T007 إصلاح `userId: ""` في `WaInboxPage.tsx`: تمرير `authSession?.user?.id` الفعلي عند استدعاء `muts.addNote`
- [ ] T008 إعادة هيكلة `src/pages/dashboard/whatsapp/WaInboxPage.tsx` إلى orchestrator: رفع الـ state المشترك (`activeConvId`, `filter`, `searchQuery`, `showContactPanel`, `draftText`) وتغيير الـ JSX إلى هيكل ثلاثي الأعمدة بأماكن للمكونات الجديدة (placeholders مؤقتة لـ `<div>`)
- [ ] T009 [P] إصلاح memory leak في `WaInboxPage.tsx`: استدعاء `URL.revokeObjectURL` عند نجاح إرسال المرفق قبل `setAttachment(null)`
- [ ] T010 [P] إضافة validation لحجم الملف (16MB max) وعرض رسالة خطأ عند التجاوز في `WaInboxPage.tsx` (نقل لاحقاً إلى Composer)

**Checkpoint**: البنية جاهزة، Realtime يعمل بشكل صحيح، WaInboxPage يدير state عام — يمكن بدء User Stories

---

## Phase 3: User Story 1 — تصفح وإدارة قائمة المحادثات بكفاءة (Priority: P1) 🎯 MVP

**الهدف**: قائمة محادثات احترافية مع بحث فوري، فلترة، Badge، infinite scroll

**Independent Test**: فتح الصفحة، التحقق من ظهور قائمة المحادثات بالفلاتر (الكل/غير مقروء/مميز/مؤرشف)، البحث الفوري، Badge للرسائل غير المقروءة، النقر يفتح المحادثة

### التنفيذ

- [ ] T011 [P] [US1] إنشاء `src/components/inbox/ConversationItem.tsx`: عنصر محادثة واحدة (avatar، اسم، آخر رسالة، وقت نسبي، Badge غير مقروء، نجمة مميزة) — يستخدم logical CSS (`ps-`, `pe-`)
- [ ] T012 [P] [US1] إنشاء `src/components/inbox/EmptyStates.tsx`: حالات فارغة متعددة (`no-conv`, `no-msg`, `error`, `loading`) مع رسائل عربية وأيقونات
- [ ] T013 [US1] إنشاء `src/components/inbox/ConversationList.tsx`: قائمة المحادثات كاملة — شريط بحث (مربوط بـ `onSearchChange`)، تبويبات فلترة (`ConvFilter`)، عدّاد لكل تبويب، infinite scroll، استخدام `ConversationItem` و `EmptyStates`. Props حسب contract في `contracts/inbox-components.md`
- [ ] T014 [US1] ربط `ConversationList` في `WaInboxPage.tsx` مكان placeholder العمود الأول، تمرير `conversations`, `activeConvId`, `searchQuery`, `filter`, handlers المناسبة
- [ ] T015 [US1] إضافة ترجمات عربية/إنجليزية في `src/i18n/locales/ar.json` و `src/i18n/locales/en.json` لكل نصوص قائمة المحادثات (أسماء الفلاتر، placeholders البحث، رسائل Empty States)

**Checkpoint**: قائمة المحادثات تعمل بشكل كامل — بحث، فلترة، Badge، تحديد نشط، Empty States

---

## Phase 4: User Story 2 — محادثة احترافية مع عرض رسائل غني (Priority: P1)

**الهدف**: عمود محادثة بـ Header غني، عرض رسائل مميز (incoming/outgoing)، وسائط كاملة، حالة تسليم، فواصل زمنية، pagination

**Independent Test**: اختيار محادثة، التحقق من Header (اسم/رقم/حالة)، تمييز بصري للواردة والصادرة، عرض صور/فيديو/صوت/ملفات، حالة التسليم (✓/✓✓/✓✓ أزرق)، pagination عند scroll للأعلى

### التنفيذ

- [ ] T016 [P] [US2] إنشاء `src/components/inbox/ChatHeader.tsx`: Header المحادثة — avatar، اسم، رقم هاتف، حالة الاتصال، آخر ظهور، زر تمييز، زر أرشفة، زر فتح لوحة العميل. Props حسب contract
- [ ] T017 [P] [US2] إنشاء `src/components/inbox/MessageBubble.tsx`: فقاعة رسالة واحدة — تمييز incoming (align-self: start) / outgoing (align-self: end)، عرض الوسائط حسب النوع (image/video/audio/document)، حالة التسليم (pending/sent/delivered/read/failed)، دعم الرسالة المقتبسة، وقت. استخراج helper functions (`messageHasMedia`, `getMediaUrl`, `guessMediaType`) من `WaInboxPage` القديم
- [ ] T018 [US2] إنشاء `src/components/inbox/MessageList.tsx`: حاوية الرسائل — scroll للأسفل تلقائياً، فواصل زمنية بين الرسائل المت Винاسة (> ساعة)، pagination (تحميل رسائل أقدم عند scroll للأعلى)، استخدام `MessageBubble`. Props حسب contract
- [ ] T019 [US2] إنشاء `src/components/inbox/ChatPanel.tsx`: العمود الثاني كاملاً — يجمع `ChatHeader` + `MessageList` + `Composer` (placeholder مؤقت). يعالج `isLoading` و `EmptyStates`. Props حسب contract
- [ ] T020 [US2] ربط `ChatPanel` في `WaInboxPage.tsx` مكان placeholder العمود الثاني، تمرير `conv`, `messages`, handlers
- [ ] T021 [US2] إضافة ترجمات في `ar.json` و `en.json` لنصوص Header، حالات التسليم، رسائل Empty/Error

**Checkpoint**: المحادثة تعرض بشكل كامل وغني — Header، رسائل مميزة، وسائط، حالات تسليم، pagination

---

## Phase 5: User Story 3 — صندوق كتابة متقدم احترافي (Priority: P1)

**الهدف**: صندوق كتابة غني بـ Emoji Picker، مرفقات، تسجيل صوتي، سحب وإفلات، ردود محفوظة، اختصارات، مسودات

**Independent Test**: الضغط على صندوق الكتابة، التحقق من: Emoji Picker يعمل، مرفقات (صورة/فيديو/صوت/ملف) تعمل، سحب وإفلات يعمل، تسجيل صوتي يعمل، Enter للإرسال، Shift+Enter لسطر جديد، حفظ المسودة

### التنفيذ

- [ ] T022 [P] [US3] إنشاء `src/components/inbox/EmojiPicker.tsx`: wrapper حول `emoji-picker-react` — تكامل مع RTL، الوضع الداكن (`theme="auto"`)، بحث، إدراج عند المؤشر، إغلاق بالنقر خارج
- [ ] T023 [P] [US3] إنشاء `src/components/inbox/AttachmentMenu.tsx`: قائمة منبثقة بأنواع المرفقات (صورة/فيديو/صوت/مستند) — كل خيار يفتح file input بـ `accept` المناسب، validation حجم (16MB)، معاينة
- [ ] T024 [P] [US3] إنشاء `src/hooks/useVoiceRecorder.ts`: hook للتسجيل الصوتي باستخدام `MediaRecorder` API — `start()`, `stop()`, `cancel()`, state (`idle`/`recording`/`recorded`), مدة، تحليل الصوت للعرض البصري
- [ ] T025 [US3] إنشاء `src/components/inbox/VoiceRecorder.tsx`: مكون بصري للتسجيل — زر ميكروفون، مؤشر الموجة الصوتية (AnalyserNode + Canvas)، عرض المدة، أزرار إرسال/إلغاء. يستخدم `useVoiceRecorder`
- [ ] T026 [US3] إنشاء `src/components/inbox/Composer.tsx`: صندوق الكتابة الكامل — يجمع `EmojiPicker`, `AttachmentMenu`, `VoiceRecorder`, textarea مع Enter/Shift+Enter، حفظ المسودة في state مرفوع، معاينة المرفقات، drag & drop overlay. Props حسب contract
- [ ] T027 [US3] ربط `Composer` في `ChatPanel.tsx` بدل placeholder، تمرير `onSend`, `draftText`, `onDraftChange`
- [ ] T028 [US3] إضافة منطق drag & drop على `Composer`: `onDragOver`/`onDrop` لالتقاط الملفات، overlay بصري عند السحب، تمرير الملف لـ `AttachmentMenu` logic
- [ ] T029 [US3] إضافة منطق حفظ المسودة: عند مغادرة محادثة، حفظ النص في `drafts` map (key: conversationId) في state المرفوع، استرجاع عند العودة
- [ ] T030 [US3] إضافة ترجمات في `ar.json` و `en.json` لنصوص المرفقات، التسجيل، المسودة، tooltips الأزرار

**Checkpoint**: صندوق الكتابة متقدم بالكامل — إيموجي، مرفقات، تسجيل صوتي، سحب وإفلات، مسودات

---

## Phase 6: User Story 4 — الردود المحفوظة والقوالب الجاهزة (Priority: P2)

**الهدف**: نظام ردود محفوظة قابل للإدارة مع اختصارات `/` واقتراحات منبثقة

**Independent Test**: كتابة `/` في صندوق الكتابة تُظهر قائمة الردود، إنشاء رد جديد، تعديل/حذف، البحث في الردود

### التنفيذ

- [ ] T031 [P] [US4] إنشاء `src/hooks/useSavedReplies.ts`: hook كامل لإدارة الردود المحفوظة في localStorage — `replies`, `addReply`, `updateReply`, `deleteReply`, `searchReplies`, `getByShortcut`، seeding 3 ردود افتراضية عند أول استخدام، validation (shortcut فريد، regex)
- [ ] T032 [US4] إنشاء `src/components/inbox/SavedRepliesPopover.tsx`: popover يظهر عند كتابة `/` في Composer — قائمة ردود مطابقة، بحث فوري، اختيار يُدرج النص. كما يحتوي على زر "إدارة الردود" يفتح modal/diried لإدارة CRUD كاملة
- [ ] T033 [US4] دمج `SavedRepliesPopover` في `Composer.tsx`: اكتشاف كتابة `/` في textarea، استخراج النص بعد `/`، عرض popover، إدراج النص عند الاختيار (استبدال `/shortcut` بالـ body)
- [ ] T034 [US4] إضافة ترجمات في `ar.json` و `en.json` لأسماء التصنيفات (ترحيب/متابعة/عروض/تذكير/شكر/استبيان)، رسائل الإدارة، placeholders

**Checkpoint**: الردود المحفوظة تعمل — إنشاء، تعديل، حذف، اختصارات `/`، اقتراحات منبثقة

---

## Phase 7: User Story 5 — مساعد الذكاء الاصطناعي في صندوق الكتابة (Priority: P2)

**الهدف**: زر AI بجانب صندوق الكتابة يقدم إجراءات (إعادة صياغة، تصحيح، تغيير نبرة، اقتراح رد)

**Independent Test**: كتابة نص، الضغط على AI، اختيار إجراء، التحقق من استبدال النص + إمكانية التراجع + حالة Loading + رسالة خطأ مهذبة عند الفشل

### التنفيذ

- [ ] T035 [P] [US5] إضافة endpoint `POST /ai/compose` في `extraction-service/src/ai/routes.ts`: يقبل `{workspace_id, action, text?, context?}`، يستخدم `kieChat` الموجود مع system prompts حسب action، يُرجع `{success, content, error?}`
- [ ] T036 [P] [US5] إنشاء `src/lib/inbox-ai.ts`: دالة `composeWithAi` التي تستدعي `${VITE_EXTRACTION_API_URL}/ai/compose` — تأخذ workspaceId من auth، action، text، context. تُرجع `{success, content, error?}`
- [ ] T037 [US5] إنشاء `src/components/inbox/AiAssistant.tsx`: زر AI + قائمة إجراءات منبثقة (rephrase, fix_grammar, professional, casual, shorten, expand, translate, suggest_reply) — حالة Loading، حفظ النص الأصلي للتراجع، عرض الخطأ، استخدام `composeWithAi`. Props حسب contract
- [ ] T038 [US5] دمج `AiAssistant` في `Composer.tsx`: زر AI بجانب الـ textarea، عند النتيجة استبدال النص، تمرير `contextMessages` (آخر 5 رسائل) لاقتراح رد
- [ ] T039 [US5] إضافة زر تراجع (undo) في `Composer.tsx`: يظهر بعد أي تعديل من AI، يستعيد النص الأصلي المحفوظ
- [ ] T040 [US5] إضافة ترجمات في `ar.json` و `en.json` لأسماء الإجراءات (إعادة صياغة، تصحيح، الخ)، رسائل Loading، رسائل الخطأ

**Checkpoint**: مساعد AI يعمل — جميع الإجراءات، تراجع، حالات Loading/Error

---

## Phase 8: User Story 6 — لوحة تفاصيل العميل القابلة للطي (Priority: P2)

**الهدف**: عمود ثالث قابل للطي يعرض بيانات العميل، وسوم، ملاحظات، حملات، إحصائيات

**Independent Test**: فتح محادثة، الضغط على "تفاصيل العميل"، التحقق من ظهور/إخفاء العمود، عرض البيانات، إضافة ملاحظة، إضافة وسم

### التنفيذ

- [ ] T041 [P] [US6] إنشاء `src/components/inbox/ContactPanel.tsx`: العمود الثالث كامل — بيانات العميل (اسم، رقم، صورة، شركة، بلد)، وسوم (عرض + إضافة/حذف)، ملاحظات (عرض + إضافة)، حملات مرتبطة، تاريخ أول تواصل، عدد الرسائل. Props حسب contract. قابلة للطي بانتقال سلس (`transition-all`)
- [ ] T042 [US6] ربط `ContactPanel` في `WaInboxPage.tsx` مكان placeholder العمود الثالث، تمرير `conv`, `notes`, handlers، التحكم بـ `showContactPanel`
- [ ] T043 [US6] ربط زر "تفاصيل العميل" في `ChatHeader.tsx` بتبديل `showContactPanel` في state المرفوع
- [ ] T044 [US6] إضافة منطق إدارة الملاحظات: استخدام `useWaInboxMutations().addNote` مع `userId` الفعلي و `onSuccess` لتحديث القائمة (يعتمد على T006)
- [ ] T045 [US6] إضافة ترجمات في `ar.json` و `en.json` لكل نصوص لوحة العميل

**Checkpoint**: لوحة تفاصيل العميل تعمل — عرض، طي، ملاحظات، وسوم

---

## Phase 9: User Story 7 — أدوات الرسائل والبحث داخل المحادثة (Priority: P3)

**الهدف**: أدوات سريعة على كل رسالة (نسخ، اقتباس، إعادة إرسال، تنزيل) + بحث داخل المحادثة

**Independent Test**: hover فوق رسالة → تظهر أدوات، نسخ يعمل، اقتباس يظهر فوق الصندوق، بحث يبرز النتائج

### التنفيذ

- [ ] T046 [P] [US7] إنشاء `src/components/inbox/MessageToolbar.tsx`: شريط أدوات يظهر عند hover على `MessageBubble` — أزرار (نسخ، اقتباس، إعادة إرسال، تنزيل للوسائط). Props حسب contract. استخدام `navigator.clipboard.writeText` للنسخ + toast تأكيد
- [ ] T047 [US7] دمج `MessageToolbar` في `MessageBubble.tsx`: عرض عند `hover` (CSS group-hover أو state)، تمرير handlers من `MessageList`
- [ ] T048 [US7] تنفيذ منطق الاقتباس: عند الضغط على "اقتباس" في `MessageToolbar`، استدعاء `onQuoteMessage` الذي يمرر الرسالة إلى `Composer` لعرضها كـ quoted preview فوق الصندوق. إضافة `quotedMessage` state في `WaInboxPage` وتمريره لـ `Composer`
- [ ] T049 [P] [US7] إنشاء `src/components/inbox/InboxSearch.tsx`: شريط بحث داخل المحادثة — يظهر/يختفي بزر، بحث client-side في `messages` (نص، نوع، تاريخ)، إبراز النتائج في `MessageList`، تنقل بين النتائج (التالي/السابق)، عدّاد نتائج
- [ ] T050 [US7] دمج `InboxSearch` في `ChatPanel.tsx`: زر بحث في Header، تمرير `searchQuery` لـ `MessageList` لإبراز المطابقات
- [ ] T051 [US7] إضافة ترجمات في `ar.json` و `en.json` لأسماء الأدوات، رسائل النسخ، placeholders البحث

**Checkpoint**: أدوات الرسائل والبحث داخل المحادثة يعملان بشكل كامل

---

## Phase 10: User Story 8 — أداء عالي وتجاوب كامل (Priority: P3)

**الهدف**: Virtualization لـ 100K رسالة، تجاوب كامل (Desktop/Tablet/Mobile)، حالات Loading/Skeleton

**Independent Test**: فتح محادثة بـ 10,000+ رسالة و scroll سلس ≥ 50fps، تصغير النافذة للـ Tablet/Mobile والتحقق من التكيف

### التنفيذ

- [ ] T052 [US8] تطبيق Virtualization في `MessageList.tsx`: استخدام `useVirtualizer` من `@tanstack/react-virtual` — `count`, `getScrollElement`, `estimateSize` (dynamic heights)، render فقط العناصر المرئية. الحفاظ على auto-scroll للأسفل و pagination للأعلى
- [ ] T053 [US8] تطبيق التجاوب في `WaInboxPage.tsx`: Desktop (≥1280px: 3 أعمدة)، Tablet (768-1279px: عمودان + لوحة قابلة للطي كـ overlay)، Mobile (<768px: عمود واحد + تبديل بالضغط بين القائمة والمحادثة). استخدام Tailwind responsive classes (`hidden md:flex`, `flex-col md:flex-row`)
- [ ] T054 [US8] إضافة Skeleton loading states في `ConversationList` و `MessageList`: استخدام `Skeleton` component الموجود في `@/components/ui/skeleton` للـ loading بدلاً من spinner
- [ ] T055 [US8] إضافة Empty States في `ChatPanel` عند عدم وجود محادثة مفتوحة: رسالة "اختر محادثة لبدء المراسلة" مع أيقونة
- [ ] T056 [US8] التحقق من RTL في جميع المكونات الجديدة: مراجعة كل ملف في `src/components/inbox/` للتأكد من استخدام logical CSS فقط (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`)، لا `rtl:` variant، لا `left/right` ثابت

**Checkpoint**: الواجهة تتعامل مع 100K رسالة بسلاسة، تتكيف مع جميع الشاشات، حالات Loading/Empty كاملة

---

## Phase 11: Polish & Cross-Cutting Concerns

**الهدف**: تحسينات نهائية، تنظيف، ترجمات، تحقق شامل

- [ ] T057 [P] مراجعة وتنظيف الكود الميت في `WaInboxPage.tsx`: إزالة helper functions المنقولة لمكونات جديدة، إزالة imports غير المستخدمة، التأكد من عدم وجود logic مكرر
- [ ] T058 [P] إضافة `i18n` لجميع النصوص الجديدة: مراجعة شاملة لـ `ar.json` و `en.json` للتأكد من تغطية كل النصوص في المكونات الجديدة
- [ ] T059 تشغيل `npm run typecheck` وإصلاح أي أخطاء TypeScript في الملفات الجديدة
- [ ] T060 تشغيل `npm run build` وإصلاح أي أخطاء بناء
- [ ] T061 تنفيذ سيناريوهات التحقق في `quickstart.md`: اختبار كل سيناريو (10 سيناريوهات) وتأكيد عمل جميع الميزات
- [ ] T062 [P] تحسين أداء Realtime: استخدام `queryClient.setQueryData` لتحديث الرسالة المعنية من payload الـ Realtime بدلاً من invalidation كامل (تحسين اختياري)
- [ ] T063 مراجعة أمنية: التأكد من عدم تسريب API keys، validation كل المدخلات، workspace_id scoping في كل query

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: لا تبعيات — يبدأ فوراً
- **Foundational (Phase 2)**: يعتمد على Phase 1 — **يوقف جميع الـ User Stories**
- **US1 (Phase 3)**: يعتمد على Phase 2 فقط
- **US2 (Phase 4)**: يعتمد على Phase 2 فقط (مستقل عن US1)
- **US3 (Phase 5)**: يعتمد على Phase 2 + US2 (Composer يُركّب في ChatPanel)
- **US4 (Phase 6)**: يعتمد على Phase 2 + US3 (يُدمج في Composer)
- **US5 (Phase 7)**: يعتمد على Phase 2 + US3 (يُدمج في Composer)
- **US6 (Phase 8)**: يعتمد على Phase 2 فقط (مستقل)
- **US7 (Phase 9)**: يعتمد على Phase 2 + US2 (أدوات على MessageBubble)
- **US8 (Phase 10)**: يعتمد على Phase 2 + US1 + US2 (Virtualization على MessageList، Responsive على الكل)
- **Polish (Phase 11)**: يعتمد على اكتمال جميع الـ User Stories المرغوبة

### User Story Dependencies

```
Phase 2 (Foundational)
├── US1 (قائمة المحادثات) ─────────────────────────┐
├── US2 (المحادثة + الرسائل) ──────────┐            │
│   ├── US3 (صندوق الكتابة)             │            │
│   │   ├── US4 (الردود المحفوظة)       │            │
│   │   └── US5 (مساعد AI)              │            │
│   └── US7 (أدوات الرسائل + البحث)     │            │
├── US6 (لوحة العميل) ──────────────────┤            │
└── US8 (أداء + تجاوب) ← (US1 + US2) ◀──┘◀───────────┘
```

### Within Each User Story

- المكونات المستقلة [P] أولاً (قابلة للتنفيذ المتوازي)
- المكونات التي تجمع المكونات المستقلة بعدها
- الربط في WaInboxPage / ChatPanel / Composer بعدها
- الترجمات آخر كل قصة

---

## Parallel Opportunities

### داخل US1 (Phase 3)
```
T011 (ConversationItem) ∥ T012 (EmptyStates)  →  T013 (ConversationList)  →  T014 (ربط)  →  T015 (ترجمات)
```

### داخل US2 (Phase 4)
```
T016 (ChatHeader) ∥ T017 (MessageBubble)  →  T018 (MessageList)  →  T019 (ChatPanel)  →  T020 (ربط)  →  T021 (ترجمات)
```

### داخل US3 (Phase 5)
```
T022 (EmojiPicker) ∥ T023 (AttachmentMenu) ∥ T024 (useVoiceRecorder)  →  T025 (VoiceRecorder)  →  T026 (Composer)  →  T027 (ربط)  →  T028-T029 (drag&drop + مسودات)  →  T030 (ترجمات)
```

### بين الـ User Stories (بعد Phase 2)
```
Developer A: US1 (قائمة المحادثات)
Developer B: US2 (المحادثة + الرسائل)
Developer C: US6 (لوحة العميل)
```

---

## Implementation Strategy

### MVP First (US1 فقط)

1. إكمال Phase 1: Setup (تثبيت مكتبات، types)
2. إكمال Phase 2: Foundational (إصلاح Realtime + إعادة هيكلة WaInboxPage)
3. إكمال Phase 3: US1 (قائمة المحادثات)
4. **توقف وتحقق**: اختبار قائمة المحادثات بشكل مستقل
5. Deploy/Demo إذا جاهز

### Incremental Delivery

1. Setup + Foundational → البنية جاهزة
2. US1 → قائمة محادثات تعمل (MVP!)
3. US2 → محادثة غنية تعمل
4. US3 → صندوق كتابة متقدم
5. US4 → ردود محفوظة
6. US5 → مساعد AI
7. US6 → لوحة عميل
8. US7 → أدوات رسائل + بحث
9. US8 → أداء + تجاوب
10. Polish → تنظيف + تحقق نهائي

كل قصة تضيف قيمة بدون كسر ما قبلها.

---

## Notes

- [P] = ملفات مختلفة، لا تبعيات على مهام غير مكتملة
- [US*] = القصة المرتبط بها للمتابعة
- كل قصة قابلة للاختبار بشكل مستقل عند checkpoint
- commit بعد كل مهمة أو مجموعة منطقية
- التوقف عند أي checkpoint للتحقق المستقل
- تجنّب: مهام غامضة، تعارض نفس الملف، تبعيات متقاطعة بين القصص
