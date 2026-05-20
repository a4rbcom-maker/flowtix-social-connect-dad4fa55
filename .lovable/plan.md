## استخراج رسائل الصفحة (Messenger Conversations)

إضافة قسم جديد لسحب محادثات Inbox للصفحات المربوطة وعرض بيانات العملاء المتفاعلين، مع تصدير CSV.

### المتطلبات (Permissions)
- `pages_messaging` (مطلوب) — لقراءة محادثات Inbox الصفحة
- `pages_show_list` + `pages_read_engagement` (موجودين بالفعل)
- بانر تحذير واضح: لو التوكن مش متضمن `pages_messaging` نعرض زرار "أعد توليد التوكن بكل الصلاحيات" بدل ما نكسر الصفحة

### Server Functions الجديدة في `src/lib/facebook.functions.ts`
1. **`listPagesForMessaging`** — يرجع الصفحات اللي معاها `pages_messaging` access (من `/me/accounts` بـ Page Access Tokens)
2. **`fetchPageConversations({ pageId, limit=25, after? })`** — يستدعي:
   - `GET /{page-id}/conversations?fields=participants,snippet,updated_time,message_count,unread_count&access_token={page_token}` مع pagination cursor
   - يرجع: `conversations[]`, `paging.cursors.after`
3. **`fetchConversationMessages({ pageId, conversationId, limit=50 })`** — يستدعي:
   - `GET /{conversation-id}/messages?fields=from,to,message,created_time,attachments` (آخر 50 رسالة)
4. **`extractLeadsFromConversations({ pageId, max=100 })`** — يجمع العملاء المهتمين من آخر N محادثة:
   - اسم العميل، PSID، آخر رسالة، تاريخ آخر تفاعل، عدد الرسائل، حالة (unread/replied)

كل الـ functions تستخدم `requireSupabaseAuth` middleware وتقرأ التوكن من `facebook_connections` للمستخدم الحالي.

### Route الجديد: `src/routes/dashboard.facebook.messages.tsx`
- Page selector (Select من الصفحات المتاحة)
- 3 tabs:
  - **المحادثات** — جدول: المشارك، آخر رسالة (snippet)، تاريخ التحديث، عدد الرسائل، غير مقروء. زرار "عرض" يفتح Dialog فيه آخر 50 رسالة (ScrollArea).
  - **العملاء المهتمين (Leads)** — جدول: اسم، آخر تفاعل، عدد رسائل، حالة. زرار "تصدير CSV" (يستخدم نفس `downloadCsv` helper الموجود في insights).
  - **إحصائيات سريعة** — إجمالي المحادثات، غير المقروء، متوسط الرسائل لكل محادثة.
- Pagination بـ "تحميل المزيد" (cursor-based).
- معالجة أخطاء عبر `useFacebookApi` + `describeFbError` (نفس النمط الموجود).

### Navigation
- إضافة عنصر في `DashboardLayout` sidebar تحت قسم Facebook: "رسائل Inbox" / "Messenger Inbox" بأيقونة `MessageCircle` من lucide.
- لا تعديل في `routeTree.gen.ts` يدوياً (auto-generated).

### Translations (i18n inline داخل الـ route)
عربي/إنجليزي لكل النصوص (titles, columns, empty states, permission warning).

### اعتبارات أمان/خصوصية
- لا نخزن محتوى الرسائل في قاعدة بياناتنا — fetch مباشر من Graph API عند الطلب.
- CSV التصدير يحتوي فقط على: اسم، PSID، آخر رسالة (snippet مختصر)، تاريخ — بدون محتوى رسائل كامل افتراضياً.
- timeout موحد عبر `FB_CALL_TIMEOUT_MS`.

### الملفات المتأثرة
- `src/lib/facebook.functions.ts` (إضافة 4 server functions)
- `src/routes/dashboard.facebook.messages.tsx` (ملف جديد)
- `src/components/dashboard/DashboardLayout.tsx` (إضافة لينك)

### ملاحظات مهمة
- Graph API بترجع conversations فقط للمستخدمين اللي راسلوا الصفحة خلال آخر 24 ساعة إلا لو عندك `pages_messaging` كاملة + الصفحة في Live Mode (غير Development).
- لو الصفحة جديدة (New Page Experience) ممكن بعض الحقول ترجع فاضية — هنعرض رسالة واضحة بدل صفحة فاضية.