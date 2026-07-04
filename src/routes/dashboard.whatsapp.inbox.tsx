import * as React from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MessageCircle,
  Search,
  Loader2,
  Send,
  Bot,
  Inbox as InboxIcon,
  Sparkles,
  ArrowLeft,
  RefreshCw,
  Bell,
  BellOff,
  Smile,
  Paperclip,
  CheckCheck,
  Camera,
  Mic,
  FileText,
  Video as VideoIcon,
  X,
  Plus,
  Pencil,
  Trash2,
  Phone,
  UserPlus,
  StickyNote,
  Image as ImageIcon,
  Info,
  Sun,
  Moon,
  PlayCircle,
  AlertTriangle,
  Download,
  ExternalLink,
  Users,
} from "lucide-react";
import { classifySendError, type SendErrorInfo } from "@/lib/wa-send-error";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { useTheme } from "@/lib/theme";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { buildRow } from "@/lib/customer-db";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { statusBadgeTone } from "@/lib/status-badge";
import { SmartAudio } from "@/components/wa/SmartAudio";
import { Zap } from "lucide-react";
import {
  sendChatMessage,
  dispatchQueuedMessage,
  markConversationRead,
  markConversationActive,
  clearConversationActive,
  summarizeConversation,
  type ConversationRow,
  type ChatMessageRow,
} from "@/lib/wa-chat.functions";
import { requestWaHistorySync, requestWaChatSync, getWaHistorySyncJob, dismissWaHistorySyncJob, matchLidPhoneNumbers, getWaConnectionState } from "@/lib/wa.functions";
import {
  createQuickReply,
  updateQuickReply,
  deleteQuickReply,
  type QuickReply,
} from "@/lib/wa-automation.functions";

import { MediaLightbox, openMedia } from "@/components/whatsapp/MediaLightbox";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";


export const Route = createFileRoute("/dashboard/whatsapp/inbox")({
  ssr: false,
  component: InboxPage,
});

type FilterKey = "all" | "unread" | "ai";
type TimeRangeKey = "all" | "1d" | "7d" | "30d" | "90d";
type RankedConversationRow = ConversationRow & { _sort_at?: string | null; _has_stored_message?: boolean };

