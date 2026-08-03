import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { waInboxRepository } from "@/lib/wa-inbox";
import { useAuth } from "@/lib/authProvider";

const CONVS_KEY = "wa-conversations";
const MSGS_KEY = "wa-messages";

export function useWaConversations(filters?: Parameters<typeof waInboxRepository.listConversations>[1]) {
  const { session: authSession } = useAuth();
  const ws = authSession?.user?.id;
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: [CONVS_KEY, ws, filters],
    queryFn: () => ws ? waInboxRepository.listConversations(ws, filters) : Promise.resolve([]),
    enabled: !!ws,
  });

  useEffect(() => {
    if (!ws) return;
    const ch = supabase.channel(`wa-conv-${ws}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "wa_conversations", filter: `user_id=eq.${ws}` },
        () => qc.invalidateQueries({ queryKey: [CONVS_KEY] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [ws, qc]);

  return q;
}

export function useWaMessages(conversationId: string | undefined) {
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: [MSGS_KEY, conversationId],
    queryFn: () => waInboxRepository.getMessages(conversationId!),
    enabled: !!conversationId,
  });

  useEffect(() => {
    if (!conversationId) return;
    const ch = supabase.channel(`wa-msg-${conversationId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "wa_messages", filter: `conversation_id=eq.${conversationId}` },
        () => qc.invalidateQueries({ queryKey: [MSGS_KEY, conversationId] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [conversationId, qc]);

  return q;
}

export function useWaInboxMutations() {
  const qc = useQueryClient();
  const invConvs = () => qc.invalidateQueries({ queryKey: [CONVS_KEY] });
  const invMsgs = (id: string) => qc.invalidateQueries({ queryKey: [MSGS_KEY, id] });

  const send = useMutation({
    mutationFn: (i: Parameters<typeof waInboxRepository.sendMessage>[0]) => waInboxRepository.sendMessage(i),
    onSuccess: (_d, v) => { invMsgs(v.conversationId); invConvs(); },
  });
  const markRead = useMutation({ mutationFn: (id: string) => waInboxRepository.markRead(id), onSuccess: invConvs });
  const star = useMutation({ mutationFn: ({ id, v }: { id: string; v: boolean }) => waInboxRepository.star(id, v), onSuccess: invConvs });
  const archive = useMutation({ mutationFn: ({ id, v }: { id: string; v: boolean }) => waInboxRepository.archive(id, v), onSuccess: invConvs });
  const spam = useMutation({ mutationFn: ({ id, v }: { id: string; v: boolean }) => waInboxRepository.markSpam(id, v), onSuccess: invConvs });
  const assign = useMutation({ mutationFn: ({ id, userId }: { id: string; userId: string | null }) => waInboxRepository.assign(id, userId), onSuccess: invConvs });
  const setStatus = useMutation({ mutationFn: ({ id, status }: { id: string; status: string }) => waInboxRepository.setStatus(id, status), onSuccess: invConvs });
  const addNote = useMutation({ mutationFn: (i: { conversationId: string; workspaceId: string; userId: string; body: string }) => waInboxRepository.addNote(i.conversationId, i.workspaceId, i.userId, i.body), onSuccess: () => {} });

  return { send, markRead, star, archive, spam, assign, setStatus, addNote };
}
