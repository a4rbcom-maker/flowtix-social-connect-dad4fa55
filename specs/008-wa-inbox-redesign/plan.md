# Implementation Plan: إعادة تصميم واجهة محادثات واتساب الاحترافية

**Branch**: `008-wa-inbox-redesign` | **Date**: 2026-08-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-wa-inbox-redesign/spec.md`

## Summary

إعادة بناء واجهة `WaInboxPage` من ملف واحد (290 سطر) إلى بنية مكونات احترافية ثلاثية الأعمدة تنافس WhatsApp Business / Intercom. يغطي: قائمة محادثات ذكية مع بحث وفلترة، محادثة غنية بالوسائط وحالات التسليم، صندوق كتابة متقدم (إيموجي/مرفقات/تسجيل صوتي/ردود محفوظة)، مساعد AI، لوحة تفاصيل عميل قابلة للطي، أدوات رسائل، Virtualization لـ 100K رسالة، وتجاوب كامل — مع الحفاظ على جميع الـ APIs والـ hooks الحالية.

## Technical Context

**Language/Version**: TypeScript 5.6 + React 19 + Vite 6

**Primary Dependencies**:
- موجودة: `@tanstack/react-query` v5, `react-i18next`, `react-router-dom` v7, `lucide-react`, `tailwindcss` v4
- جديدة مطلوبة: `@tanstack/react-virtual` (Virtualization), `emoji-picker-react` (Emoji Picker)

**Storage**: Supabase (PostgreSQL + Realtime) — جداول موجودة: `wa_conversations`, `wa_messages`, `wa_contacts`, `wa_notes`, `ai_provider_configs`. الردود المحفوظة في localStorage (v1).

**Testing**: يدوي عبر المتصفح (لا يوجد إطار اختبار في المشروع)

**Target Platform**: Web (Desktop / Tablet / Mobile) — Chrome, Firefox, Safari, Edge

**Project Type**: web-app (React SPA)

**Performance Goals**: ≥ 50fps مع 100K رسالة (Virtualization), Time to Interactive < 2s

**Constraints**: عدم تعديل أي API موجود، عدم كسر Supabase RLS، RTL كامل

**Scale/Scope**: مكونات جديدة (~15 ملف)، تحديث WaInboxPage، endpoint جديد على extraction-service

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

دستور المشروع (AGENTS.md) يفرض القواعد التالية ذات الصلة:

| القاعدة | الحالة | التفاصيل |
|---|---|---|
| Minimum Safe Change | ✅ يُلتزم | تعديل `WaInboxPage.tsx` + مكونات جديدة، لا تعديل على APIs |
| No dead code | ✅ يُلتزم | استخراج المكونات من الكود الموجود وإعادة استخدامه |
| Logical CSS properties | ✅ يُلتزم | `ps-`, `pe-`, `ms-`, `me-`, `start-`, `end-` للـ RTL |
| لا `rtl:` variant | ✅ يُلتزم | استخدام `i18n.language` بدلاً منه |
| Server state في React Query | ✅ يُلتزم | استخدام hooks الموجودة `useWaConversations`, `useWaMessages` |
| Loading/Empty/Error states | ✅ يُلتزم | كل قسم async سيعالجها |
| Types strict | ✅ يُلتزم | interfaces لكل مكون جديد |
| Tailwind design tokens | ✅ يُلتزم | `var(--color-*)` من `index.css` |
| لا تعديل APIs | ✅ يُلتزم | الحفاظ على `waInboxRepository` و `useWaInbox` signatures |
| Tenant isolation | ✅ يُلتزم | كل query scoped بـ `workspace_id` |

**لا توجد انتهاكات** — لا حاجة لجدول Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/008-wa-inbox-redesign/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── inbox-components.md
│   ├── ai-compose-api.md
│   └── saved-replies-store.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (لاحقاً)
```

### Source Code (repository root)

```text
src/
├── components/
│   └── inbox/                    # مكونات Inbox الجديدة
│       ├── ConversationList.tsx       # العمود الأول: قائمة المحادثات
│       ├── ConversationItem.tsx       # عنصر محادثة واحدة
│       ├── ChatPanel.tsx              # العمود الثاني: المحادثة
│       ├── ChatHeader.tsx             # Header المحادثة
│       ├── MessageList.tsx            # قائمة الرسائل (Virtualized)
│       ├── MessageBubble.tsx          # فقاعة رسالة واحدة
│       ├── MessageToolbar.tsx         # أدوات الرسالة (hover)
│       ├── Composer.tsx               # صندوق الكتابة المتقدم
│       ├── EmojiPicker.tsx            # منتقي الإيموجي
│       ├── AttachmentMenu.tsx         # قائمة المرفقات
│       ├── VoiceRecorder.tsx          # التسجيل الصوتي
│       ├── SavedRepliesPopover.tsx    # الردود المحفوظة
│       ├── AiAssistant.tsx            # مساعد AI
│       ├── ContactPanel.tsx           # العمود الثالث: تفاصيل العميل
│       ├── InboxSearch.tsx            # البحث داخل المحادثة
│       └── EmptyStates.tsx            # حالات فارغة + خطأ
├── hooks/
│   ├── useWaInbox.ts             # محدّث (إصلاح Realtime + search)
│   ├── useSavedReplies.ts        # جديد: إدارة الردود المحفوظة
│   ├── useVoiceRecorder.ts       # جديد: التسجيل الصوتي
│   └── useInboxAi.ts             # جديد: مساعد AI
├── lib/
│   ├── wa-inbox.ts               # محدّظ (لا تعديل على signatures)
│   └── inbox-ai.ts               # جديد: استدعاء AI compose endpoint
├── pages/dashboard/whatsapp/
│   └── WaInboxPage.tsx           # محدّث: orchestrator فقط
└── types/
    └── inbox.types.ts            # جديد: types للمكونات الجديدة

extraction-service/src/
└── ai/
    └── routes.ts                 # محدّث: إضافة POST /ai/compose
```

**Structure Decision**: بنية مكونات منفصلة تحت `src/components/inbox/` بدلاً من ملف واحد ضخم. الـ `WaInboxPage` يصبح orchestrator يدير state العام ويربط الأعمدة الثلاثة. الـ hooks الجديدة منفصلة لكل ميزة (AI, Saved Replies, Voice).