function InboxPage() {
  const { lang } = useI18n();
  const isAr = lang === "ar";
  const { user } = useAuth();
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const sendFn = useServerFn(sendChatMessage);
  const dispatchFn = useServerFn(dispatchQueuedMessage);
  const markReadFn = useServerFn(markConversationRead);
  const markActiveFn = useServerFn(markConversationActive);
  const clearActiveFn = useServerFn(clearConversationActive);
  const requestHistorySyncFn = useServerFn(requestWaHistorySync);
  const requestChatSyncFn = useServerFn(requestWaChatSync);
  const getHistorySyncJobFn = useServerFn(getWaHistorySyncJob);
  const dismissHistorySyncJobFn = useServerFn(dismissWaHistorySyncJob);
  const matchLidPhonesFn = useServerFn(matchLidPhoneNumbers);
  const getConnectionStateFn = useServerFn(getWaConnectionState);




  const [activeJid, setActiveJid] = useState<string | null>(null);
  const [listVisible, setListVisible] = useState(true);
  useEffect(() => {
    if (isMobile) return;
    if (activeJid) setListVisible(false);
    else setListVisible(true);
  }, [activeJid, isMobile]);
  const [isTyping, setIsTyping] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [timeRange, setTimeRange] = useState<TimeRangeKey>(() => {
    if (typeof window === "undefined") return "all";
    return (localStorage.getItem("flowtix-inbox-timerange") as TimeRangeKey) || "all";
  });
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("flowtix-inbox-timerange", timeRange);
  }, [timeRange]);
  const [draft, setDraft] = useState("");
  // Real attachment: hold the picked File + a local object URL preview.
  // On submit we upload to `wa-media` and forward the signed URL to the bridge.
  const [attachment, setAttachment] = useState<{ file: File; previewUrl: string } | null>(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  useEffect(() => {
    // Revoke the object URL when the attachment changes or unmounts to avoid leaks.
    return () => {
      if (attachment?.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    };
  }, [attachment]);
  const [soundOn, setSoundOn] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("flowtix-inbox-sound") !== "false";
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const historySyncRequestedRef = useRef<string | null>(null);
  const chatHistoryRequestedRef = useRef<Set<string>>(new Set());
  const PAGE_SIZE = 40;
  const [visibleCount, setVisibleCount] = useState<number>(PAGE_SIZE);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const preserveScrollRef = useRef<number | null>(null);
  const prevMsgLenRef = useRef<number>(0);

  type SyncStatus = "idle" | "running" | "pending" | "done" | "error";
  const [syncState, setSyncState] = useState<{
    status: SyncStatus;
    baselineMsg: number;
    baselineConv: number;
    importedMsg: number;
    importedConv: number;
    startedAt: number;
    deadlineAt: number;
    message?: string;
  }>({
    status: "idle",
    baselineMsg: 0,
    baselineConv: 0,
    importedMsg: 0,
    importedConv: 0,
    startedAt: 0,
    deadlineAt: 0,
  });
  const [syncHydrated, setSyncHydrated] = useState(false);

  // Persisted background sync: keep progress alive across reloads / device sleep.
  const historyJobQuery = useQuery({
    queryKey: ["wa", "history-sync-job", user?.id ?? "anon"],
    queryFn: () => getHistorySyncJobFn(),
    enabled: !!user?.id,
    refetchInterval: (query) => {
      const data = query.state.data as any;
      return data && (data.status === "running" || data.status === "pending") ? 15000 : false;
    },
    refetchOnWindowFocus: true,
    staleTime: 10000,
  });

  const handledDoneJobRef = useRef<string | null>(null);
  useEffect(() => {
    const job = historyJobQuery.data as any;
    if (!job) return;
    if (job.status === "idle") {
      setSyncHydrated(true);
      handledDoneJobRef.current = null;
      return;
    }
    const jobKey = String(job.id ?? job.startedAt ?? "");
    // لا نعيد إحياء بطاقة "اكتملت" لمهمة سبق التعامل معها (بعد الإخفاء التلقائي).
    if ((job.status === "done" || job.status === "error") && handledDoneJobRef.current === jobKey) {
      setSyncHydrated(true);
      return;
    }
    const startedAt = job.startedAt ? new Date(job.startedAt).getTime() : Date.now();
    const deadlineAt = job.deadlineAt ? new Date(job.deadlineAt).getTime() : startedAt + 90_000;
    setSyncState({
      status: job.status as SyncStatus,
      baselineMsg: job.baselineMsg,
      baselineConv: job.baselineConv,
      importedMsg: job.importedMsg,
      importedConv: job.importedConv,
      startedAt,
      deadlineAt,
      message: job.message ?? undefined,
    });
    setSyncHydrated(true);
    if (job.status === "done" || job.status === "error") {
      handledDoneJobRef.current = jobKey;
      // نستدعي dismiss فورًا حتى لا يعود الاستعلام التالي يعيد الحالة إلى done.
      dismissHistorySyncJobFn().catch(() => {});
    }
  }, [historyJobQuery.data, dismissHistorySyncJobFn]);



  const t = isAr
    ? {
        title: "المحادثات",
        subtitle: "كل محادثاتك الواردة والصادرة في مكان واحد.",
        search: "ابحث برقم أو اسم…",
        empty: "ما فيش محادثات لسة.",
        emptyHint: "اربط حساب واتساب من «حساباتي» وانتظر أول رسالة.",
        openAccounts: "افتح حساباتي",
        you: "أنت",
        ai: "AI",
        selectChat: "اختر محادثة من القائمة",
        selectChatHint: "اختر محادثة من اليمين لعرض الرسائل وبدء الرد على عملائك.",
        suggestAccounts: "اربط حساب واتساب",
        suggestAi: "جرّب الذكاء الاصطناعي",
        suggestImport: "استيراد جهات اتصال",
        typeMessage: "اكتب رسالة…",
        send: "إرسال",
        loading: "جارٍ التحميل…",
        aiBadge: "مساعد ذكي",
        aiOn: "مفعّل",
        aiOff: "متوقف",
        backToList: "رجوع",
        unread: "غير مقروء",
        all: "الكل",
        filterUnread: "غير مقروءة",
        filterAi: "AI مفعّل",
        refresh: "تحديث",
        soundOn: "إشعارات: مشغّلة",
        soundOff: "إشعارات: متوقفة",
        testSound: "اختبار الصوت",
        testSoundOk: "تم تشغيل الصوت التجريبي بنجاح",
        testSoundFail: "فشل تشغيل الصوت. اضغط على الصفحة أولاً لتفعيل الصوت في المتصفح.",
        syncHistory: "مزامنة المحادثات القديمة",
        resync: "إعادة مزامنة",
        resyncing: "جارٍ المزامنة…",
        resyncQueued: "تم إرسال طلب المزامنة للجسر، وسيتم تحديث الشات تلقائيًا عند وصول الدفعات.",
        syncNeedsConnection: "لا يمكن جلب المحادثات القديمة لأن واتساب غير متصل. أعد الربط وامسح QR جديد أولاً.",
        syncUnavailable: "لم تصل دفعات الأرشيف بعد. أبقِ الهاتف متصلاً وأعد المحاولة.",
        soon: "قريباً",
        photo: "صورة",
        voice: "رسالة صوتية",
        doc: "مستند",
        video: "فيديو",
        today: "اليوم",
        yesterday: "أمس",
        savedStats: (chats: number) => `${chats} محادثات ظاهرة`,
        connected: "متصل",
        disconnected: "غير متصل",
        repairForHistory: "أعد الاقتران لاستيراد كل المحادثات",
        repairHint: "واتساب يرسل الأرشيف مرة واحدة فقط بعد أول مسح QR. لجلب كل السجل، افصل الجلسة وامسح QR جديد.",
      }

    : {
        title: "Conversations",
        subtitle: "All your incoming and outgoing messages in one place.",
        search: "Search by number or name…",
        empty: "No conversations yet.",
        emptyHint: "Link a WhatsApp account from “My Accounts” and wait for the first message.",
        openAccounts: "Open My Accounts",
        you: "You",
        ai: "AI",
        selectChat: "Select a conversation",
        selectChatHint: "Pick a chat from the list to view messages and reply to your customers.",
        suggestAccounts: "Link a WhatsApp account",
        suggestAi: "Try the AI assistant",
        suggestImport: "Import contacts",
        typeMessage: "Type a message…",
        send: "Send",
        loading: "Loading…",
        aiBadge: "AI assistant",
        aiOn: "On",
        aiOff: "Off",
        backToList: "Back",
        unread: "Unread",
        all: "All",
        filterUnread: "Unread",
        filterAi: "AI on",
        refresh: "Refresh",
        soundOn: "Sound: on",
        soundOff: "Sound: off",
        testSound: "Test sound",
        testSoundOk: "Test sound played successfully",
        testSoundFail: "Playback failed. Click anywhere on the page to unlock audio.",
        syncHistory: "Sync old conversations",
        resync: "Resync",
        resyncing: "Syncing…",
        resyncQueued: "Sync request sent to the bridge; chats will update automatically when batches arrive.",
        syncNeedsConnection: "Old chats cannot be fetched because WhatsApp is not connected. Reconnect and scan a new QR first.",
        syncUnavailable: "Old-chat batches haven't arrived yet. Keep the phone online and retry.",
        soon: "Coming soon",
        photo: "Photo",
        voice: "Voice message",
        doc: "Document",
        video: "Video",
        today: "Today",
        yesterday: "Yesterday",
        savedStats: (chats: number) => `${chats} visible chats`,
        connected: "Connected",
        disconnected: "Not connected",
        repairForHistory: "Re-pair to import all chats",
        repairHint: "WhatsApp streams the archive only once, after the first QR scan. To pull the full backlog, disconnect and scan a new QR.",
      };


  // Data
  const safeCall = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      const result = await fn();
      return result ?? fallback;
    } catch (err) {
      if (err instanceof Response) {
        console.warn("[inbox] server fn returned Response", err.status);
        return fallback;
      }
      console.warn("[inbox] server fn error", err);
      return fallback;
    }
  };
  const convQuery = useQuery<ConversationRow[]>({
    queryKey: ["wa-conversations", user?.id],
    queryFn: () => safeCall<ConversationRow[]>(() => fetchInboxConversations(user!.id), []),
    enabled: !!user?.id,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
    refetchInterval: 300_000, // safety net فقط؛ Realtime هو المصدر الأساسي
    refetchOnWindowFocus: true,
    refetchOnReconnect: "always",
  });
  const msgsQuery = useQuery<ChatMessageRow[]>({
    queryKey: ["wa-messages", user?.id, activeJid],
    queryFn: () =>
      activeJid
        ? safeCall<ChatMessageRow[]>(() => fetchInboxMessages(user!.id, activeJid), [])
        : Promise.resolve([]),
    enabled: !!activeJid && !!user?.id,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
    refetchInterval: 300_000, // safety net فقط؛ Realtime هو المصدر الأساسي
    refetchOnWindowFocus: false,
    refetchOnReconnect: "always",
  });
  // Debounced invalidators so bursts of realtime events don't refetch repeatedly.
  const invalidateTimersRef = useRef<{ conv?: ReturnType<typeof setTimeout>; msgs?: ReturnType<typeof setTimeout> }>({});
  const scheduleInvalidateConversations = useCallback(() => {
    const t = invalidateTimersRef.current;
    if (t.conv) return;
    t.conv = setTimeout(() => {
      t.conv = undefined;
      qc.invalidateQueries({ queryKey: ["wa-conversations"], refetchType: "active" });
    }, 400);
  }, [qc]);
  const scheduleInvalidateMessages = useCallback((uid: string, jid: string) => {
    const t = invalidateTimersRef.current;
    if (t.msgs) return;
    t.msgs = setTimeout(() => {
      t.msgs = undefined;
      qc.invalidateQueries({ queryKey: ["wa-messages", uid, jid], refetchType: "active" });
    }, 500);
  }, [qc]);
  useEffect(() => () => {
    const t = invalidateTimersRef.current;
    if (t.conv) clearTimeout(t.conv);
    if (t.msgs) clearTimeout(t.msgs);
  }, []);
  const conversations = useMemo<ConversationRow[]>(
    () => {
      const raw = Array.isArray(convQuery.data) ? convQuery.data : [];
      const lidLocals = new Set(
        raw
          .filter((c) => c.remote_jid.endsWith("@lid"))
          .map((c) => c.remote_jid.split("@")[0])
          .filter(Boolean) as string[],
      );
      const groups = new Map<string, ConversationRow[]>();
      const identityToKey = new Map<string, string>();
      for (const c of raw) {
        const identities = conversationIdentities(c, lidLocals);
        const existingKeys = Array.from(new Set(identities.map((id) => identityToKey.get(id)).filter(Boolean) as string[]));
        const key = existingKeys[0] ?? identities[0] ?? `jid:${c.remote_jid}`;
        const mergedItems = [...(groups.get(key) ?? []), c];
        for (const oldKey of existingKeys.slice(1)) {
          mergedItems.push(...(groups.get(oldKey) ?? []));
          groups.delete(oldKey);
        }
        groups.set(key, mergedItems);
        for (const id of identities) identityToKey.set(id, key);
      }
      return Array.from(groups.values())
        .map((items) => mergeConversationAliases(items))
        .sort(compareConversationsByLastRealActivity);
    },
    [convQuery.data],
  );

  const messages = useMemo<ChatMessageRow[]>(
    () => (Array.isArray(msgsQuery.data) ? msgsQuery.data : []),
    [msgsQuery.data],
  );
  const [optimisticMessages, setOptimisticMessages] = useState<ChatMessageRow[]>([]);
  const visibleMessageIds = useMemo(() => new Set(messages.map((m) => m.id)), [messages]);
  // Match optimistic → real outgoing rows by content, so the bubble stays
  // visible until the persisted DB row is actually returned by the query.
  // Prevents the "delivering → disappears → reappears" flash between the
  // 1.2s removal timer and the next refetch cycle.
  const outgoingSignatures = useMemo(() => {
    const set = new Set<string>();
    for (const m of messages) {
      if (m.direction !== "out") continue;
      const sig = `${(m.text_body ?? "").trim()}|${m.media_url ?? ""}|${m.msg_type ?? ""}`;
      set.add(sig);
    }
    return set;
  }, [messages]);
  const mergedMessages = useMemo<ChatMessageRow[]>(
    () => [
      ...messages,
      ...optimisticMessages.filter((m) => {
        if (m.remote_jid !== activeJid) return false;
        if (visibleMessageIds.has(m.id)) return false;
        const sig = `${(m.text_body ?? "").trim()}|${m.media_url ?? ""}|${m.msg_type ?? ""}`;
        // If a real outgoing row with same content is already loaded, drop
        // the optimistic clone to avoid duplicate bubbles.
        if (outgoingSignatures.has(sig)) return false;
        return true;
      }),
    ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [activeJid, messages, optimisticMessages, visibleMessageIds, outgoingSignatures],
  );

  const visibleMessages = useMemo<ChatMessageRow[]>(
    () => (mergedMessages.length > visibleCount ? mergedMessages.slice(mergedMessages.length - visibleCount) : mergedMessages),
    [mergedMessages, visibleCount],
  );
  const hasMoreOlder = mergedMessages.length > visibleMessages.length;

  // Count unique group members seen across the loaded messages (best-effort
  // participant count based on what we've received from the group so far).
  const groupMemberCount = useMemo(() => {
    const jid = activeJid ?? "";
    if (!jid.endsWith("@g.us")) return 0;
    const set = new Set<string>();
    let sawSelf = false;
    for (const m of mergedMessages) {
      if (m.direction === "out") { sawSelf = true; continue; }
      const key =
        (m.sender_phone && m.sender_phone.trim()) ||
        (m.sender_name && m.sender_name.trim());
      if (key) set.add(key);
    }
    return set.size + (sawSelf ? 1 : 0);
  }, [mergedMessages, activeJid]);

  // Track connection so we can show the right empty-state CTA.
  // Poll faster while not connected so we catch a fresh QR scan quickly.
  const connQuery = useQuery<{ status: string } | null>({
    queryKey: ["wa-connection-state", user?.id],
    queryFn: () => safeCall(async () => {
      const state = await getConnectionStateFn();
      return state?.status ? { status: state.status } : null;
    }, null),
    enabled: !!user?.id,
    refetchInterval: (query) => (query.state.data?.status === "connected" ? 30000 : 5000),
  });

  const quickRepliesQuery = useQuery<QuickReply[]>({
    queryKey: ["wa-quick-replies", user?.id],
    queryFn: () => safeCall<QuickReply[]>(() => fetchInboxQuickReplies(user!.id), []),
    enabled: !!user?.id,
  });

  // Detect the edge transition (any → connected). A fresh QR scan is what
  // brings the archive stream in from WhatsApp, so on every new connect we:
  //  1) invalidate conversations / threads / messages caches so old chats appear,
  //  2) reset the sync guard so history sync can (re)run even if some chats exist.
  const prevConnStatusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!user?.id) return;
    const status = connQuery.data?.status ?? null;
    const prev = prevConnStatusRef.current;
    if (status === "connected" && prev !== "connected") {
      // New connection edge — refresh every list tied to this account.
      qc.invalidateQueries({ queryKey: ["wa-conversations", user.id] });
      qc.invalidateQueries({ queryKey: ["wa-messages"] });
      qc.invalidateQueries({ queryKey: ["wa-quick-replies", user.id] });
      // Allow the history-sync auto-trigger below to re-arm for this new session.
      historySyncRequestedRef.current = null;
    }
    prevConnStatusRef.current = status;
  }, [connQuery.data?.status, user?.id, qc]);

  // Auto-trigger a full history sync the moment the session becomes "connected".
  // Goes through historySyncMut (not the bare fn) so the progress bar / % /
  // imported counts appear right after QR scan — no user action required.
  useEffect(() => {
    if (!user?.id) return;
    if (connQuery.data?.status !== "connected") return;
    if (convQuery.isFetching) return;
    const key = `${user.id}:connected:${connQuery.dataUpdatedAt ?? 0}`;
    // The prev-status edge effect above resets historySyncRequestedRef on each
    // fresh connect, so a new QR scan re-arms this even if some chats exist.
    if (historySyncRequestedRef.current === key) return;
    historySyncRequestedRef.current = key;
    // Fire-and-track: the mutation's onMutate sets syncState → progress UI shows.
    historySyncMut.mutate();
    return () => {
      if (connQuery.data?.status !== "connected") {
        historySyncRequestedRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connQuery.data?.status, convQuery.isFetching, user?.id]);

  // Auto-match @lid conversations to real phone numbers once per session.
  // Silently backfills contact_phone using stored senderPn data so old chats
  // stop showing "محادثة واتساب" and merge with their sibling direct chats.
  const lidMatchMut = useMutation({
    mutationFn: () => matchLidPhonesFn(),
    onSuccess: (res) => {
      if (res && res.matched > 0) {
        qc.invalidateQueries({ queryKey: ["wa-conversations", user?.id] });
        toast.success(
          isAr
            ? `تم ربط ${res.matched} محادثة برقم الجوال الحقيقي`
            : `Linked ${res.matched} chat(s) to their real phone number`
        );
      }
    },
  });

  useEffect(() => {
    if (!user?.id) return;
    const key = `wa-lid-match-v2:${user.id}`;
    if (typeof window === "undefined") return;
    if (window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, "1");
    lidMatchMut.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);





  // Realtime
  useEffect(() => {
    if (!user) return;
    const uid = user.id;
    const ch = supabase
      .channel(`wa_inbox_realtime:${uid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "wa_conversations", filter: `user_id=eq.${uid}` },
        () => {
          scheduleInvalidateConversations();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "wa_messages", filter: `user_id=eq.${uid}` },
        (payload) => {
          const row = payload.new as { remote_jid?: string; direction?: string; raw?: { is_historical?: boolean } | null };
          // نُبطل رسائل الدردشة النشطة عند أي حدث؛ اختلاف نسق JID (@lid مقابل @s.whatsapp.net)
          // قد يمنع المطابقة الحرفية، لذا نعتمد على fetchInboxMessages لحل الهوية.
          if (activeJid) {
            scheduleInvalidateMessages(uid, activeJid);
          }
          if (
            payload.eventType === "INSERT" &&
            row?.direction === "in" &&
            !row?.raw?.is_historical
          ) {
            playBeep();
            // ضمان تحديث فوري لقائمة المحادثات عند وصول رسالة جديدة
            scheduleInvalidateConversations();
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc, activeJid, user, scheduleInvalidateConversations, scheduleInvalidateMessages]);


  // Catch-up on missed messages after tab was hidden / offline / long idle.
  // Any gap > 30s triggers an immediate refetch of conversations + active
  // messages + connection state, plus a bridge history-sync when > 90s so
  // messages received while the socket/tab was down are pulled in fast.
  useEffect(() => {
    if (!user?.id) return;
    if (typeof window === "undefined") return;

    let lastActiveAt = Date.now();
    let lastSyncAt = 0;

    const catchUp = (reason: "focus" | "visible" | "online" | "interval") => {
      const now = Date.now();
      const gapMs = now - lastActiveAt;
      lastActiveAt = now;
      if (gapMs < 30_000 && reason !== "online") return;

      qc.invalidateQueries({ queryKey: ["wa-conversations", user.id] });
      qc.invalidateQueries({ queryKey: ["wa-connection-state", user.id] });
      if (activeJid) {
        qc.invalidateQueries({ queryKey: ["wa-messages", user.id, activeJid] });
        requestChatSyncFn({ data: { remoteJid: activeJid } })
          .then(() => {
            qc.invalidateQueries({ queryKey: ["wa-conversations", user.id] });
            qc.invalidateQueries({ queryKey: ["wa-messages", user.id, activeJid] });
          })
          .catch((err: unknown) => console.warn("[inbox] active chat sync failed", err));
      }

      // لا نشغل history sync ثقيل عند كل رجوع للتاب. فقط للحساب الفارغ جدًا،
      // وبحد زمني واسع، لتجنب استهلاك Disk IO بسبب محاولات متكررة.
      const heavyGap = (gapMs > 30 * 60_000 || reason === "online") && conversations.length === 0;
      if (heavyGap && now - lastSyncAt > 30 * 60_000) {
        lastSyncAt = now;
        requestHistorySyncFn()
          .then(() => {
            window.setTimeout(() => {
              qc.invalidateQueries({ queryKey: ["wa-conversations", user.id] });
              if (activeJid) {
                qc.invalidateQueries({ queryKey: ["wa-messages", user.id, activeJid] });
              }
            }, 3000);
          })
          .catch((err: unknown) => console.warn("[inbox] catch-up sync failed", err));
      }
    };

    const onFocus = () => catchUp("focus");
    const onVisibility = () => {
      if (document.visibilityState === "visible") catchUp("visible");
      else lastActiveAt = Date.now();
    };
    const onOnline = () => catchUp("online");
    const heartbeat = window.setInterval(() => {
      // Watchdog for suspended tabs / laptops waking from sleep where no
      // focus/visibility event fires. If the wall clock jumped, catch up.
      catchUp("interval");
    }, 20_000);

    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(heartbeat);
    };
  }, [qc, user?.id, activeJid, requestHistorySyncFn, requestChatSyncFn, conversations.length]);

  // If a known chat opens with only the first/newest message, ask the bridge for
  // that chat's backlog immediately. The WhatsApp connector exposes per-chat history requests
  // even when a global chat catalogue endpoint is unavailable.
  useEffect(() => {
    if (!user?.id || !activeJid) return;
    if (connQuery.data?.status !== "connected") return;
    if (msgsQuery.isFetching) return;
    if (mergedMessages.length > 3) return;
    const key = `${user.id}:${activeJid}`;
    if (chatHistoryRequestedRef.current.has(key)) return;
    chatHistoryRequestedRef.current.add(key);
    requestChatSyncFn({ data: { remoteJid: activeJid } })
      .then(() => {
        window.setTimeout(() => {
          qc.invalidateQueries({ queryKey: ["wa-conversations", user.id] });
          qc.invalidateQueries({ queryKey: ["wa-messages", user.id, activeJid] });
          qc.invalidateQueries({ queryKey: ["wa", "history-sync-job", user.id] });
        }, 5000);
      })
      .catch((err: unknown) => {
        chatHistoryRequestedRef.current.delete(key);
        console.warn("[inbox] focused chat history sync failed", err);
      });
  }, [user?.id, activeJid, connQuery.data?.status, msgsQuery.isFetching, mergedMessages.length, requestChatSyncFn, qc]);

  // Reset progressive pagination when conversation changes
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setIsLoadingOlder(false);
    preserveScrollRef.current = null;
    prevMsgLenRef.current = 0;
  }, [activeJid]);

  // Preserve scroll position when loading older messages; auto-scroll to bottom on new tail
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (preserveScrollRef.current != null) {
      // We just prepended older messages — keep the previously-visible message anchored.
      const delta = el.scrollHeight - preserveScrollRef.current;
      el.scrollTop = el.scrollTop + delta;
      preserveScrollRef.current = null;
      setIsLoadingOlder(false);
      prevMsgLenRef.current = mergedMessages.length;
      return;
    }
    const prev = prevMsgLenRef.current;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (mergedMessages.length !== prev) {
      // New message(s) appended or conversation switched — scroll to bottom if user is near it.
      if (nearBottom || prev === 0) {
        el.scrollTop = el.scrollHeight;
      }
      prevMsgLenRef.current = mergedMessages.length;
    }
  }, [visibleMessages, mergedMessages.length, activeJid]);

  // Scroll to bottom for typing indicator only when already near bottom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !isTyping) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [isTyping]);

  const handleMessagesScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop <= 60 && hasMoreOlder && !isLoadingOlder) {
      setIsLoadingOlder(true);
      preserveScrollRef.current = el.scrollHeight;
      setVisibleCount((c) => Math.min(c + PAGE_SIZE, mergedMessages.length));
    }
  }, [hasMoreOlder, isLoadingOlder, mergedMessages.length]);


  // Reset typing indicator when switching conversations
  useEffect(() => {
    setIsTyping(false);
  }, [activeJid]);


  // Mark active conversation read
  useEffect(() => {
    if (!activeJid || !user?.id) return;
    const c = conversations.find((x) => x.remote_jid === activeJid);
    if (c && c.unread_count > 0) {
      markReadFn({ data: { id: c.id } }).then(() => {
        qc.invalidateQueries({ queryKey: ["wa-conversations"] });
      }).catch((err: unknown) => console.warn("[inbox] mark read failed", err));
    }
  }, [activeJid, conversations, markReadFn, qc, user?.id]);

  // Auto-retry stuck pending messages. A message is "stuck" when it was
  // persisted (status='pending') but the bridge dispatch never completed —
  // typically because the fire-and-forget client dispatch was interrupted
  // (tab closed, network hiccup). We attempt each id at most twice per
  // mount to avoid loops.
  const autoDispatchAttemptsRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    if (!user?.id || !activeJid) return;
    const stuck = messages.filter(
      (m) => m.direction === "out" && m.status === "pending" && m.is_stale_pending && !m.id.startsWith("optimistic-"),
    );
    if (stuck.length === 0) return;
    for (const m of stuck) {
      const attempts = autoDispatchAttemptsRef.current.get(m.id) ?? 0;
      if (attempts >= 2) continue;
      autoDispatchAttemptsRef.current.set(m.id, attempts + 1);
      dispatchFn({ data: { messageId: m.id } })
        .then(() => {
          qc.invalidateQueries({ queryKey: ["wa-messages", user.id, activeJid] });
          qc.invalidateQueries({ queryKey: ["wa-conversations"] });
        })
        .catch((err: unknown) => {
          console.warn("[inbox] auto-dispatch failed for", m.id, err);
        });
    }
  }, [messages, activeJid, user?.id, dispatchFn, qc]);


  // Presence rule (per user request):
  //   • Opening a chat locks the AI silent on THAT chat for 10 minutes.
  //   • Ping is refreshed every 60s while the chat stays open, so the 10-min
  //     window slides forward as long as you're viewing it.
  //   • Leaving the chat does NOT clear the lock — the remaining time still
  //     counts down, then the AI resumes automatically.
  //   • Typing extends the window to a fresh 10 minutes.
  const TEN_MIN_MS = 10 * 60_000;
  const pingActive = useCallback((durationMs = TEN_MIN_MS) => {
    if (!activeJid) return;
    markActiveFn({ data: { remoteJid: activeJid, durationMs } }).catch(() => {
      /* best-effort: presence is advisory */
    });
  }, [activeJid, markActiveFn, TEN_MIN_MS]);

  useEffect(() => {
    if (!activeJid) return;
    pingActive();
    const t = setInterval(() => pingActive(), 60_000);
    return () => clearInterval(t);
  }, [activeJid, pingActive]);

  // Typing → refresh the 10-min silence window.
  useEffect(() => {
    if (!activeJid || !draft) return;
    const h = setTimeout(() => pingActive(TEN_MIN_MS), 250);
    return () => clearTimeout(h);
  }, [draft, activeJid, pingActive, TEN_MIN_MS]);




  // Textarea auto-grow
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [draft]);

  const [sendError, setSendError] = useState<SendErrorInfo | null>(null);
  // Auto-dismiss the inline alert when user switches chat or starts typing again.
  useEffect(() => { setSendError(null); }, [activeJid]);

  type SendVars = { text: string; file: File | null; previewUrl?: string | null };
  type SendContext = { optimisticId: string; draftBeforeSend: string };
  const sendMut = useMutation<unknown, Error, SendVars, SendContext>({
    mutationFn: async ({ text, file }: SendVars) => {
      let mediaUrl: string | undefined;
      let mediaType: "image" | "video" | "document" | "audio" | undefined;
      let mimeType: string | undefined;
      let fileName: string | undefined;
      if (file) {
        setUploadingAttachment(true);
        try {
          const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
          const path = `${user!.id}/outgoing/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
          const { error: upErr } = await supabase.storage
            .from("wa-media")
            .upload(path, file, { upsert: false, contentType: file.type });
          if (upErr) throw new Error(upErr.message);
          const { data: signed, error: sErr } = await supabase.storage
            .from("wa-media")
            .createSignedUrl(path, 60 * 60 * 24 * 7);
          if (sErr || !signed) throw new Error(sErr?.message || "Failed to sign media URL");
          mediaUrl = signed.signedUrl;
          mediaType = file.type.startsWith("video/")
            ? "video"
            : file.type.startsWith("audio/")
              ? "audio"
              : file.type.startsWith("image/")
                ? "image"
                : "document";
          mimeType = file.type || undefined;
          fileName = file.name;
        } finally {
          setUploadingAttachment(false);
        }
      }
      const persistRes = (await sendFn({
        data: {
          remoteJid: activeJid!,
          text,
          ...(mediaUrl ? { mediaUrl, mediaType, mimeType, fileName } : {}),
        },
      })) as { ok: boolean; messageId: string };
      // Fire-and-forget: bridge send can take 15–45s under retries. The
      // pending row + optimistic UI is already in place; delivery ACKs
      // arrive via the webhook (or an inline error via realtime status).
      void dispatchFn({ data: { messageId: persistRes.messageId } }).catch((err: Error) => {
        setSendError(classifySendError(err));
        qc.invalidateQueries({ queryKey: ["wa-messages", user?.id, activeJid] });
      });
      return persistRes;
    },
    onMutate: async (vars) => {
      const optimisticId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      if (user?.id && activeJid) {
        await qc.cancelQueries({ queryKey: ["wa-messages", user.id, activeJid] });
        const now = new Date().toISOString();
        const msgType = vars.file
          ? vars.file.type.startsWith("video/")
            ? "video"
            : vars.file.type.startsWith("audio/")
              ? "audio"
              : vars.file.type.startsWith("image/")
                ? "image"
                : "document"
          : "text";
        setOptimisticMessages((current) => [
          ...current,
          {
            id: optimisticId,
            remote_jid: activeJid,
            direction: "out",
            status: "pending",
            text_body: vars.text || vars.file?.name || null,
            msg_type: msgType,
            media_url: vars.previewUrl ?? null,
            created_at: now,
            is_ai: false,
            sender_name: null,
            sender_phone: null,
            delivery_state: "client_pending",
            queued_id: null,
            delivery_error: null,
            is_stale_pending: false,
          },
        ]);
        setDraft("");
        setSendError(null);
        window.setTimeout(() => textareaRef.current?.focus(), 0);
      }
      return { optimisticId, draftBeforeSend: draft };
    },
    onSuccess: (_res, vars, context) => {
      const hadFile = !!vars.file;
      setSendError(null);
      setAttachment(null);
      if (context?.optimisticId) {
        // Do NOT remove on a fixed timer — that caused the bubble to vanish
        // for a beat before the refetch delivered the persisted row.
        // The optimistic entry is dropped automatically once a matching real
        // outgoing message appears via `outgoingSignatures` in mergedMessages.
        // Safety cleanup after 60s in case the row never arrives.
        const idToClear = context.optimisticId;
        window.setTimeout(() => {
          setOptimisticMessages((current) => current.filter((m) => m.id !== idToClear));
        }, 60000);
      }
      qc.invalidateQueries({ queryKey: ["wa-messages", user?.id, activeJid] });
      qc.invalidateQueries({ queryKey: ["wa-conversations"] });
      toast.success(
        hadFile
          ? isAr ? "تم إرسال المرفق بنجاح" : "Attachment sent successfully"
          : isAr ? "تم إرسال الرسالة بنجاح" : "Message sent successfully",
      );
    },



    // Show a rich, dismissible inline alert instead of a noisy toast so the
    // user sees the reason + retry steps without spam on repeated attempts.
    onError: (err: Error, _vars, context) => {
      setSendError(classifySendError(err));
      if (context?.optimisticId) {
        setOptimisticMessages((current) =>
          current.map((m) =>
            m.id === context.optimisticId
              ? { ...m, status: "failed", delivery_error: err.message, is_stale_pending: false }
              : m,
          ),
        );
      }
      if (context?.draftBeforeSend) setDraft(context.draftBeforeSend);
      window.setTimeout(() => textareaRef.current?.focus(), 0);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["wa-messages", user?.id, activeJid] });
      qc.invalidateQueries({ queryKey: ["wa-conversations"] });
    },
  });



  const historySyncMut = useMutation({
    mutationFn: () => requestHistorySyncFn(),
    onMutate: () => {
      const baseConv = conversations.length;
      const now = Date.now();
      setSyncState({
        status: "running",
        baselineMsg: 0,
        baselineConv: baseConv,
        importedMsg: 0,
        importedConv: 0,
        startedAt: now,
        deadlineAt: now + 90000,
      });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["wa-conversations", user?.id] });
      if (activeJid) qc.invalidateQueries({ queryKey: ["wa-messages", user?.id, activeJid] });
      if (!res.ok && (res.error === "session_not_connected" || res.error === "no_session" || res.error === "bridge_session_missing")) {
        // إخفاء تنبيهات المزامنة عن العملاء — نُنهي بصمت.
        setSyncState((s) => ({ ...s, status: "idle" }));
        return;
      }
      if (!res.ok && res.error === "bridge_history_sync_endpoint_unavailable") {
        setSyncState((s) => ({ ...s, status: "idle" }));
        return;
      }
      if (res.ok && res.pending) {
        setSyncState((s) => ({
          ...s,
          status: "pending",
          deadlineAt: Date.now() + 90000,
        }));
        window.setTimeout(() => {
          qc.invalidateQueries({ queryKey: ["wa-conversations", user?.id] });
          if (activeJid) qc.invalidateQueries({ queryKey: ["wa-messages", user?.id, activeJid] });
        }, 8000);
        return;
      }
      if (res.ok) {
        setSyncState((s) => ({
          ...s,
          status: "idle",
          importedMsg: s.importedMsg,
        }));
        return;
      }
      // Silent completion — never surface a "done" state to the UI.
      setSyncState((s) => ({ ...s, status: "idle" }));
      qc.invalidateQueries({ queryKey: ["wa", "history-sync-job", user?.id ?? "anon"] });
    },
    onError: () => {
      setSyncState((s) => ({ ...s, status: "idle" }));
      qc.invalidateQueries({ queryKey: ["wa", "history-sync-job", user?.id ?? "anon"] });
    },
  });


  // Update imported delta from live stats and finish when deadline reached.
  useEffect(() => {
    if (syncState.status !== "running" && syncState.status !== "pending") return;
    const curConv = conversations.length;
    const importedMsg = syncState.importedMsg;
    const importedConv = Math.max(0, curConv - syncState.baselineConv);
    if (importedMsg !== syncState.importedMsg || importedConv !== syncState.importedConv) {
      setSyncState((s) => ({ ...s, importedMsg, importedConv }));
    }
    if (Date.now() >= syncState.deadlineAt) {
      // Deadline reached — end silently. No "done" state, no banner.
      setSyncState((s) => ({ ...s, status: "idle", message: undefined }));
    }

  }, [conversations.length, syncState.status, syncState.baselineConv, syncState.deadlineAt, syncState.importedMsg, syncState.importedConv]);

  // No "done" state ever surfaces to the UI — historySyncMut transitions
  // directly from running/pending → idle on success or error. This block
  // used to auto-hide a completion banner; it is intentionally removed.



  const aiToggleMut = useMutation({
    mutationFn: async (vars: { id: string; enabled: boolean }) => {
      const { error } = await supabase
        .from("wa_conversations")
        .update({ ai_enabled: vars.enabled })
        .eq("id", vars.id)
        .eq("user_id", user!.id);
      if (error) throw new Error(error.message);
      return { ok: true };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wa-conversations"] }),
    onError: (err: Error) => toast.error(err.message),
  });

  const filtered = useMemo(() => {
    const list = conversations;
    let out = list;
    if (filter === "unread") out = out.filter((c) => c.unread_count > 0);
    else if (filter === "ai") out = out.filter((c) => c.ai_enabled);
    if (timeRange !== "all") {
      const daysMap: Record<Exclude<TimeRangeKey, "all">, number> = { "1d": 1, "7d": 7, "30d": 30, "90d": 90 };
      const cutoff = Date.now() - daysMap[timeRange] * 24 * 60 * 60 * 1000;
      out = out.filter((c) => {
        const ts = conversationSortMs(c);
        return ts >= cutoff;
      });
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter(
        (c) =>
          c.remote_jid.toLowerCase().includes(q) ||
          (c.contact_phone ?? "").toLowerCase().includes(q) ||
          (c.contact_name ?? "").toLowerCase().includes(q) ||
          (c.last_message_text ?? "").toLowerCase().includes(q),
      );
    }
    return out;
  }, [conversations, search, filter, timeRange]);

  const totalUnread = useMemo(
    () => conversations.reduce((s, c) => s + (c.unread_count || 0), 0),
    [conversations],
  );

  const activeConv = useMemo(
    () => conversations.find((c) => c.remote_jid === activeJid),
    [conversations, activeJid],
  );

  // Notification beep via WebAudio (no asset needed, no autoplay issues once unlocked).
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioUnlockedRef = useRef(false);
  const soundOnRef = useRef(soundOn);
  useEffect(() => {
    soundOnRef.current = soundOn;
  }, [soundOn]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const unlock = () => {
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return;
        if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
        if (audioCtxRef.current.state === "suspended") void audioCtxRef.current.resume();
        audioUnlockedRef.current = true;
      } catch {
        /* ignore */
      }
    };
    const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "touchstart"];
    events.forEach((e) => window.addEventListener(e, unlock, { once: true, passive: true }));
    return () => {
      events.forEach((e) => window.removeEventListener(e, unlock));
    };
  }, []);

  const playBeep = () => {
    if (!soundOnRef.current) return;
    const ctx = audioCtxRef.current;
    if (!ctx || !audioUnlockedRef.current) return;
    try {
      if (ctx.state === "suspended") void ctx.resume();
      const now = ctx.currentTime;
      const playTone = (freq: number, start: number, duration: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now + start);
        gain.gain.exponentialRampToValueAtTime(0.25, now + start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + start);
        osc.stop(now + start + duration + 0.02);
      };
      playTone(880, 0, 0.15);
      playTone(1175, 0.16, 0.18);
    } catch {
      /* ignore */
    }
  };

  const testPlayback = async () => {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) throw new Error("no-audio");
      if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") await ctx.resume();
      audioUnlockedRef.current = true;
      const now = ctx.currentTime;
      const playTone = (freq: number, start: number, duration: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now + start);
        gain.gain.exponentialRampToValueAtTime(0.3, now + start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + start);
        osc.stop(now + start + duration + 0.02);
      };
      playTone(660, 0, 0.15);
      playTone(880, 0.16, 0.18);
      playTone(1175, 0.34, 0.22);
      toast.success(t.testSoundOk);
    } catch {
      toast.error(t.testSoundFail);
    }
  };

  const toggleSound = () => {
    setSoundOn((p) => {
      const next = !p;
      try {
        localStorage.setItem("flowtix-inbox-sound", String(next));
      } catch {
        /* ignore */
      }
      if (next) playBeep();
      return next;
    });
  };


  const Sidebar = (
    <aside dir={isAr ? "rtl" : "ltr"} className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card/60 backdrop-blur-sm">
      {/* Header */}
      <div className="space-y-3 border-b border-border/60 p-3 sm:p-4">
        {/* Title row */}
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-[oklch(0.52_0.28_290)] text-white shadow-lg shadow-primary/20 sm:h-11 sm:w-11">
            <InboxIcon className="h-5 w-5" strokeWidth={2.5} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[15px] font-bold leading-tight sm:text-base">{t.title}</h1>
              {totalUnread > 0 && (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                  {totalUnread}
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground sm:text-xs">{t.subtitle}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={toggleSound}
              className="flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-primary/10 hover:text-primary"
              aria-label={soundOn ? t.soundOn : t.soundOff}
              title={soundOn ? t.soundOn : t.soundOff}
            >
              {soundOn ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={testPlayback}
              className="hidden h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-primary/10 hover:text-primary sm:flex"
              aria-label={t.testSound}
              title={t.testSound}
            >
              <PlayCircle className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={async () => {
                await Promise.all([
                  qc.invalidateQueries({ queryKey: ["wa-conversations", user?.id] }),
                  qc.invalidateQueries({ queryKey: ["wa-messages"] }),
                  qc.invalidateQueries({ queryKey: ["wa-connection"] }),
                ]);
                if (activeJid) {
                  await requestChatSyncFn({ data: { remoteJid: activeJid } }).catch(() => null);
                  await Promise.all([
                    qc.invalidateQueries({ queryKey: ["wa-conversations", user?.id] }),
                    qc.invalidateQueries({ queryKey: ["wa-messages", user?.id, activeJid] }),
                  ]);
                } else {
                  historySyncMut.mutate();
                }
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-2.5 text-[11px] font-semibold text-primary transition hover:bg-primary/20 disabled:opacity-60 sm:text-xs"
              aria-label={t.resync}
              title={t.resync}
              disabled={historySyncMut.isPending || convQuery.isFetching}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${convQuery.isFetching || historySyncMut.isPending ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">{t.resync}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                lidMatchMut.mutate(undefined, {
                  onSuccess: (res) => {
                    if (!res || res.matched === 0) {
                      toast.info(
                        isAr
                          ? "لا توجد أرقام جديدة لربطها الآن"
                          : "No new phone numbers to link right now"
                      );
                    }
                  },
                });
              }}
              disabled={lidMatchMut.isPending}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-primary/30 bg-background px-2.5 text-[11px] font-semibold text-primary transition hover:bg-primary/10 disabled:opacity-60 sm:text-xs"
              aria-label={isAr ? "مطابقة الأرقام" : "Match numbers"}
              title={
                isAr
                  ? "ربط محادثات @lid بأرقام الجوال الحقيقية"
                  : "Link @lid chats to real phone numbers"
              }
            >
              <RefreshCw className={`h-3.5 w-3.5 ${lidMatchMut.isPending ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">{isAr ? "مطابقة الأرقام" : "Match numbers"}</span>
            </button>
          </div>

        </div>

        {/* Search */}
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground ltr:left-3 rtl:right-3" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.search}
            className="w-full rounded-2xl border border-input bg-background/80 px-10 py-2.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>

        {/* Filters — compact */}
        <div className="flex flex-wrap items-center gap-1.5">
          {([
            { k: "all" as FilterKey, label: t.all },
            { k: "unread" as FilterKey, label: t.filterUnread },
            { k: "ai" as FilterKey, label: t.filterAi },
          ]).map((f) => {
            const active = filter === f.k;
            return (
              <button
                key={f.k}
                type="button"
                onClick={() => setFilter(f.k)}
                className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                  active
                    ? "bg-gradient-to-r from-primary to-[oklch(0.52_0.28_290)] text-primary-foreground shadow-sm"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>


        {/* Status strip */}
        <div className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-[11px] font-medium text-muted-foreground">
          <div className="flex min-w-0 items-center gap-2">
            <span className={`inline-flex h-2 w-2 shrink-0 rounded-full ${connQuery.data?.status === "connected" ? "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.15)]" : "bg-muted-foreground/40"}`} aria-hidden />
            <span className={`shrink-0 font-semibold ${connQuery.data?.status === "connected" ? "text-emerald-600 dark:text-emerald-300" : "text-muted-foreground"}`}>
              {connQuery.data?.status === "connected" ? t.connected : t.disconnected}
            </span>
            <span className="text-muted-foreground/50" aria-hidden>·</span>
            <span className="truncate">
              {t.savedStats(conversations.length)}
            </span>
          </div>
          {/* Manual "Fetch all chats" button removed: the full history sync
              already runs automatically once the session becomes connected,
              so exposing this button led users to spam-click it thinking
              chats were missing. Silent auto-sync only. */}

        </div>
        {/* Sync banner intentionally removed — sync runs silently in the background
            and must never surface toasts or status messages to end customers. */}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {convQuery.isLoading ? (
          <ul className="divide-y divide-border/30" aria-busy="true" aria-label={t.loading}>
            {Array.from({ length: 8 }).map((_, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-3">
                <div className="h-11 w-11 shrink-0 animate-pulse rounded-full bg-muted" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="h-3.5 w-32 animate-pulse rounded bg-muted" />
                    <div className="h-3 w-10 animate-pulse rounded bg-muted/70" />
                  </div>
                  <div className="h-3 w-3/4 animate-pulse rounded bg-muted/70" />
                </div>
              </li>
            ))}
          </ul>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
              <MessageCircle className="h-6 w-6 text-muted-foreground" />
            </div>
            {connQuery.data?.status === "connected" ? (
              <>
                <p className="px-6 text-sm font-medium">
                  {isAr ? "لا توجد محادثات بعد." : "No conversations yet."}
                </p>
                <p className="max-w-xs px-6 text-xs text-muted-foreground">
                  {isAr
                    ? "بمجرد وصول رسالة جديدة على رقم واتساب المرتبط، ستظهر هنا تلقائيًا."
                    : "As soon as a new message arrives on the linked WhatsApp number, it will show up here automatically."}
                </p>
                <p className="mt-1 max-w-xs rounded-full bg-muted/60 px-3 py-1 text-[11px] text-muted-foreground/90">
                  {isAr
                    ? "المحادثات القديمة قد تظهر تدريجيًا — لا حاجة لأي إجراء."
                    : "Older chats may appear gradually — no action needed."}
                </p>
              </>
            ) : (
              <>
                <p className="px-6 text-sm font-medium">{t.empty}</p>
                <p className="px-6 text-xs text-muted-foreground">{t.emptyHint}</p>
                <Link
                  to="/dashboard/whatsapp/accounts"
                  className="mt-1 inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90"
                >
                  {t.openAccounts}
                </Link>
              </>
            )}

          </div>
        ) : (
          <ul className="divide-y divide-border/30 overflow-hidden">
            {filtered.map((c) => (
              <ConversationRow
                key={c.id}
                conv={c}
                active={activeJid === c.remote_jid}
                isAr={isAr}
                youLabel={t.you}
                mediaLabels={{ photo: t.photo, voice: t.voice, doc: t.doc, video: t.video }}
                onClick={() => setActiveJid(c.remote_jid)}
              />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );

  const ChatPane = (
    <section dir={isAr ? "rtl" : "ltr"} className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-gradient-to-br from-primary/[0.04] via-background to-primary/[0.06]">
      {!activeJid ? (
        <EmptyChat
          isAr={isAr}
          title={t.selectChat}
          hint={t.selectChatHint}
          suggestions={[t.suggestAccounts, t.suggestAi, t.suggestImport]}
        />
      ) : (
        <>
          {/* Chat Header */}
          <div className="flex items-center gap-2 border-b border-border/60 bg-card/80 px-3 py-3 backdrop-blur sm:px-4">
            <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
              {isMobile && (
                <button
                  type="button"
                  onClick={() => setActiveJid(null)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-muted"
                  aria-label={t.backToList}
                >
                  <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
                </button>
              )}
              <ContactAvatar
                name={activeConv ? displayConversationTitle(activeConv, isAr) : activeJid}
                src={activeConv?.profile_pic_url ?? null}
                size="md"
                isGroup={(activeConv?.remote_jid ?? activeJid ?? "").endsWith("@g.us")}
              />
              <div className="min-w-0 flex-1 overflow-hidden">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-bold">
                    {activeConv ? displayConversationTitle(activeConv, isAr) : activeJid.replace(/@.*/, "")}
                  </p>
                  {(() => {
                    const jid = activeConv?.remote_jid ?? activeJid ?? "";
                    const isLidJid = jid.endsWith("@lid");
                    const isGroup = jid.endsWith("@g.us");
                    if (isGroup) {
                      return (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                          <Users className="h-3 w-3" />
                          {isAr ? "جروب" : "Group"}
                        </span>
                      );
                    }
                    const knownPhone = digits(activeConv?.contact_phone ?? "");
                    // If we already know the customer's real phone number,
                    // treat the chat as fully identified even when routing
                    // still happens via the WhatsApp Linked ID address.
                    const isLid = isLidJid && !knownPhone;
                    return (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
                              isLid
                                ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                                : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                            }`}
                          >
                            <Info className="h-3 w-3" />
                            {isLid
                              ? isAr ? "معرّف مرتبط" : "Linked ID"
                              : isAr ? "رقم فعلي" : "Real number"}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-xs text-xs leading-relaxed">
                          {isLid
                            ? isAr
                              ? "هذه محادثة بمعرف واتساب مرتبط (@lid) يُخفي الرقم الحقيقي لحماية خصوصية المرسل. سيتم ربط الرقم الفعلي تلقائياً عند وصول أول رسالة يظهر فيها الرقم، أو يمكنك الضغط على «مطابقة الأرقام»."
                              : "This chat uses WhatsApp's Linked ID (@lid) which hides the real phone number for privacy. The real number will link automatically once a message reveals it, or you can run \"Match numbers\" manually."
                            : isAr
                              ? "تم التعرّف على رقم العميل الفعلي، والمحادثة تعمل بشكل طبيعي."
                              : "The contact's real phone number is identified and the chat works normally."}
                        </TooltipContent>
                      </Tooltip>
                    );
                  })()}
                </div>
                {(() => {
                  const jid = activeConv?.remote_jid ?? activeJid ?? "";
                  const isGroup = jid.endsWith("@g.us");
                  if (isGroup) {
                    return (
                      <p className="truncate text-xs text-muted-foreground flex items-center gap-1.5">
                        <Users className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                        <span>
                          {groupMemberCount > 0
                            ? (isAr
                                ? `${groupMemberCount} عضو نشط في المحادثة`
                                : `${groupMemberCount} active member${groupMemberCount === 1 ? "" : "s"} in chat`)
                            : (isAr ? "محادثة جماعية" : "Group conversation")}
                        </span>
                      </p>
                    );
                  }
                  return (
                    <p className="truncate text-xs text-muted-foreground" dir="ltr">
                      {activeConv ? displayConversationSubtitle(activeConv, isAr) : activeJid.replace(/@.*/, "")}
                    </p>
                  );
                })()}
              </div>

            </div>
            {activeConv && (
              <div className="flex max-w-[46vw] shrink-0 items-center gap-2 rounded-2xl border border-border/60 bg-background/60 px-2.5 py-1.5 sm:max-w-none sm:px-3">
                <Bot
                  className={`h-4 w-4 ${activeConv.ai_enabled ? "text-primary" : "text-muted-foreground"}`}
                />
                <div className="hidden flex-col sm:flex">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                    {t.aiBadge}
                  </span>
                  <span
                    className={`text-[10px] font-semibold ${
                      activeConv.ai_enabled ? "text-primary" : "text-muted-foreground"
                    }`}
                  >
                    {activeConv.ai_enabled ? t.aiOn : t.aiOff}
                  </span>
                </div>
                <Switch
                  checked={activeConv.ai_enabled}
                  disabled={aiToggleMut.isPending}
                  onCheckedChange={(v) =>
                    aiToggleMut.mutate({ id: activeConv.id, enabled: Boolean(v) })
                  }
                />
              </div>
            )}
            {!isMobile && !listVisible && (
              <button
                type="button"
                onClick={() => setListVisible(true)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-muted"
                aria-label={isAr ? "إظهار قائمة المحادثات" : "Show conversations"}
                title={isAr ? "إظهار قائمة المحادثات" : "Show conversations"}
              >
                <InboxIcon className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveJid(null)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-muted"
              aria-label={isAr ? "إغلاق المحادثة" : "Close chat"}
              title={isAr ? "إغلاق المحادثة" : "Close chat"}
            >
              <X className="h-4 w-4" />
            </button>
          </div>


          {/* Messages */}
          <div
            ref={scrollRef}
            onScroll={handleMessagesScroll}
            className="relative min-w-0 flex-1 space-y-1 overflow-x-hidden overflow-y-auto px-3 py-4 sm:px-6"
            style={{
              backgroundImage:
                "radial-gradient(circle at 20% 0%, oklch(0.62 0.27 295 / 0.06), transparent 40%), radial-gradient(circle at 80% 100%, oklch(0.52 0.28 290 / 0.05), transparent 40%)",
            }}
          >
            {msgsQuery.isLoading ? (
              <div className="space-y-3 py-2" aria-busy="true">
                {[["70%", "start"], ["55%", "end"], ["80%", "start"], ["45%", "end"], ["65%", "start"]].map(([w, side], i) => (
                  <div key={i} className={`flex ${side === "end" ? "justify-end" : "justify-start"}`}>
                    <div className="h-10 animate-pulse rounded-2xl bg-muted" style={{ width: w as string }} />
                  </div>
                ))}
              </div>
            ) : mergedMessages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 py-16 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
                  <MessageCircle className="h-7 w-7 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium">
                  {isAr ? "لا توجد رسائل بعد" : "No messages yet"}
                </p>
                <p className="max-w-xs px-6 text-xs text-muted-foreground">
                  {isAr ? "ابدأ المحادثة بكتابة رسالتك في الأسفل." : "Start the conversation by typing your message below."}
                </p>
              </div>
            ) : (
              <>
                {hasMoreOlder && (
                  <div className="flex justify-center py-2">
                    <button
                      type="button"
                      onClick={() => {
                        const el = scrollRef.current;
                        if (!el || isLoadingOlder) return;
                        setIsLoadingOlder(true);
                        preserveScrollRef.current = el.scrollHeight;
                        setVisibleCount((c) => Math.min(c + PAGE_SIZE, mergedMessages.length));
                      }}
                      className="rounded-full bg-card px-3 py-1 text-[11px] font-medium text-muted-foreground shadow-sm ring-1 ring-border/60 transition hover:text-foreground disabled:opacity-60"
                      disabled={isLoadingOlder}
                    >
                      {isLoadingOlder
                        ? (isAr ? "جارٍ التحميل…" : "Loading…")
                        : (isAr ? "تحميل رسائل أقدم" : "Load older messages")}
                    </button>
                  </div>
                )}
                {!hasMoreOlder && mergedMessages.length > PAGE_SIZE && (
                  <div className="flex justify-center py-2">
                    <span className="rounded-full bg-muted/60 px-3 py-1 text-[10px] text-muted-foreground">
                      {isAr ? "بداية المحادثة" : "Start of conversation"}
                    </span>
                  </div>
                )}
                {renderMessagesWithDays(visibleMessages, isAr, t)}
              </>
            )}
            {isTyping && activeJid && (
              <div dir="ltr" className="flex justify-start px-1 pt-1">
                <div
                  dir={isAr ? "rtl" : "ltr"}
                  className="inline-flex items-center gap-2 rounded-2xl bg-card px-3.5 py-2.5 text-sm shadow-[0_1px_2px_rgba(0,0,0,0.06),0_1px_1px_rgba(0,0,0,0.04)] ring-1 ring-border/60"
                  aria-live="polite"
                >
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {isAr ? "يكتب" : "typing"}
                  </span>
                  <span className="flex items-end gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/70 [animation-delay:-0.3s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/70 [animation-delay:-0.15s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/70" />
                  </span>
                </div>
              </div>
            )}
          </div>


          {/* Send failure alert — unified with toast tokens */}
          {sendError && (
            <Alert variant="destructive" className="mx-2.5 mt-2 sm:mx-3">
              <AlertTriangle />
              <button
                type="button"
                onClick={() => setSendError(null)}
                className="absolute end-2 top-2 rounded-md p-1 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                aria-label={isAr ? "إغلاق" : "Dismiss"}
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <AlertTitle>{isAr ? sendError.title.ar : sendError.title.en}</AlertTitle>
              <AlertDescription>
                <p>{isAr ? sendError.reason.ar : sendError.reason.en}</p>
                <ol className="mt-2 list-decimal space-y-0.5 ps-5 text-xs text-foreground/80">
                  {sendError.steps.map((s, i) => (
                    <li key={i}>{isAr ? s.ar : s.en}</li>
                  ))}
                </ol>
                {sendError.retryable && (
                  <button
                    type="button"
                    onClick={() => {
                      const text = draft.trim();
                      if ((!text && !attachment) || sendMut.isPending || uploadingAttachment) return;
                      sendMut.mutate({ text, file: attachment?.file ?? null });
                    }}
                    className="mt-2 inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted/60"
                    style={{ color: "var(--status-error)" }}
                  >
                    <RefreshCw className="h-3 w-3" />
                    {isAr ? "إعادة المحاولة" : "Retry"}
                  </button>
                )}
              </AlertDescription>
            </Alert>
          )}



          {/* Composer */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const text = draft.trim();
              if ((!text && !attachment) || sendMut.isPending || uploadingAttachment) return;
              sendMut.mutate({ text, file: attachment?.file ?? null });
            }}
            className="min-w-0 border-t border-border/60 bg-card/80 p-2.5 backdrop-blur sm:p-3"
          >
            {attachment && (
              <div className="mb-2 flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 p-2">
                {attachment.file.type.startsWith("image/") ? (
                  <img
                    src={attachment.previewUrl}
                    alt={attachment.file.name}
                    className="h-14 w-14 rounded-lg object-cover ring-1 ring-border"
                  />
                ) : (
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-border">
                    {attachment.file.type.startsWith("video/") ? <VideoIcon className="h-6 w-6 text-primary" /> : null}
                    {attachment.file.type.startsWith("audio/") ? <Mic className="h-6 w-6 text-primary" /> : null}
                    {!attachment.file.type.startsWith("video/") && !attachment.file.type.startsWith("audio/") ? <FileText className="h-6 w-6 text-primary" /> : null}
                  </div>
                )}
                <div className="min-w-0 flex-1 text-xs">
                  <div className="truncate font-medium">{attachment.file.name}</div>
                  <div className="text-muted-foreground">
                    {(attachment.file.size / 1024).toFixed(1)} KB
                    {uploadingAttachment ? (
                      <span className="ms-2 inline-flex items-center gap-1 text-primary">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {isAr ? "جاري الرفع…" : "Uploading…"}
                      </span>
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
                    setAttachment(null);
                  }}
                  disabled={uploadingAttachment}
                  className="rounded-lg px-2 py-1 text-xs text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                >
                  {isAr ? "إزالة" : "Remove"}
                </button>
              </div>
            )}
            <div className="flex min-w-0 items-end gap-1.5 rounded-2xl border border-input bg-background px-2 py-1.5 shadow-sm transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 sm:gap-2 sm:px-2.5">
              <Popover
                onOpenChange={(open) => {
                  if (open) {
                    toast.info(isAr ? "لوحة الإيموجي مفتوحة" : "Emoji picker opened", { duration: 1500 });
                  }
                }}
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-primary/10 hover:text-primary"
                    aria-label={isAr ? "إيموجي" : "emoji"}
                    title={isAr ? "إيموجي" : "Emoji"}
                  >
                    <Smile className="h-5 w-5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="z-50 w-[min(92vw,340px)] p-2" sideOffset={8}>
                  <EmojiPicker onPick={(e) => setDraft((d) => (d ?? "") + e)} isAr={isAr} />
                </PopoverContent>
              </Popover>
              <label
                className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl text-muted-foreground transition hover:bg-primary/10 hover:text-primary"
                aria-label={isAr ? "إرفاق ملف" : "Attach file"}
                title={isAr ? "إرفاق ملف" : "Attach file"}
              >
                <input
                  type="file"
                  accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    e.target.value = "";
                    if (f.size > 32 * 1024 * 1024) {
                      toast.error(isAr ? "الحد الأقصى للملف 32 ميجابايت" : "File must be ≤ 32MB");
                      return;
                    }
                    if (attachment?.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
                    setAttachment({ file: f, previewUrl: URL.createObjectURL(f) });
                  }}
                />
                <Paperclip className="h-5 w-5" />
              </label>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="relative flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/5 px-2 text-xs font-semibold text-primary transition hover:bg-primary/10 sm:px-2.5"
                    aria-label={isAr ? "ردود جاهزة" : "Quick replies"}
                    title={isAr ? "ردود جاهزة" : "Quick replies"}
                  >
                    <Zap className="h-4 w-4" />
                    <span className="hidden sm:inline">{isAr ? "ردود جاهزة" : "Quick replies"}</span>
                    {(quickRepliesQuery.data?.length ?? 0) > 0 && (
                      <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold leading-none">
                        {quickRepliesQuery.data?.length}
                      </span>
                    )}
                  </button>
                </PopoverTrigger>

                <PopoverContent align="start" className="w-[min(92vw,420px)] p-0" sideOffset={8}>
                  <QuickRepliesMenu
                    isAr={isAr}
                    replies={quickRepliesQuery.data ?? []}
                    loading={quickRepliesQuery.isLoading || quickRepliesQuery.isFetching}
                    onInsert={(body: string) => {
                      setDraft((d) => (d ? `${d} ${body}` : body));
                      textareaRef.current?.focus();
                    }}
                  />
                </PopoverContent>
              </Popover>
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  // Enter → send, Shift+Enter → newline.
                  // Ignore while an IME composition is active (Arabic/CJK keyboards)
                  // so mid-word Enter doesn't fire a premature send.
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing &&
                    e.keyCode !== 229
                  ) {
                    e.preventDefault();
                    const text = draft.trim();
                    if ((text || attachment) && !sendMut.isPending && !uploadingAttachment) {
                      sendMut.mutate({ text, file: attachment?.file ?? null });
                    }
                  }
                }}
                placeholder={attachment ? (isAr ? "أضف تعليقاً (اختياري)…" : "Add a caption (optional)…") : t.typeMessage}
                rows={1}
                className="max-h-32 min-w-0 flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none placeholder:text-muted-foreground"
              />
              <button
                type="submit"
                disabled={(!draft.trim() && !attachment) || sendMut.isPending || uploadingAttachment}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-[oklch(0.52_0.28_290)] text-primary-foreground shadow-md shadow-primary/30 transition hover:opacity-95 disabled:opacity-40"
                aria-label={t.send}
              >
                {sendMut.isPending || uploadingAttachment ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 rtl:rotate-180" />
                )}
              </button>
            </div>
            <div className="mt-1 px-1 text-[10px] text-muted-foreground/70">
              {isAr ? (
                <>
                  اضغط <kbd className="rounded border border-border bg-muted px-1 font-mono text-[9px]">Enter</kbd> للإرسال ·{" "}
                  <kbd className="rounded border border-border bg-muted px-1 font-mono text-[9px]">Shift</kbd> +{" "}
                  <kbd className="rounded border border-border bg-muted px-1 font-mono text-[9px]">Enter</kbd> لسطر جديد
                </>
              ) : (
                <>
                  Press <kbd className="rounded border border-border bg-muted px-1 font-mono text-[9px]">Enter</kbd> to send ·{" "}
                  <kbd className="rounded border border-border bg-muted px-1 font-mono text-[9px]">Shift</kbd> +{" "}
                  <kbd className="rounded border border-border bg-muted px-1 font-mono text-[9px]">Enter</kbd> for a new line
                </>
              )}
            </div>
          </form>

        </>
      )}
    </section>
  );

  const ContactPanel = activeConv ? (
    <ContactInfoPanel conv={activeConv} jid={activeJid!} isAr={isAr} />
  ) : (
    <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
      {isAr ? "اختر محادثة لعرض بيانات الجهة" : "Select a conversation to view contact info"}
    </div>
  );

  return (
    <DashboardLayout title={t.title}>
      <div
        dir={isAr ? "rtl" : "ltr"}
        className="h-[calc(100dvh-97px)] min-h-[520px] w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-border/60 bg-card md:h-[calc(100dvh-113px)]"
      >
        {isMobile ? (
          <div className="h-full min-w-0 overflow-hidden">
            {activeJid ? ChatPane : Sidebar}
          </div>
        ) : (
          <ResizablePanelGroup
            orientation="horizontal"
            className="h-full w-full min-w-0 overflow-hidden"
            id="wa-inbox-layout-v2"
            dir="ltr"
          >
            <ResizablePanel defaultSize="22%" minSize="16%" maxSize="32%" id="wa-contact">
              {ContactPanel}
            </ResizablePanel>
            <ResizableHandle withHandle className="bg-border/40" />
            <ResizablePanel defaultSize="52%" minSize="35%" id="wa-chat">
              {ChatPane}
            </ResizablePanel>
            <ResizableHandle withHandle className="bg-border/40" />
            <ResizablePanel defaultSize="26%" minSize="18%" maxSize="40%" id="wa-list">
              {Sidebar}
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
        <MediaLightbox />
      </div>
    </DashboardLayout>
  );
}

// Fullscreen wrapper with top bar + back button
function FullscreenInbox({
  isAr,
  title,
  totalUnread,
  children,
}: {
  isAr: boolean;
  title: string;
  totalUnread: number;
  children: React.ReactNode;
}) {
  const { theme, toggleTheme } = useTheme();
  return (
    <div
      dir={isAr ? "rtl" : "ltr"}
      className="fixed inset-0 z-50 flex flex-col bg-gradient-to-br from-background via-background to-primary/5"
    >
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/60 bg-card/90 px-4 backdrop-blur-xl">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            to="/dashboard"
            className="inline-flex h-9 items-center gap-2 rounded-xl bg-muted/60 px-3 text-sm font-semibold text-foreground transition hover:bg-primary/10 hover:text-primary"
          >
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
            <span>{isAr ? "رجوع" : "Back"}</span>
          </Link>
          <div className="hidden h-6 w-px bg-border md:block" />
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[oklch(0.52_0.28_290)] text-white shadow-md shadow-primary/20">
              <InboxIcon className="h-4 w-4" strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-bold leading-tight">{title}</h1>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {isAr ? "صندوق الوارد" : "Unified Inbox"}
              </p>
            </div>
            {totalUnread > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                {totalUnread}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={toggleTheme}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="theme"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <Link
            to="/dashboard"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            aria-label={isAr ? "إغلاق" : "Close"}
            title={isAr ? "خروج من المحادثة" : "Exit inbox"}
          >
            <X className="h-4 w-4" />
          </Link>
        </div>
      </header>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

function QuickRepliesMenu({
  isAr,
  replies,
  loading,
  onInsert,
}: {
  isAr: boolean;
  replies: QuickReply[];
  loading: boolean;
  onInsert: (body: string) => void;
}) {
  const qc = useQueryClient();
  const createFn = useServerFn(createQuickReply);
  const updateFn = useServerFn(updateQuickReply);
  const deleteFn = useServerFn(deleteQuickReply);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [editing, setEditing] = useState<QuickReply | null>(null);
  const [form, setForm] = useState({ shortcut: "", category: isAr ? "عام" : "General", body: "", sort_order: 0 });

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const reply of replies) set.add(reply.category?.trim() || (isAr ? "عام" : "General"));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [isAr, replies]);

  const filteredReplies = useMemo(() => {
    const q = search.trim().toLowerCase();
    return replies.filter((reply) => {
      const replyCategory = reply.category?.trim() || (isAr ? "عام" : "General");
      const matchesCategory = category === "all" || replyCategory === category;
      const matchesSearch =
        !q ||
        reply.shortcut.toLowerCase().includes(q) ||
        reply.body.toLowerCase().includes(q) ||
        replyCategory.toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [category, isAr, replies, search]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["wa-quick-replies"] });
    qc.invalidateQueries({ queryKey: ["wa-quick-replies-mgmt"] });
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        shortcut: form.shortcut.trim(),
        category: form.category.trim() || (isAr ? "عام" : "General"),
        body: form.body.trim(),
        sort_order: Number(form.sort_order) || 0,
      };
      if (!payload.shortcut || !payload.body) throw new Error(isAr ? "اكتب الاختصار والنص" : "Shortcut and body are required");
      if (editing) return updateFn({ data: { id: editing.id, ...payload } });
      return createFn({ data: payload });
    },
    onSuccess: () => {
      toast.success(editing ? (isAr ? "تم تعديل الرد" : "Reply updated") : isAr ? "تم إضافة الرد" : "Reply added");
      setEditing(null);
      setForm({ shortcut: "", category: form.category || (isAr ? "عام" : "General"), body: "", sort_order: 0 });
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success(isAr ? "تم حذف الرد" : "Reply deleted");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const startEdit = (reply: QuickReply) => {
    setEditing(reply);
    setForm({
      shortcut: reply.shortcut,
      category: reply.category || (isAr ? "عام" : "General"),
      body: reply.body,
      sort_order: reply.sort_order ?? 0,
    });
  };

  return (
    <div dir={isAr ? "rtl" : "ltr"} className={isAr ? "text-right" : "text-left"}>
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <p className="text-sm font-semibold">{isAr ? "الرسائل الجاهزة" : "Quick replies"}</p>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      <div className="space-y-2 border-b border-border p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground ltr:left-3 rtl:right-3" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isAr ? "بحث في الرسائل الجاهزة…" : "Search quick replies…"}
            className="h-9 w-full rounded-lg border border-input bg-background px-9 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="flex gap-1 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setCategory("all")}
            className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${category === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
          >
            {isAr ? "الكل" : "All"}
          </button>
          {categories.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setCategory(item)}
              className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${category === item ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="max-h-64 overflow-y-auto p-1.5">
        {filteredReplies.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            {isAr ? "لا توجد رسائل مطابقة." : "No matching replies."}
          </div>
        ) : (
          filteredReplies.map((reply) => (
            <div key={reply.id} className="group rounded-lg px-2 py-2 hover:bg-muted/70">
              <button type="button" onClick={() => onInsert(reply.body)} className="w-full text-start">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-primary">/{reply.shortcut}</span>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    {reply.category || (isAr ? "عام" : "General")}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm leading-5 text-foreground">{reply.body}</p>
              </button>
              <div className="mt-1 flex justify-end gap-1 opacity-100 sm:opacity-0 sm:transition sm:group-hover:opacity-100">
                <button type="button" onClick={() => startEdit(reply)} className="rounded-md p-1.5 text-muted-foreground hover:bg-background hover:text-primary" aria-label={isAr ? "تعديل" : "Edit"}>
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => deleteMut.mutate(reply.id)} className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={isAr ? "حذف" : "Delete"}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="space-y-2 border-t border-border bg-muted/20 p-3">
        <div className="grid grid-cols-2 gap-2">
          <input value={form.shortcut} onChange={(e) => setForm((f) => ({ ...f, shortcut: e.target.value }))} placeholder={isAr ? "اختصار" : "Shortcut"} className="h-9 rounded-lg border border-input bg-background px-2 text-sm outline-none focus:border-primary" />
          <input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder={isAr ? "تصنيف" : "Category"} className="h-9 rounded-lg border border-input bg-background px-2 text-sm outline-none focus:border-primary" />
        </div>
        <textarea value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} rows={2} placeholder={isAr ? "نص الرسالة الجاهزة" : "Reply body"} className="w-full resize-none rounded-lg border border-input bg-background px-2 py-2 text-sm outline-none focus:border-primary" />
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => { setEditing(null); setForm({ shortcut: "", category: isAr ? "عام" : "General", body: "", sort_order: 0 }); }} className="text-xs font-medium text-muted-foreground hover:text-foreground">
            {editing ? (isAr ? "إلغاء التعديل" : "Cancel edit") : isAr ? "تفريغ" : "Clear"}
          </button>
          <button type="button" onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50">
            {saveMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {editing ? (isAr ? "حفظ التعديل" : "Save edit") : isAr ? "إضافة" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Contact info side panel
function ContactInfoPanel({
  conv,
  jid,
  isAr,
}: {
  conv: ConversationRow;
  jid: string;
  isAr: boolean;
}) {
  const [tab, setTab] = useState<"info" | "notes" | "media">("info");
  const [saving, setSaving] = useState(false);
  const name = displayConversationTitle(conv, isAr);
  const phone = displayConversationSubtitle(conv, isAr);
  const canSaveCustomer = Boolean(conv.contact_phone);

  const summarizeFn = useServerFn(summarizeConversation);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryText, setSummaryText] = useState("");
  const [summaryMeta, setSummaryMeta] = useState<{ model: string; count: number } | null>(null);
  const [summarizing, setSummarizing] = useState(false);

  async function handleSummarize() {
    setSummarizing(true);
    setSummaryOpen(true);
    setSummaryText("");
    setSummaryMeta(null);
    try {
      const res = await summarizeFn({ data: { remoteJid: jid, limit: 80 } });
      setSummaryText(res.summary);
      setSummaryMeta({ model: res.model, count: res.messageCount });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setSummaryText((isAr ? "فشل التلخيص: " : "Summary failed: ") + msg);
    } finally {
      setSummarizing(false);
    }
  }

  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveEmail, setSaveEmail] = useState("");
  const [saveCity, setSaveCity] = useState("");
  const [saveNotes, setSaveNotes] = useState("");


  function openSaveDialog() {
    setSaveName(conv.contact_name ?? "");
    setSaveEmail("");
    setSaveCity("");
    setSaveNotes("");
    setSaveOpen(true);
  }

  async function handleSaveCustomer() {
    if (saving) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error(isAr ? "يجب تسجيل الدخول" : "Login required");
        return;
      }
      if (!canSaveCustomer || !conv.contact_phone) {
        toast.error(isAr ? "لا يوجد رقم موبايل حقيقي لهذه المحادثة حتى الآن" : "This chat does not have a real phone number yet");
        return;
      }
      const rawPhone = conv.contact_phone;
      const row = buildRow({
        user_id: user.id,
        full_name: saveName.trim() || null,
        phone: rawPhone,
        email: saveEmail.trim() || null,
        city: saveCity.trim() || null,
        notes: saveNotes.trim() || (isAr ? "تم الحفظ من المحادثات" : "Saved from inbox"),
      });
      if (row.phone_norm) {
        const { data: existing } = await supabase
          .from("customer_database")
          .select("id")
          .eq("user_id", user.id)
          .eq("phone_norm", row.phone_norm)
          .maybeSingle();
        if (existing) {
          toast.info(isAr ? "العميل محفوظ بالفعل — يمكنك تعديله من قاعدة العملاء" : "Already saved — edit from customers");
          setSaveOpen(false);
          return;
        }
      }
      const { error } = await supabase.from("customer_database").insert(row);
      if (error) throw error;
      toast.success(isAr ? "تم حفظ العميل في قاعدة بياناتك" : "Customer saved");
      setSaveOpen(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error((isAr ? "فشل الحفظ: " : "Save failed: ") + msg);
    } finally {
      setSaving(false);
    }
  }


  return (
    <aside dir={isAr ? "rtl" : "ltr"} className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card/40 backdrop-blur-sm">
      {/* Contact header */}
      <div className="flex flex-col items-center gap-3 border-b border-border/60 p-5 text-center">
        <div className="relative">
          <ContactAvatar name={name} src={conv.profile_pic_url ?? null} size="lg" isGroup={conv.remote_jid.endsWith("@g.us")} />
          <span className="absolute bottom-1 end-1 h-4 w-4 rounded-full border-2 border-card bg-emerald-500" />
        </div>
        <div className="min-w-0 max-w-full overflow-hidden">
          <h2 className="truncate text-base font-bold">{name}</h2>
          <p className="mt-0.5 inline-flex max-w-full items-center gap-1.5 truncate text-xs text-muted-foreground" dir="ltr">
            <Phone className="h-3 w-3" />
            {phone}
          </p>
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {isAr ? "متصل الآن" : "Online"}
          </div>
        </div>
        <div className="grid w-full grid-cols-2 gap-2">
          <button
            type="button"
            onClick={openSaveDialog}
            disabled={saving || !canSaveCustomer}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-background/60 px-2 py-2 text-[11px] font-semibold transition hover:border-primary/40 hover:bg-primary/5 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> : <UserPlus className="h-3.5 w-3.5 text-primary" />}
            {isAr ? "حفظ" : "Save"}
          </button>

          <button
            type="button"
            onClick={handleSummarize}
            disabled={summarizing}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-background/60 px-2 py-2 text-[11px] font-semibold transition hover:border-primary/40 hover:bg-primary/5 disabled:opacity-60"
          >
            {summarizing ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> : <Sparkles className="h-3.5 w-3.5 text-primary" />}
            {isAr ? "تلخيص" : "Summary"}
          </button>

        </div>
      </div>

      {/* Tabs */}
      <div className="flex shrink-0 items-center justify-around border-b border-border/60 bg-background/30">
        {([
          { k: "info" as const, label: isAr ? "معلومات" : "Info", icon: Info },
          { k: "notes" as const, label: isAr ? "ملاحظات" : "Notes", icon: StickyNote },
          { k: "media" as const, label: isAr ? "وسائط" : "Media", icon: ImageIcon },
        ]).map((tb) => {
          const Icon = tb.icon;
          const active = tab === tb.k;
          return (
            <button
              key={tb.k}
              type="button"
              onClick={() => setTab(tb.k)}
              className={`relative flex flex-1 items-center justify-center gap-1.5 py-3 text-xs font-semibold transition ${
                active ? "text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tb.label}
              {active && (
                <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-gradient-to-r from-primary to-[oklch(0.52_0.28_290)]" />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4 text-sm">
        {tab === "info" && (
          <div className="space-y-3">
            <InfoRow label={isAr ? "الاسم" : "Name"} value={name} />
            <InfoRow label={isAr ? "الهاتف" : "Phone"} value={phone} ltr />
            <InfoRow
              label={isAr ? "حالة المساعد" : "AI Assistant"}
              value={conv.ai_enabled ? (isAr ? "مفعّل" : "Enabled") : (isAr ? "متوقف" : "Off")}
            />
            <InfoRow
              label={isAr ? "غير مقروء" : "Unread"}
              value={String(conv.unread_count ?? 0)}
            />
            <InfoRow
              label={isAr ? "آخر نشاط" : "Last activity"}
              value={new Date(conv.last_message_at).toLocaleString(isAr ? "ar-EG" : "en-US")}
            />
          </div>
        )}
        {tab === "notes" && (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-xs text-muted-foreground">
            <StickyNote className="h-8 w-8 opacity-40" />
            <p>{isAr ? "لا توجد ملاحظات بعد" : "No notes yet"}</p>
          </div>
        )}
        {tab === "media" && (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-xs text-muted-foreground">
            <ImageIcon className="h-8 w-8 opacity-40" />
            <p>{isAr ? "لا توجد وسائط مشاركة" : "No shared media"}</p>
          </div>
        )}
      </div>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="max-w-md" dir={isAr ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle>{isAr ? "حفظ العميل في قاعدة بياناتي" : "Save customer to my database"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">{isAr ? "الموبايل" : "Phone"}</label>
              <Input value={phone} readOnly disabled className="font-mono" dir="ltr" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">
                {isAr ? "الاسم (اختياري)" : "Name (optional)"}
              </label>
              <Input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder={isAr ? "اترك فارغاً إذا لم تعرف الاسم" : "Leave blank if unknown"} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">{isAr ? "الإيميل (اختياري)" : "Email (optional)"}</label>
                <Input value={saveEmail} onChange={(e) => setSaveEmail(e.target.value)} type="email" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">{isAr ? "المدينة (اختياري)" : "City (optional)"}</label>
                <Input value={saveCity} onChange={(e) => setSaveCity(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">{isAr ? "ملاحظات (اختياري)" : "Notes (optional)"}</label>
              <Textarea value={saveNotes} onChange={(e) => setSaveNotes(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)} disabled={saving}>
              {isAr ? "إلغاء" : "Cancel"}
            </Button>
            <Button onClick={handleSaveCustomer} disabled={saving} className="gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {isAr ? "حفظ" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={summaryOpen} onOpenChange={setSummaryOpen}>
        <DialogContent dir={isAr ? "rtl" : "ltr"} className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              {isAr ? "ملخّص المحادثة" : "Conversation summary"}
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-[120px] max-h-[60vh] overflow-y-auto whitespace-pre-wrap rounded-md border border-border/60 bg-muted/30 p-3 text-sm leading-relaxed">
            {summarizing ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {isAr ? "جارٍ توليد الملخص…" : "Generating summary…"}
              </div>
            ) : (
              summaryText || (isAr ? "لا يوجد ملخص" : "No summary")
            )}
          </div>
          {summaryMeta && !summarizing && (
            <p className="text-[11px] text-muted-foreground">
              {summaryMeta.count} {isAr ? "رسالة" : "messages"}
            </p>
          )}
          <DialogFooter>
            {summaryText && !summarizing && (
              <button
                type="button"
                onClick={() => { navigator.clipboard.writeText(summaryText); toast.success(isAr ? "تم النسخ" : "Copied"); }}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold hover:bg-muted"
              >
                {isAr ? "نسخ" : "Copy"}
              </button>
            )}
            <button
              type="button"
              onClick={() => setSummaryOpen(false)}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
            >
              {isAr ? "إغلاق" : "Close"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}


function InfoRow({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border border-border/60 bg-background/40 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 min-w-0 truncate text-sm font-medium" dir={ltr ? "ltr" : undefined}>{value}</p>
    </div>
  );
}

function ContactAvatar({
  name,
  src,
  size,
  isGroup = false,
}: {
  name: string;
  src: string | null;
  size: "sm" | "md" | "lg";
  isGroup?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const sizeClass =
    size === "lg"
      ? "h-20 w-20 text-2xl shadow-lg shadow-primary/30"
      : size === "md"
        ? "h-11 w-11 text-sm shadow-md shadow-primary/20"
        : "h-11 w-11 text-sm shadow-sm shadow-primary/20";

  // Groups: always render a distinctive group icon so they can't be mistaken
  // for a member's personal photo (WhatsApp group profile pics are often
  // stale, generic, or actually one member's avatar).
  if (isGroup) {
    const iconSize = size === "lg" ? "h-9 w-9" : "h-5 w-5";
    return (
      <div
        title={name}
        className={`${sizeClass} flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-emerald-700 text-white ring-1 ring-emerald-600/40`}
      >
        <Users className={iconSize} strokeWidth={2.25} />
      </div>
    );
  }

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={name}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`${sizeClass} shrink-0 rounded-full object-cover ring-1 ring-border/50`}
      />
    );
  }

  return (
    <div className={`${sizeClass} flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-[oklch(0.52_0.28_290)] font-bold text-white`}>
      {initials(name)}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Subcomponents
// ──────────────────────────────────────────────────────────────────────────

function ConversationRow({
  conv,
  active,
  isAr,
  youLabel,
  mediaLabels,
  onClick,
}: {
  conv: ConversationRow;
  active: boolean;
  isAr: boolean;
  youLabel: string;
  mediaLabels: { photo: string; voice: string; doc: string; video: string };
  onClick: () => void;
}) {
  const media = detectMedia(conv.last_message_text, mediaLabels);
  const hasUnread = (conv.unread_count ?? 0) > 0;
  const title = displayConversationTitle(conv, isAr);
  const subtitle = displayConversationSubtitle(conv, isAr);
  return (
    <li className="relative">
      <button
        type="button"
        onClick={onClick}
        className={`relative flex w-full min-w-0 items-center gap-3 overflow-hidden px-3 py-3 text-start transition ${
          active
            ? "bg-primary/10"
            : hasUnread
              ? "bg-primary/[0.04] hover:bg-primary/10 dark:bg-primary/10 dark:hover:bg-primary/15"
              : "hover:bg-muted/50"
        }`}
      >
        {active && (
          <span className="absolute top-2 bottom-2 w-1 rounded-full bg-gradient-to-b from-primary to-[oklch(0.52_0.28_290)] ltr:left-0 rtl:right-0" />
        )}
        {!active && hasUnread && (
          <span className="absolute top-3 bottom-3 w-[3px] rounded-full bg-gradient-to-b from-primary to-[oklch(0.52_0.28_290)] ltr:left-0 rtl:right-0" />
        )}
        <div className="relative shrink-0">
          <ContactAvatar name={title} src={conv.profile_pic_url ?? null} size="sm" isGroup={conv.remote_jid.endsWith("@g.us")} />
          {hasUnread && (
            <span className="absolute -top-0.5 -end-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-background" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className={`min-w-0 flex-1 truncate text-sm ${hasUnread ? "font-bold text-foreground" : "font-semibold"}`}>
              {title}
            </span>
            <span className={`flex shrink-0 flex-col items-end leading-tight ${hasUnread ? "text-primary" : "text-muted-foreground/90"}`} dir="ltr">
              <span className={`text-[10px] tabular-nums ${hasUnread ? "font-bold" : "font-medium"}`}>
                {formatRelative(conv.last_message_at, isAr)}
              </span>
              <span className="mt-0.5 text-[9px] font-medium tabular-nums opacity-75">
                {formatAgo(conv.last_message_at, isAr)}
              </span>
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <p className={`block min-w-0 flex-1 truncate text-xs ${hasUnread ? "font-medium text-foreground" : "text-muted-foreground"}`}>
              {conv.last_direction === "out" && (
                <span className="font-medium text-primary">{youLabel}: </span>
              )}
              {media ? (
                <span className="inline-flex items-center gap-1 align-middle">
                  {media.icon}
                  <span>{media.label}</span>
                </span>
              ) : (
                conv.last_message_text ?? "—"
              )}
            </p>
            {subtitle && !conv.contact_name && (
              <span className="hidden max-w-[86px] shrink-0 truncate text-[10px] text-muted-foreground sm:inline" dir="ltr">
                {subtitle}
              </span>
            )}
            {conv.ai_enabled && (
              <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary" title="AI">
                <Bot className="h-2.5 w-2.5" />
              </span>
            )}
            {hasUnread && (
              <span
                className="inline-flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-[oklch(0.52_0.28_290)] px-1.5 text-[11px] font-bold leading-none text-primary-foreground shadow-md ring-2 ring-background animate-in zoom-in-50 duration-200"
                aria-label={isAr ? `${conv.unread_count} رسائل غير مقروءة` : `${conv.unread_count} unread messages`}
              >
                {conv.unread_count > 99 ? "99+" : conv.unread_count}
              </span>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}


function EmptyChat({
  isAr,
  title,
  hint,
  suggestions,
}: {
  isAr: boolean;
  title: string;
  hint: string;
  suggestions: string[];
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 p-8 text-center">
      <div className="relative flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-primary/15 to-primary/5 ring-1 ring-primary/20">
        <Sparkles className="h-9 w-9 text-primary" />
        <span className="absolute -end-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground shadow">
          ✦
        </span>
      </div>
      <div className="max-w-md">
        <h3 className="text-base font-bold">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {suggestions.map((s, i) => (
          <span
            key={s}
            className={`rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-semibold text-primary ${
              i === 0 ? "" : "opacity-80"
            }`}
          >
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

async function fetchInboxConversations(userId: string): Promise<ConversationRow[]> {
  // الترتيب أصبح مضمونًا من قاعدة البيانات عبر trigger عند كل رسالة،
  // لذلك لا نقرأ آلاف الرسائل عند فتح الوارد حتى لا نضغط Disk IO.
  const { data, error } = await supabase
    .from("wa_conversations")
    .select("id, session_id, remote_jid, contact_name, contact_phone, profile_pic_url, last_message_text, last_message_at, last_direction, unread_count, ai_enabled")
    .eq("user_id", userId)
    .eq("is_archived", false)
    .order("last_message_at", { ascending: false })
    .limit(2000);

  if (error) throw new Error(error.message);
  const visibleRows: RankedConversationRow[] = ((data ?? []) as ConversationRow[]).map((row): RankedConversationRow => {
    const isGroup = row.remote_jid.endsWith("@g.us");
    return {
      ...row,
      contact_phone: isGroup ? null : row.contact_phone,
      profile_pic_url: row.profile_pic_url ?? null,
      _sort_at: row.last_message_at,
      _has_stored_message: true,
    };
  });

  return visibleRows
    .sort(compareConversationsByLastRealActivity)
    .slice(0, 2000);
}

async function fetchInboxMessages(userId: string, remoteJid: string): Promise<ChatMessageRow[]> {
  const { data: convAliases } = await supabase
    .from("wa_conversations")
    .select("contact_phone")
    .eq("user_id", userId)
    .eq("remote_jid", remoteJid)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const messageAliases = inboxJidAliases(remoteJid, convAliases?.contact_phone ?? null);
  const baseSelect = "id, remote_jid, direction, status, text_body, msg_type, media_url, provider_message_id, wa_timestamp, created_at, raw";
  const { data: jidRows, error } = await supabase
    .from("wa_messages")
    // نحتاج raw كمسار احتياطي لأن بعض دفعات الأرشيف القديمة حملت رابط/بيانات الوسيط داخل JSON
    // قبل حفظه في media_url. الاستعلام محدود بآخر 200 رسالة للمحادثة المفتوحة فقط.
    .select(baseSelect)
    .eq("user_id", userId)
    .in("remote_jid", messageAliases)
    .order("wa_timestamp", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw new Error(error.message);
  const phone = cleanAliasPhone(convAliases?.contact_phone, remoteJid);
  const { data: phoneRows, error: phoneError } = phone
    ? await supabase
        .from("wa_messages")
        .select(baseSelect)
        .eq("user_id", userId)
        .or(`from_phone.eq.${phone},to_phone.eq.${phone}`)
        .order("wa_timestamp", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(200)
    : { data: [], error: null };

  if (phoneError) throw new Error(phoneError.message);


  const dedupedRows = Array.from(
    new Map([...(jidRows ?? []), ...(phoneRows ?? [])].map((row) => [row.id, row])).values(),
  );
  const rows = dedupedRows
    .filter((row) => {
      const hasText = Boolean(row.text_body?.trim());
      const hasMedia = Boolean(row.media_url?.trim()) || normalizeWaMessageType(row.msg_type) !== "text";
      return hasText || hasMedia;
    })
    .reverse();
  return Promise.all(rows.map(async (row) => {
    const raw = asRecord(row.raw);
    const msgType = mediaTypeFromRaw(raw, row.msg_type);
    const storedMediaUrl = typeof row.media_url === "string" && row.media_url.trim() ? row.media_url.trim() : null;
    const rawMediaUrl = mediaUrlFromRaw(raw, msgType);
    const mediaUrl = await resolveInboxMediaUrl(preferInboxMediaUrl(storedMediaUrl, rawMediaUrl));
    const isAi = raw.ai === true;
    const rawDelivery = String(raw.delivery ?? "").toLowerCase();
    const queuedId = pickString(raw, "queuedId", "queued_id", "queueId", "queue_id", "requestId", "jobId");
    const deliveryError = pickString(raw, "error", "deliveryError", "lastError");
    const hasConfirmedDelivery = Boolean(
      row.provider_message_id || pickString(raw, "providerMessageId", "bridgeMessageId", "messageId", "id"),
    );
    const visibleStatus = row.status ?? (row.direction === "out" ? "sent" : "received");
    const messageTime = new Date(row.wa_timestamp ?? row.created_at).getTime();
    const isStalePending = Boolean(
      row.direction === "out" &&
      visibleStatus === "pending" &&
      !hasConfirmedDelivery &&
      Number.isFinite(messageTime) &&
      Date.now() - messageTime > 120_000,
    );
    return {
      id: row.id,
      remote_jid: row.remote_jid,
      direction: row.direction as "in" | "out",
      status: visibleStatus,
      text_body: cleanMessageText(row.text_body, raw, msgType),
      msg_type: msgType,
      media_url: mediaUrl,
      created_at: row.wa_timestamp ?? row.created_at,
      is_ai: isAi,
      sender_name: pickString(raw, "pushName", "senderName", "notifyName", "contactName"),
      sender_phone: digits(pickString(raw, "participantPn", "senderPn", "phoneNumber")),
      delivery_state: rawDelivery || null,
      queued_id: queuedId,
      delivery_error: deliveryError,
      is_stale_pending: isStalePending,
    };
  }));
}


async function fetchInboxQuickReplies(userId: string): Promise<QuickReply[]> {
  const { data, error } = await supabase
    .from("wa_quick_replies")
    .select("id, shortcut, category, body, sort_order, created_at")
    .eq("user_id", userId)
    .order("category", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as QuickReply[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function pickString(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function digits(value: string | null): string | null {
  const cleaned = value?.replace(/[^0-9]/g, "") ?? "";
  return cleaned || null;
}

function jidLocal(jid: string): string {
  return jid.split("@")[0] ?? "";
}

function isLidLocal(local: string): boolean {
  return /^\d{14,}$/.test(local);
}

function isLidJid(jid: string): boolean {
  return jid.endsWith("@lid") || (jid.endsWith("@s.whatsapp.net") && isLidLocal(jidLocal(jid)));
}

function displayConversationTitle(conv: ConversationRow, isAr: boolean): string {
  const name = usefulContactName(conv.contact_name, conv.contact_phone, conv.remote_jid);
  if (name) return name;
  if (conv.contact_phone) return `+${conv.contact_phone}`;
  if (conv.remote_jid.endsWith("@g.us")) return conv.remote_jid.replace(/@.*/, "");
  if (isLidJid(conv.remote_jid)) return isAr ? "محادثة واتساب" : "WhatsApp chat";
  return conv.remote_jid.replace(/@.*/, "");
}

function displayConversationSubtitle(conv: ConversationRow, isAr: boolean): string {
  if (conv.contact_phone) return `+${conv.contact_phone}`;
  if (isLidJid(conv.remote_jid)) return isAr ? "معرّف واتساب خاص" : "Private WhatsApp ID";
  return conv.remote_jid;
}

function inboxJidAliases(remoteJid: string, contactPhone?: string | null): string[] {
  const local = jidLocal(remoteJid);
  const aliases = new Set([remoteJid]);
  if (remoteJid.endsWith("@lid")) aliases.add(`${local}@s.whatsapp.net`);
  else if (remoteJid.endsWith("@s.whatsapp.net") && isLidLocal(local)) aliases.add(`${local}@lid`);
  const phone = cleanAliasPhone(contactPhone, remoteJid);
  if (phone) aliases.add(`${phone}@s.whatsapp.net`);
  return Array.from(aliases);
}

function cleanAliasPhone(phone: string | null | undefined, canonicalJid: string): string | null {
  const local = jidLocal(canonicalJid);
  const normalized = digits(phone ?? null);
  if (!normalized) return null;
  return isLidLocal(local) && normalized === local ? null : normalized;
}

function conversationIdentities(conv: ConversationRow, lidLocals: Set<string>): string[] {
  const local = jidLocal(conv.remote_jid);
  const identities = new Set<string>([`jid:${conv.remote_jid}`]);
  if (local && (conv.remote_jid.endsWith("@lid") || lidLocals.has(local))) identities.add(`lid:${local}`);
  const phone = cleanAliasPhone(conv.contact_phone, conv.remote_jid);
  if (phone) identities.add(`phone:${phone}`);
  return Array.from(identities);
}

function usefulContactName(name: string | null | undefined, phone: string | null | undefined, jid: string): string | null {
  const cleaned = name?.trim();
  if (!cleaned) return null;
  const compact = cleaned.replace(/\s+/g, "");
  if (/^\+?\d{6,}$/.test(compact)) return null;
  if (cleaned === jid || cleaned === phone) return null;
  return cleaned;
}

function mergeConversationAliases(items: ConversationRow[]): RankedConversationRow {
  const sorted = [...items].sort(compareConversationsByLastRealActivity);
  const preferred = items.find((c) => c.remote_jid.endsWith("@lid")) ?? sorted[0];
  const newest = sorted[0];
  const phone = items
    .map((c) => cleanAliasPhone(c.contact_phone, preferred.remote_jid))
    .find(Boolean) ?? null;
  const name =
    items
      .map((c) => usefulContactName(c.contact_name, phone, c.remote_jid))
      .find(Boolean) ?? null;
  return {
    ...preferred,
    contact_name: name,
    contact_phone: phone,
    profile_pic_url: items.map((c) => c.profile_pic_url).find(Boolean) ?? null,
    last_message_text: newest.last_message_text,
    last_message_at: newest.last_message_at,
    last_direction: newest.last_direction,
    unread_count: items.reduce((sum, c) => sum + (c.unread_count || 0), 0),
    ai_enabled: items.some((c) => c.ai_enabled),
    _sort_at: (newest as RankedConversationRow)._sort_at ?? newest.last_message_at,
    _has_stored_message: (newest as RankedConversationRow)._has_stored_message ?? hasConversationPreview(newest),
  };
}

function safeTimeMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const time = new Date(iso).getTime();
  return Number.isFinite(time) ? time : 0;
}

function hasConversationPreview(conv: ConversationRow): boolean {
  return Boolean(conv.last_message_text?.trim());
}

function conversationSortMs(conv: ConversationRow): number {
  const ranked = conv as RankedConversationRow;
  // أولوية 1: أحدث رسالة فعلية محفوظة (من wa_messages)
  if (ranked._sort_at) return safeTimeMs(ranked._sort_at);
  // أولوية 2: محادثة لها نشاط حقيقي (معاينة نصية أو رسائل غير مقروءة)
  // حتى لو لم تُجلب رسائلها ضمن نافذة الـ 5000. نعتمد على last_message_at من DB.
  const hasRealActivity = hasConversationPreview(conv) || (conv.unread_count || 0) > 0;
  if (hasRealActivity) return safeTimeMs(conv.last_message_at);
  // أولوية 3 (الأدنى): كتالوج فارغ من إعادة الاقتران — يُدفع للأسفل.
  return 0;
}

function compareConversationsByLastRealActivity(a: ConversationRow, b: ConversationRow): number {
  const byActivity = conversationSortMs(b) - conversationSortMs(a);
  if (byActivity !== 0) return byActivity;
  return (a.contact_name || a.contact_phone || a.remote_jid).localeCompare(b.contact_name || b.contact_phone || b.remote_jid);
}

function messageRowIso(msg: {
  wa_timestamp?: string | null;
  created_at?: string | null;
}): string | null {
  return msg.wa_timestamp ?? msg.created_at ?? null;
}

function messageRowTimeMs(msg: {
  wa_timestamp?: string | null;
  created_at?: string | null;
}): number {
  // WhatsApp mobile orders chats by the message's own timestamp, not by when
  // our database received/imported it. `created_at` is only a fallback for
  // local/outgoing rows that genuinely arrived without a WhatsApp timestamp.
  return safeTimeMs(msg.wa_timestamp) || safeTimeMs(msg.created_at);
}

function phoneFromRaw(raw: unknown): string | null {
  const obj = asRecord(raw);
  return digits(pickString(obj, "normalizedContactPhone", "senderPn", "participantPn", "phoneNumber", "phone"));
}

function phoneFromMessageRow(jid: string, fromPhone: string | null | undefined, toPhone: string | null | undefined): string | null {
  return cleanAliasPhone(fromPhone, jid) ?? cleanAliasPhone(toPhone, jid);
}

function contactNameFromRaw(raw: unknown): string | null {
  const obj = asRecord(raw);
  return pickString(obj, "contactName", "pushName", "senderName", "notifyName", "name", "verifiedName", "subject");
}

function profilePicFromRaw(raw: unknown): string | null {
  const obj = asRecord(raw);
  return pickString(obj, "profilePicUrl", "groupProfilePicUrl", "avatarUrl", "picture", "photoUrl");
}

const MEDIA_TYPE_ALIASES: Record<string, string> = {
  image: "image",
  video: "video",
  audio: "audio",
  voice: "audio",
  ptt: "audio",
  document: "document",
  file: "document",
  doc: "document",
  sticker: "sticker",
  text: "text",
};

function mediaDataFromRaw(raw: unknown): Record<string, unknown> {
  const obj = asRecord(raw);
  const nested = asRecord(obj.message);
  const typedMessage = Object.keys(nested)
    .map((key) => asRecord(nested[key]))
    .find((value) => Object.keys(value).length > 0);
  return [
    asRecord(obj.mediaData),
    asRecord(obj.media),
    asRecord(obj.attachment),
    asRecord(obj.image),
    asRecord(obj.video),
    asRecord(obj.audio),
    asRecord(obj.document),
    asRecord(obj.sticker),
    typedMessage ?? {},
    obj,
  ].find((value) => Object.keys(value).some((key) => ["dataUrl", "base64", "fileData", "data", "url", "fileUrl", "downloadUrl", "mediaUrl", "directPath"].includes(key))) ?? {};
}

function normalizeWaMessageType(value: string | null | undefined): string {
  const key = String(value ?? "").trim().toLowerCase();
  return MEDIA_TYPE_ALIASES[key] ?? (key || "text");
}

function mediaTypeFromRaw(raw: unknown, fallback?: string | null): string {
  const obj = asRecord(raw);
  const nested = asRecord(obj.message);
  const nestedKey = Object.keys(nested).find((key) => key.endsWith("Message"));
  const nestedType = nestedKey ? nestedKey.replace(/Message$/, "") : null;
  return normalizeWaMessageType(pickString(obj, "type", "messageType", "mediaType") ?? nestedType ?? fallback ?? "text");
}

function fallbackMimeType(msgType: string): string {
  if (msgType === "image") return "image/jpeg";
  if (msgType === "video") return "video/mp4";
  if (msgType === "audio") return "audio/ogg";
  if (msgType === "sticker") return "image/webp";
  if (msgType === "document") return "application/octet-stream";
  return "application/octet-stream";
}

function mediaUrlFromRaw(raw: unknown, fallbackType?: string | null): string | null {
  const obj = asRecord(raw);
  const media = mediaDataFromRaw(raw);
  const directUrl =
    pickString(media, "dataUrl", "url", "fileUrl", "downloadUrl", "mediaUrl", "directPath") ??
    pickString(obj, "mediaUrl", "fileUrl", "downloadUrl", "url", "directPath");
  if (directUrl?.startsWith("data:")) return directUrl;
  if (directUrl && /^(https?:)?\/\//i.test(directUrl)) return directUrl;

  const base64 = pickString(media, "base64", "fileData", "data");
  if (!base64) return null;
  const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  return `data:${pickString(media, "mimeType", "mimetype", "fileMimeType", "contentType") ?? fallbackMimeType(mediaTypeFromRaw(raw, fallbackType))};base64,${cleanBase64}`;
}

function waStoragePathFromUrl(url: string | null | undefined): string | null {
  const value = url?.trim() ?? "";
  if (!value) return null;
  if (value.startsWith("wa-media:")) return value.slice("wa-media:".length).replace(/^\/+/, "");
  if (value.startsWith("storage://wa-media/")) return value.slice("storage://wa-media/".length).replace(/^\/+/, "");
  return null;
}

function preferInboxMediaUrl(storedUrl: string | null, rawUrl: string | null): string | null {
  if (waStoragePathFromUrl(storedUrl)) return storedUrl;
  if (rawUrl?.startsWith("data:") || waStoragePathFromUrl(rawUrl)) return rawUrl;
  if (storedUrl && /^(https?:)?\/\//i.test(storedUrl)) return storedUrl;
  return rawUrl ?? storedUrl;
}

async function resolveInboxMediaUrl(url: string | null): Promise<string | null> {
  const storagePath = waStoragePathFromUrl(url);
  if (!storagePath) return url;
  const { data, error } = await supabase.storage.from("wa-media").createSignedUrl(storagePath, 60 * 60);
  if (error) {
    console.warn("[inbox] failed to sign WhatsApp media", error.message);
    return null;
  }
  return data.signedUrl;
}

function looksLikeInternalMediaPath(value: string | null | undefined): boolean {
  const text = value?.trim() ?? "";
  return Boolean(text) && /^(bridge|media|uploads?|files?)\//i.test(text);
}

function fileLabel(raw: unknown): string | null {
  const fileName = pickString(mediaDataFromRaw(raw), "fileName", "filename", "name");
  if (!fileName) return null;
  const parts = fileName.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? fileName;
}

function cleanMessageText(text: string | null | undefined, raw: unknown, msgType: string): string | null {
  const media = mediaDataFromRaw(raw);
  const caption = pickString(media, "caption") ?? pickString(asRecord(raw), "caption");
  if (caption && !looksLikeInternalMediaPath(caption)) return caption;
  const trimmed = text?.trim() ?? "";
  if (trimmed && !looksLikeInternalMediaPath(trimmed)) return trimmed;
  return normalizeWaMessageType(msgType) === "document" ? fileLabel(raw) : null;
}

function previewTextFromRaw(raw: unknown, currentText: string | null | undefined, fallbackType?: string | null): string | null {
  const msgType = mediaTypeFromRaw(raw, fallbackType);
  const cleaned = cleanMessageText(currentText, raw, msgType);
  if (cleaned) return cleaned;
  if (msgType === "image") return "[image]";
  if (msgType === "video") return "[video]";
  if (msgType === "audio") return "[audio]";
  if (msgType === "document") return "[file]";
  if (msgType === "sticker") return "[sticker]";
  return currentText?.trim() || null;
}

function previewTextFromStoredFields(currentText: string | null | undefined, fallbackType?: string | null, mediaUrl?: string | null): string | null {
  const text = currentText?.trim();
  if (text && !looksLikeInternalMediaPath(text)) return text;
  const msgType = normalizeWaMessageType(fallbackType || (mediaUrl ? "media" : "text"));
  if (msgType === "image") return "[image]";
  if (msgType === "video") return "[video]";
  if (msgType === "audio") return "[audio]";
  if (msgType === "document") return "[file]";
  if (msgType === "sticker") return "[sticker]";
  return null;
}

function initials(s: string): string {
  const cleaned = s.replace(/@.*/, "").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return cleaned.slice(0, 2).toUpperCase();
}

function detectMedia(
  msg: string | null | undefined,
  labels: { photo: string; voice: string; doc: string; video: string },
): { icon: React.ReactElement; label: string } | null {
  if (!msg) return null;
  if (/\[image(?::|\])/i.test(msg) || /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(msg))
    return { icon: <Camera className="h-3 w-3" />, label: labels.photo };
  if (/\[audio(?::|\])/i.test(msg) || /\.(mp3|wav|ogg|m4a)(\?|$)/i.test(msg))
    return { icon: <Mic className="h-3 w-3" />, label: labels.voice };
  if (/\[video(?::|\])/i.test(msg) || /\.(mp4|webm|mov)(\?|$)/i.test(msg))
    return { icon: <VideoIcon className="h-3 w-3" />, label: labels.video };
  if (/\[(file|document)(?::|\])/i.test(msg) || /\.(pdf|docx?|xlsx?|pptx?|zip)(\?|$)/i.test(msg))
    return { icon: <FileText className="h-3 w-3" />, label: labels.doc };
  return null;
}

function formatTime(iso: string, isAr: boolean): string {
  return new Date(iso).toLocaleTimeString(isAr ? "ar-EG" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelative(iso: string, isAr: boolean): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return formatTime(iso, isAr);
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return isAr ? "أمس" : "Yest";
  return d.toLocaleDateString(isAr ? "ar-EG" : "en-US", { month: "short", day: "numeric" });
}

function formatAgo(iso: string, isAr: boolean): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.max(1, Math.floor(diffMs / 1000));
  if (sec < 60) return isAr ? "الآن" : "now";
  const min = Math.floor(sec / 60);
  if (min < 60) return isAr ? `قبل ${min} د` : `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return isAr ? `قبل ${hr} س` : `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return isAr ? `قبل ${day} ي` : `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return isAr ? `قبل ${wk} أ` : `${wk}w ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return isAr ? `قبل ${mo} ش` : `${mo}mo ago`;
  const yr = Math.floor(day / 365);
  return isAr ? `قبل ${yr} سنة` : `${yr}y ago`;
}


function dayKey(iso: string): string {
  return new Date(iso).toDateString();
}

function dayLabel(iso: string, isAr: boolean, t: { today: string; yesterday: string }): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return t.today;
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return t.yesterday;
  return d.toLocaleDateString(isAr ? "ar-EG" : "en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function renderMessagesWithDays(
  messages: ChatMessageRow[],
  isAr: boolean,
  t: { today: string; yesterday: string },
): React.ReactElement[] {
  const out: React.ReactElement[] = [];
  let lastDay = "";
  const isGroup = messages[0]?.remote_jid.endsWith("@g.us") ?? false;
  for (const m of messages) {
    const dk = dayKey(m.created_at);
    if (dk !== lastDay) {
      lastDay = dk;
      out.push(
        <div key={`day-${dk}-${m.id}`} className="my-4 flex justify-center">
          <span className="rounded-full border border-border/50 bg-card/90 px-3 py-1 text-[10px] font-semibold tracking-wide text-muted-foreground shadow-sm backdrop-blur">
            {dayLabel(m.created_at, isAr, t)}
          </span>
        </div>,
      );
    }
    out.push(<ChatBubble key={m.id} m={m} isAr={isAr} isGroup={isGroup} />);
  }
  return out;
}

function missingMediaLabel(msgType: string, isAr: boolean): string {
  if (msgType === "image") return isAr ? "صورة — لم يصل ملفها من خادم الاتصال" : "Image — file not received from connection server";
  if (msgType === "video") return isAr ? "فيديو — لم يصل ملفه من خادم الاتصال" : "Video — file not received from connection server";
  if (msgType === "audio") return isAr ? "مقطع صوتي — لم يصل ملفه من خادم الاتصال" : "Audio — file not received from connection server";
  if (msgType === "document") return isAr ? "مستند — لم يصل ملفه من خادم الاتصال" : "Document — file not received from connection server";
  if (msgType === "sticker") return isAr ? "ملصق — لم يصل ملفه من خادم الاتصال" : "Sticker — file not received from connection server";
  return isAr ? "وسائط — لم يصل ملفها من خادم الاتصال" : "Media — file not received from connection server";
}

const IMAGE_EXTS = new Set(["jpg","jpeg","png","gif","webp","bmp","heic","heif","svg"]);
const VIDEO_EXTS = new Set(["mp4","mov","m4v","webm","mkv","avi","3gp"]);
const AUDIO_EXTS = new Set(["mp3","ogg","opus","wav","m4a","aac","flac","oga"]);

function extFromUrlOrName(url?: string | null, name?: string | null): string {
  const source = (name || "").trim() || (() => {
    try {
      const u = new URL(url || "", "http://x/");
      return decodeURIComponent(u.pathname.split("/").pop() || "");
    } catch { return url || ""; }
  })();
  const clean = source.split("?")[0].split("#")[0];
  const dot = clean.lastIndexOf(".");
  if (dot < 0 || dot === clean.length - 1) return "";
  return clean.slice(dot + 1).toLowerCase();
}

function kindFromExt(ext: string): "image" | "video" | "audio" | "document" | null {
  if (!ext) return null;
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  return "document";
}

function prettyFileName(raw?: string | null, url?: string | null): string {
  let name = (raw || "").trim();
  if (!name && url) {
    try {
      const u = new URL(url, "http://x/");
      name = decodeURIComponent(u.pathname.split("/").pop() || "");
    } catch { name = url; }
  }
  if (!name) return "ملف";
  name = name.split("?")[0].split("#")[0];
  // Strip long hash/uuid prefixes like "7826ad3f881fc98cbafdba1d18f38349_1783108880_"
  // or "3D9424AF-FF95-4970-9689-B46CB1060187"
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  const looksHash = /^[a-f0-9_\-]{16,}$/i.test(base);
  if (looksHash) return `ملف${ext}`;
  // Trim overly long basenames
  if (base.length > 32) return `${base.slice(0, 24)}…${ext}`;
  return `${base}${ext}`;
}



function ChatBubble({ m, isAr, isGroup }: { m: ChatMessageRow; isAr: boolean; isGroup: boolean }) {
  const isOut = m.direction === "out";
  const senderLabel = m.sender_name || (m.sender_phone ? `+${m.sender_phone}` : (isAr ? "عضو غير معروف" : "Unknown member"));
  const showSender = isGroup && !isOut;
  // Stable per-sender hue: prefer phone (persists across sessions/reloads),
  // fall back to name only when phone is unknown.
  const senderHue = ((): number => {
    const key = (m.sender_phone && m.sender_phone.trim()) || (m.sender_name && m.sender_name.trim()) || "?";
    // FNV-1a 32-bit hash for stable, well-distributed hues
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0) % 360;
  })();
  const senderColor = `hsl(${senderHue} 70% 38%)`;
  const senderInitial = (m.sender_name || m.sender_phone || "?").trim().charAt(0).toUpperCase();
  const isPending = isOut && m.status === "pending";
  const isFailed = isOut && m.status === "failed";
  const isStalePending = isPending && m.is_stale_pending;

  // Promote msg_type from URL/filename extension when the raw msg_type is
  // wrong or generic (e.g. .mp4 saved as "document").
  const rawFileName = m.msg_type === "document" ? (m.text_body || null) : null;
  const ext = extFromUrlOrName(m.media_url, rawFileName);
  const extKind = kindFromExt(ext);
  const effectiveType: string = m.media_url
    ? (m.msg_type === "document" && extKind && extKind !== "document" ? extKind : m.msg_type)
    : m.msg_type;
  const displayName = prettyFileName(rawFileName, m.media_url);
  const extBadge = ext ? ext.toUpperCase() : (isAr ? "ملف" : "FILE");
  const hasCaption = Boolean(m.text_body && effectiveType !== "document");

  return (
    <div dir="ltr" className={`flex items-end gap-1.5 px-1 ${isOut ? "justify-end" : "justify-start"}`}>
      {showSender && (
        <div
          className="mb-0.5 hidden h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ring-1 ring-black/5 sm:flex"
          style={{ backgroundColor: senderColor }}
          title={senderLabel}
        >
          {senderInitial}
        </div>
      )}
      <div
        dir={isAr ? "rtl" : "ltr"}
        className={`group min-w-0 max-w-[86%] overflow-hidden rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-[0_1px_2px_rgba(0,0,0,0.06),0_1px_1px_rgba(0,0,0,0.04)] ring-1 sm:max-w-[70%] ${
          isFailed
            ? "bg-destructive/10 text-foreground ring-destructive/30"
            : isPending
              ? "bg-primary/10 text-foreground ring-primary/25"
              : isOut
                ? "bg-gradient-to-br from-primary to-[oklch(0.55_0.28_295)] text-primary-foreground ring-primary/20"
                : "bg-card text-foreground ring-border/60"
        }`}
      >

        {showSender && (
          <p
            className="mb-1 text-[12px] font-bold"
            style={{ color: senderColor }}
          >
            {senderLabel}
          </p>
        )}
        {m.media_url && effectiveType === "image" && (
          <button
            type="button"
            onClick={() => openMedia({ url: m.media_url!, type: "image" })}
            className="mb-1.5 block overflow-hidden rounded-lg transition hover:opacity-90"
          >
            <img src={m.media_url} alt="" className="max-h-72 w-full object-cover" loading="lazy" />
          </button>
        )}
        {m.media_url && effectiveType === "video" && (
          <div className="mb-1.5 w-full min-w-[240px]">
            <video
              src={m.media_url}
              controls
              preload="metadata"
              className="max-h-72 w-full rounded-lg bg-black"
            />
          </div>
        )}
        {m.media_url && effectiveType === "audio" && (
          <div dir="ltr" className="mb-1.5 flex flex-col gap-1">
            <SmartAudio src={m.media_url} className="w-full min-w-[240px]" />
            <a
              href={m.media_url}
              target="_blank"
              rel="noreferrer"
              download
              className={`text-[10px] underline ${isOut ? "text-white/80" : "text-muted-foreground"}`}
            >
              {isAr ? "تنزيل المقطع الصوتي" : "Download audio"}
            </a>
          </div>
        )}
        {m.media_url && effectiveType === "document" && (
          <div
            className={`mb-1.5 flex w-full min-w-[240px] items-center gap-3 rounded-xl px-3 py-2.5 ${isOut ? "bg-white/15" : "bg-muted"}`}
          >
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${isOut ? "bg-white/25 text-white" : "bg-primary/15 text-primary"}`}>
              <FileText className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1 text-start">
              <p className={`truncate text-[13px] font-medium leading-tight ${isOut ? "text-white" : "text-foreground"}`}>
                {displayName}
              </p>
              <p className={`mt-0.5 text-[10px] font-semibold uppercase tracking-wide ${isOut ? "text-white/70" : "text-muted-foreground"}`}>
                {extBadge}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                aria-label={isAr ? "فتح" : "Open"}
                onClick={() => openMedia({ url: m.media_url!, type: "document", name: displayName })}
                className={`flex h-8 w-8 items-center justify-center rounded-full transition ${isOut ? "bg-white/20 text-white hover:bg-white/30" : "bg-background text-foreground hover:bg-background/70"}`}
              >
                <ExternalLink className="h-4 w-4" />
              </button>
              <a
                href={m.media_url}
                target="_blank"
                rel="noreferrer"
                download={displayName}
                aria-label={isAr ? "تنزيل" : "Download"}
                className={`flex h-8 w-8 items-center justify-center rounded-full transition ${isOut ? "bg-white/20 text-white hover:bg-white/30" : "bg-background text-foreground hover:bg-background/70"}`}
              >
                <Download className="h-4 w-4" />
              </a>
            </div>
          </div>
        )}
        {m.media_url && effectiveType === "sticker" && (
          <button
            type="button"
            onClick={() => openMedia({ url: m.media_url!, type: "sticker" })}
            className="mb-1.5 block"
          >
            <img src={m.media_url} alt="sticker" className="max-h-32" />
          </button>
        )}
        {hasCaption ? (
          <p className="max-w-full whitespace-pre-wrap break-words text-start leading-relaxed [overflow-wrap:anywhere]">{m.text_body}</p>
        ) : !m.media_url && m.msg_type !== "text" ? (
          <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs ${isOut ? "bg-white/15 text-primary-foreground/90" : "bg-muted text-muted-foreground"}`}>
            {m.msg_type === "image" ? <ImageIcon className="h-4 w-4 shrink-0" /> : null}
            {m.msg_type === "video" ? <VideoIcon className="h-4 w-4 shrink-0" /> : null}
            {m.msg_type === "audio" ? <Mic className="h-4 w-4 shrink-0" /> : null}
            {m.msg_type === "document" ? <FileText className="h-4 w-4 shrink-0" /> : null}
            {!['image', 'video', 'audio', 'document'].includes(m.msg_type) ? <Paperclip className="h-4 w-4 shrink-0" /> : null}
            <span className="text-start">{missingMediaLabel(m.msg_type, isAr)}</span>
          </div>
        ) : null}

        {(isPending || isFailed) && (
          <p className={`mt-1 text-[10px] font-semibold ${isFailed ? "text-destructive" : "text-muted-foreground"}`}>
            {isFailed
              ? isAr
                ? "فشل التسليم بعد إعادة المحاولة"
                : "Delivery failed after retries"
              : isStalePending
                ? isAr
                  ? `معلّقة في طابور الإرسال ولم يتم تأكيد وصولها للواتساب${m.queued_id ? ` — ${m.queued_id}` : ""}`
                  : `Stuck in the sending queue, not confirmed by WhatsApp${m.queued_id ? ` — ${m.queued_id}` : ""}`
              : isAr
                ? "جارٍ تأكيد التسليم…"
                : "Confirming delivery…"}
          </p>
        )}
        <div
          className={`mt-1.5 flex items-center gap-1 text-[10px] font-medium tabular-nums ${
            isOut && !isPending && !isFailed ? "justify-end text-primary-foreground/85" : "justify-end text-muted-foreground/90"
          }`}
          dir="ltr"
        >
          {m.is_ai && <Bot className="h-3 w-3" />}
          <span>{formatTime(m.created_at, isAr)}</span>
          <span className="opacity-70">·</span>
          <span className="opacity-80">{formatAgo(m.created_at, isAr)}</span>

          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : isFailed ? (
            <X className="h-3.5 w-3.5 text-destructive" />
          ) : isOut && (
            <CheckCheck className={`h-3.5 w-3.5 ${m.status === "read" ? "text-emerald-200" : "opacity-90"}`} />
          )}
        </div>
      </div>
    </div>
  );
}

const EMOJI_GROUPS: { label: { ar: string; en: string }; emojis: string[] }[] = [
  {
    label: { ar: "الوجوه", en: "Smileys" },
    emojis: ["😀","😃","😄","😁","😆","😅","🤣","😂","🙂","🙃","😉","😊","😇","🥰","😍","🤩","😘","😗","😚","😙","😋","😛","😜","🤪","😝","🤑","🤗","🤭","🤫","🤔","🤐","🤨","😐","😑","😶","😏","😒","🙄","😬","🤥","😌","😔","😪","🤤","😴","😷","🤒","🤕","🤢","🤮","🥵","🥶","🥴","😵","🤯","🤠","🥳","😎","🤓","🧐","😕","😟","🙁","☹️","😮","😯","😲","😳","🥺","😦","😧","😨","😰","😥","😢","😭","😱","😖","😣","😞","😓","😩","😫","🥱","😤","😡","😠","🤬"],
  },
  {
    label: { ar: "إيماءات", en: "Gestures" },
    emojis: ["👍","👎","👌","✌️","🤞","🤟","🤘","🤙","👈","👉","👆","👇","☝️","✋","🤚","🖐️","🖖","👋","🤝","🙏","👏","🙌","👐","🤲","🤦","🤷","💪","🦾","👶","🧑","👨","👩","🧔","👴","👵"],
  },
  {
    label: { ar: "قلوب", en: "Hearts" },
    emojis: ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖","💘","💝","💟","♥️","💌"],
  },
  {
    label: { ar: "أشياء", en: "Objects" },
    emojis: ["🔥","✨","🎉","🎊","🎁","🎈","🏆","🥇","🥈","🥉","⚽","🏀","🎮","🎵","🎶","📱","💻","⌨️","🖥️","📷","📸","💡","🔔","🔕","📌","📍","✅","❌","⭐","🌟","💯","💢","💥","💫","💦","💨","🕐","☀️","🌙","☁️","🌈","☔"],
  },
];

function EmojiPicker({ onPick, isAr }: { onPick: (emoji: string) => void; isAr: boolean }) {
  return (
    <div className="max-h-72 overflow-y-auto" dir={isAr ? "rtl" : "ltr"}>
      {EMOJI_GROUPS.map((group) => (
        <div key={group.label.en} className="mb-2 last:mb-0">
          <div className="mb-1 px-1 text-[11px] font-semibold text-muted-foreground">
            {isAr ? group.label.ar : group.label.en}
          </div>
          <div className="grid grid-cols-8 gap-0.5">
            {group.emojis.map((e, i) => (
              <button
                key={`${group.label.en}-${i}`}
                type="button"
                onClick={() => onPick(e)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-xl transition hover:bg-muted"
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
