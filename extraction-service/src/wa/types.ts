export type WaMessageType = "text" | "image" | "video" | "audio" | "document" | "location" | "contact" | "buttons" | "list" | "template";

export interface IncomingWaMessage {
  sessionId: string;
  workspaceId: string;
  remoteJid: string;
  fromMe: boolean;
  messageId: string;
  pushName?: string;
  type: WaMessageType;
  text?: string;
  hasMedia: boolean;
  mediaMimeType?: string;
  mediaUrl?: string;
  quotedMessageId?: string;
  timestamp: number;
  isHistory?: boolean;
  mediaKey?: string;
}

export interface SendPayload {
  type: WaMessageType;
  text?: string;
  mediaUrl?: string;
  caption?: string;
  mimeType?: string;
  fileName?: string;
  buttons?: { id: string; title: string }[];
  quotedMessageId?: string;
}

export interface ProviderSession {
  sessionId: string;
  status: "qr_ready" | "authenticating" | "connected" | "disconnected" | "error";
  qrCode?: string;
}

export interface WhatsAppProvider {
  start(sessionId: string, workspaceId: string, onQR: (qr: string) => void, onReady: (info: { jid: string; pushName?: string }) => void, onMessage: (msg: IncomingWaMessage) => void, onClose: (reason: string) => void): Promise<void>;
  isAuthenticated(sessionId: string): boolean;
  send(sessionId: string, to: string, payload: SendPayload): Promise<{ messageId: string }>;
  markRead(sessionId: string, jid: string, messageId: string): Promise<void>;
  stop(sessionId: string): Promise<void>;
}
