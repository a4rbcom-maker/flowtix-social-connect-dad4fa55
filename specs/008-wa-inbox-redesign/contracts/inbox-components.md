# Contract: مكونات Inbox

**Feature**: `008-wa-inbox-redesign` | **Date**: 2026-08-08

## بنية المكونات (Component Tree)

```
WaInboxPage (orchestrator)
├── ConversationList
│   ├── InboxSearch (بحث قائمة المحادثات)
│   ├── FilterTabs (الكل / غير مقروء / مميز / مؤرشف)
│   └── ConversationItem[] (عنصر محادثة)
├── ChatPanel
│   ├── ChatHeader (اسم، رقم، حالة، وسوم)
│   ├── MessageList (Virtualized)
│   │   ├── MessageBubble
│   │   │   └── MessageToolbar (hover: نسخ، اقتباس، إعادة إرسال)
│   │   ├── InboxSearch (بحث داخل المحادثة)
│   │   └── EmptyStates (لا رسائل / خطأ)
│   └── Composer
│       ├── EmojiPicker
│       ├── AttachmentMenu (صورة / فيديو / صوت / ملف)
│       ├── VoiceRecorder
│       ├── SavedRepliesPopover
│       ├── AiAssistant
│       └── DraftTextarea (مع link preview)
└── ContactPanel (collapsible)
    ├── ContactInfo (بيانات العميل)
    ├── TagsEditor
    ├── NotesList
    └── CampaignHistory
```

## Props Contracts

### ConversationList
```typescript
interface ConversationListProps {
  conversations: ConversationWithContact[];
  activeConvId: string | null;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  filter: ConvFilter;
  onFilterChange: (f: ConvFilter) => void;
  onSelectConv: (id: string) => void;
  isLoading: boolean;
}

type ConvFilter = "all" | "unread" | "starred" | "archived";
```

### ConversationItem
```typescript
interface ConversationItemProps {
  conv: ConversationWithContact;
  isActive: boolean;
  onClick: () => void;
}
```

### ChatPanel
```typescript
interface ChatPanelProps {
  conv: ConversationWithContact | null;
  messages: WaMessage[];
  onSend: (input: SendInput) => void;
  onStar: (id: string, v: boolean) => void;
  onArchive: (id: string, v: boolean) => void;
  onMarkRead: (id: string) => void;
  isLoading: boolean;
}

interface SendInput {
  text?: string;
  attachment?: MediaAttachment;
  quotedMessageId?: string;
}
```

### ChatHeader
```typescript
interface ChatHeaderProps {
  conv: ConversationWithContact;
  onStar: (v: boolean) => void;
  onArchive: (v: boolean) => void;
  onToggleContactPanel: () => void;
}
```

### MessageList
```typescript
interface MessageListProps {
  messages: WaMessage[];
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onCopyMessage: (msg: WaMessage) => void;
  onQuoteMessage: (msg: WaMessage) => void;
  onResendMessage: (msg: WaMessage) => void;
}
```

### MessageBubble
```typescript
interface MessageBubbleProps {
  message: WaMessage;
  quotedMessage?: WaMessage;
  onCopy: () => void;
  onQuote: () => void;
  onResend: () => void;
  onDownload?: () => void;
}
```

### Composer
```typescript
interface ComposerProps {
  onSend: (input: SendInput) => void;
  disabled?: boolean;
  draftText: string;
  onDraftChange: (text: string) => void;
  quotedMessage?: WaMessage | null;
  onCancelQuote: () => void;
}
```

### VoiceRecorder
```typescript
interface VoiceRecorderProps {
  onComplete: (blob: Blob, durationSec: number) => void;
  disabled?: boolean;
}
```

### SavedRepliesPopover
```typescript
interface SavedRepliesPopoverProps {
  onSelect: (body: string) => void;
  triggerText: string;
}
```

### AiAssistant
```typescript
interface AiAssistantProps {
  text: string;
  onResult: (newText: string) => void;
  contextMessages?: WaMessage[];
  disabled?: boolean;
}

type AiAction = "rephrase" | "fix_grammar" | "professional" | "casual"
              | "shorten" | "expand" | "translate" | "suggest_reply";
```

### ContactPanel
```typescript
interface ContactPanelProps {
  conv: ConversationWithContact;
  notes: WaNote[];
  onAddNote: (body: string) => void;
  onToggleTag: (tag: string) => void;
  isOpen: boolean;
  onClose: () => void;
}
```

### EmptyStates
```typescript
interface EmptyStateProps {
  variant: "no-conv" | "no-msg" | "error" | "loading";
  message?: string;
  onRetry?: () => void;
}
```

## قواعد RTL

جميع المكونات تستخدم logical properties:
- `ms-`, `me-`, `ps-`, `pe-` بدلاً من `ml-`, `mr-`, `pl-`, `pr-`
- `start-`, `end-` بدلاً من `left-`, `right-`
- `border-s`, `border-e` بدلاً من `border-l`, `border-r`
- الرسائل الواردة: `align-self: start` (يمين في RTL)
- الرسائل الصادرة: `align-self: end` (يسار في RTL)
- لا `rtl:` variant — استخدام `i18n.language === "ar"` عند الحاجة

## Design Tokens

جميع الألوان من `index.css`:
- الخلفية: `var(--color-bg)`, `var(--color-surface-1)`, `var(--color-surface-2)`
- النص: `var(--color-fg)`, `var(--color-fg-muted)`
- الحدود: `var(--color-border)`, `var(--color-border-strong)`
- الأساسي: `var(--color-primary)`
- الظلال: `var(--shadow-sm)`, `var(--shadow-md)`, `var(--shadow-lg)`, `var(--shadow-xl)`
- الزوايا: `rounded-lg`, `rounded-xl`, `rounded-2xl`, `rounded-full`
