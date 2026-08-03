import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { waContactsRepository } from "@/lib/wa-contacts";
import type { ContactFilters, WaContactListMemberContact } from "@/types/wa-contacts.types";
import { useAuth } from "@/lib/authProvider";

const KEY = "wa-contacts";
const SMART_KEY = "wa-smart-lists";
const LIST_KEY = "wa-contact-lists";
const LIST_MEMBERS_KEY = "wa-contact-list-members";

export function useWaContacts(filters?: ContactFilters) {
  const { session: authSession } = useAuth();
  const ws = authSession?.user?.id;
  return useQuery({
    queryKey: [KEY, ws, filters],
    queryFn: () => ws ? waContactsRepository.list(ws, filters) : Promise.resolve([]),
    enabled: !!ws,
  });
}

export function useWaContactMutations() {
  const qc = useQueryClient();
  const inv = () => qc.invalidateQueries({ queryKey: [KEY] });
  const update = useMutation({ mutationFn: ({ id, data }: { id: string; data: any }) => waContactsRepository.update(id, data), onSuccess: inv });
  const bulkTag = useMutation({ mutationFn: ({ ids, tags }: { ids: string[]; tags: string[] }) => waContactsRepository.bulkTag(ids, tags), onSuccess: inv });
  const bulkAssign = useMutation({ mutationFn: ({ ids, userId }: { ids: string[]; userId: string | null }) => waContactsRepository.bulkAssign(ids, userId), onSuccess: inv });
  const merge = useMutation({ mutationFn: ({ sourceId, targetId }: { sourceId: string; targetId: string }) => waContactsRepository.merge(sourceId, targetId), onSuccess: inv });
  const block = useMutation({ mutationFn: ({ id, userId, reason }: { id: string; userId: string; reason?: string }) => waContactsRepository.block(id, userId, reason), onSuccess: inv });
  const remove = useMutation({ mutationFn: (id: string) => waContactsRepository.delete(id), onSuccess: inv });
  const importMany = useMutation({ mutationFn: ({ ws, rows }: { ws: string; rows: any[] }) => waContactsRepository.importMany(ws, rows), onSuccess: inv });
  return { update, bulkTag, bulkAssign, merge, block, remove, importMany };
}

export function useWaSmartLists() {
  const { session: authSession } = useAuth();
  const ws = authSession?.user?.id;
  return useQuery({ queryKey: [SMART_KEY, ws], queryFn: () => ws ? waContactsRepository.listSmartLists(ws) : Promise.resolve([]), enabled: !!ws });
}

// --- Contact Lists ---
export function useWaContactLists() {
  const { session: authSession } = useAuth();
  const ws = authSession?.user?.id;
  return useQuery({
    queryKey: [LIST_KEY, ws],
    queryFn: () => ws ? waContactsRepository.listContactLists(ws) : Promise.resolve([]),
    enabled: !!ws,
  });
}

export function useWaContactListMembers(listId: string | null) {
  return useQuery({
    queryKey: [LIST_MEMBERS_KEY, listId],
    queryFn: () => listId ? waContactsRepository.getContactListMembers(listId) : Promise.resolve([] as WaContactListMemberContact[]),
    enabled: !!listId,
  });
}

export function useWaContactListMutations() {
  const qc = useQueryClient();
  const invLists = () => qc.invalidateQueries({ queryKey: [LIST_KEY] });
  const invMembers = (listId?: string) => qc.invalidateQueries({ queryKey: listId ? [LIST_MEMBERS_KEY, listId] : [LIST_MEMBERS_KEY] });
  const invContacts = () => qc.invalidateQueries({ queryKey: [KEY] });

  const create = useMutation({
    mutationFn: (input: { workspaceId: string; name: string; description?: string; color?: string; createdBy?: string }) =>
      waContactsRepository.createContactList(input),
    onSuccess: invLists,
  });
  const rename = useMutation({
    mutationFn: ({ listId, name }: { listId: string; name: string }) => waContactsRepository.renameContactList(listId, name),
    onSuccess: invLists,
  });
  const remove = useMutation({
    mutationFn: (listId: string) => waContactsRepository.deleteContactList(listId),
    onSuccess: invLists,
  });
  const addOne = useMutation({
    mutationFn: ({ listId, contactId }: { listId: string; contactId: string }) => waContactsRepository.addContactToList(listId, contactId),
    onSuccess: (_d, vars) => invMembers(vars.listId),
  });
  const removeOne = useMutation({
    mutationFn: ({ listId, contactId }: { listId: string; contactId: string }) => waContactsRepository.removeContactFromList(listId, contactId),
    onSuccess: (_d, vars) => invMembers(vars.listId),
  });
  const addMany = useMutation({
    mutationFn: ({ listId, contactIds }: { listId: string; contactIds: string[] }) => waContactsRepository.addContactsToList(listId, contactIds),
    onSuccess: (_d, vars) => invMembers(vars.listId),
  });
  const importCsv = useMutation({
    mutationFn: (input: { workspaceId: string; listId: string; rows: any[] }) => waContactsRepository.importContactsToList(input),
    onSuccess: (_d, vars) => { invMembers(vars.listId); invContacts(); },
  });

  return { create, rename, remove, addOne, removeOne, addMany, importCsv };
}
