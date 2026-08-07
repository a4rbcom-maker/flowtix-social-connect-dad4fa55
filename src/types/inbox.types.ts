export type ConvFilter = "all" | "unread" | "starred" | "archived";

export type SavedReplyCategory =
  | "greeting"
  | "follow_up"
  | "offer"
  | "reminder"
  | "thanks"
  | "survey";

export interface SavedReply {
  id: string;
  name: string;
  shortcut: string;
  body: string;
  category: SavedReplyCategory;
  created_at: number;
  updated_at: number;
}

export type AiAction =
  | "rephrase"
  | "fix_grammar"
  | "professional"
  | "casual"
  | "shorten"
  | "expand"
  | "translate"
  | "suggest_reply";

export interface MediaAttachment {
  file: File | Blob;
  previewUrl: string;
  type: "image" | "video" | "audio" | "document";
  size: number;
}

export interface SendInput {
  text?: string;
  attachment?: MediaAttachment;
  quotedMessageId?: string;
}

export interface ComposeWithAiParams {
  workspaceId: string;
  action: AiAction;
  text?: string;
  context?: string;
}

export interface ComposeWithAiResult {
  success: boolean;
  content: string;
  error?: string;
}

export type EmptyStateVariant = "no-conv" | "no-msg" | "error" | "loading";

export interface QuotedMessage {
  id: string;
  body: string | null;
  direction: string;
  type: string;
}
