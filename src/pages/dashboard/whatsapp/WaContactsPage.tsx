import { useState, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Search, Download, Upload, Star, ShieldOff, Trash2, Tag, UserCheck, GitMerge, X, Plus, ListChecks, MoreVertical, Pencil, FileUp, Users } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogHeader, DialogTitle, DialogClose, DialogBody } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/authProvider";
import { useWaContacts, useWaContactMutations, useWaContactLists, useWaContactListMembers, useWaContactListMutations } from "@/hooks/useWaContacts";
import { contactsToCSV, downloadCSV, parseCSV, downloadImportTemplate } from "@/lib/wa-csv";
import type { ContactFilters, WaContact, WaContactListMemberContact } from "@/types/wa-contacts.types";

type Tab = "all" | "new" | "active" | "inactive" | "smart";

const COLOR_OPTIONS = [
  { key: "primary", className: "bg-[var(--color-primary)]" },
  { key: "success", className: "bg-[var(--color-success)]" },
  { key: "warning", className: "bg-[var(--color-warning)]" },
  { key: "error", className: "bg-[var(--color-error)]" },
  { key: "info", className: "bg-sky-500" },
  { key: "violet", className: "bg-violet-500" },
  { key: "emerald", className: "bg-emerald-500" },
  { key: "amber", className: "bg-amber-500" },
];

export function WaContactsPage() {
  const { t } = useTranslation();
  const { session: authSession } = useAuth();
  const ws = authSession?.user?.id || "";
  const userId = authSession?.user?.id || "";

  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showImport, setShowImport] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [mergeSource, setMergeSource] = useState<string | null>(null);
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [showCreateList, setShowCreateList] = useState(false);
  const [showListMenu, setShowListMenu] = useState<string | null>(null);
  const [showRenameList, setShowRenameList] = useState<string | null>(null);
  const [showImportToList, setShowImportToList] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const filters: ContactFilters = { search, tab: tab === "smart" ? undefined : tab === "all" ? undefined : tab };
  const { data: contacts, isLoading } = useWaContacts(filters);
  const muts = useWaContactMutations();
  const { data: lists } = useWaContactLists();
  const { data: listMembers } = useWaContactListMembers(activeListId);
  const listMuts = useWaContactListMutations();

  const isInListMode = activeListId !== null;
  const displayedContacts = useMemo<WaContact[]>(() => {
    if (isInListMode) {
      return (listMembers ?? []).map((m: WaContactListMemberContact): WaContact => ({
        id: m.contact_id,
        name: m.name,
        push_name: m.push_name,
        phone: m.phone,
        email: m.email,
        is_vip: m.is_vip,
        tags: m.tags,
        workspace_id: ws,
        created_at: m.added_at,
        updated_at: m.added_at,
        status: "active",
      } as WaContact));
    }
    return contacts ?? [];
  }, [isInListMode, listMembers, contacts, ws]);

  const toggle = (id: string) => { const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id); setSelected(n); };
  const toggleAll = () => {
    if (selected.size === displayedContacts.length) setSelected(new Set());
    else setSelected(new Set(displayedContacts.map(c => c.id)));
  };

  const handleExport = () => {
    if (!displayedContacts.length) return;
    downloadCSV(`wa-contacts-${new Date().toISOString().slice(0, 10)}.csv`, contactsToCSV(displayedContacts));
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      const rows = parseCSV(r.result as string);
      if (!rows.length) { toast({ type: "error", title: t("wa.contacts.import.empty") }); return; }
      muts.importMany.mutate({ ws, rows }, { onSuccess: (d) => { setShowImport(false); toast({ type: "success", title: t("wa.contacts.import.success", { inserted: d.inserted, skipped: d.skipped }) }); } });
    };
    r.readAsText(f);
  };

  const handleImportToList = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f || !activeListId) return;
    const r = new FileReader();
    r.onload = () => {
      const rows = parseCSV(r.result as string);
      if (!rows.length) { toast({ type: "error", title: t("wa.contacts.import.empty") }); return; }
      listMuts.importCsv.mutate({ workspaceId: ws, listId: activeListId, rows }, { onSuccess: (d) => { setShowImportToList(false); toast({ type: "success", title: t("wa.contacts.lists.imported", { inserted: d.inserted, skipped: d.skipped }) }); } });
    };
    r.readAsText(f);
  };

  const bulkDelete = () => {
    selected.forEach(id => muts.remove.mutate(id));
    setSelected(new Set());
    toast({ type: "success", title: t("wa.contacts.bulk.deleted") });
  };

  const activeList = lists?.find(l => l.id === activeListId);

  return (
    <div className="space-y-4">
      <PageHeader title={t("wa.contacts.title")} description={t("wa.contacts.subtitle")} />

      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        {/* Lists sidebar */}
        <Card className="self-start lg:sticky lg:top-20">
          <CardContent className="p-3 space-y-3">
            <div className="flex items-center gap-2">
              <ListChecks className="size-4 text-[var(--color-primary-soft)]" />
              <p className="text-sm font-semibold text-[var(--color-fg)] flex-1">{t("wa.contacts.lists.title")}</p>
              <Button size="icon" variant="ghost" className="size-7" onClick={() => setShowCreateList(true)} aria-label={t("wa.contacts.lists.create")}>
                <Plus className="size-4" />
              </Button>
            </div>

            <button
              onClick={() => { setActiveListId(null); setSelected(new Set()); }}
              className={cn(
                "w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-all",
                !isInListMode
                  ? "bg-[color-mix(in_oklab,var(--color-primary)_15%,transparent)] text-[var(--color-primary-soft)]"
                  : "text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]",
              )}
            >
              <Users className="size-4" />
              <span className="flex-1 text-start">{t("wa.contacts.lists.allContacts")}</span>
              <span className="text-xs text-[var(--color-fg-subtle)]">{contacts?.length ?? 0}</span>
            </button>

            <div className="space-y-0.5">
              {lists?.length === 0 && (
                <p className="text-xs text-[var(--color-fg-subtle)] px-2 py-3 text-center">
                  {t("wa.contacts.lists.empty")}
                </p>
              )}
              {lists?.map((l) => (
                <div
                  key={l.id}
                  className={cn(
                    "group relative flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-all",
                    activeListId === l.id
                      ? "bg-[color-mix(in_oklab,var(--color-primary)_15%,transparent)] text-[var(--color-primary-soft)]"
                      : "text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]",
                  )}
                >
                  <button
                    onClick={() => { setActiveListId(l.id); setSelected(new Set()); }}
                    className="flex items-center gap-2 flex-1 text-start"
                  >
                    <span className={cn("size-2.5 shrink-0 rounded-full", COLOR_OPTIONS.find(c => c.key === l.color)?.className ?? "bg-[var(--color-primary)]")} />
                    <span className="truncate flex-1">{l.name}</span>
                    <span className="text-xs text-[var(--color-fg-subtle)]">{l.member_count}</span>
                  </button>
                  <div className="relative">
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowListMenu(showListMenu === l.id ? null : l.id); }}
                      className="rounded p-1 opacity-0 group-hover:opacity-100 hover:bg-[var(--color-surface-2)]"
                      aria-label="More"
                    >
                      <MoreVertical className="size-3.5" />
                    </button>
                    {showListMenu === l.id && (
                      <>
                        <div className="fixed inset-0 z-20" onClick={() => setShowListMenu(null)} />
                        <div className="absolute end-0 top-full mt-1 z-30 w-40 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] shadow-[var(--shadow-lg)] py-1">
                          <button onClick={() => { setShowListMenu(null); setShowImportToList(true); }} className="w-full text-start px-3 py-2 text-sm hover:bg-[var(--color-surface-2)] flex items-center gap-2">
                            <FileUp className="size-3.5" /> {t("wa.contacts.lists.importCsv")}
                          </button>
                          <button onClick={() => { setShowListMenu(null); setShowRenameList(l.id); }} className="w-full text-start px-3 py-2 text-sm hover:bg-[var(--color-surface-2)] flex items-center gap-2">
                            <Pencil className="size-3.5" /> {t("wa.contacts.lists.rename")}
                          </button>
                          <button onClick={() => { setShowListMenu(null); if (confirm(t("wa.contacts.lists.deleteConfirm"))) listMuts.remove.mutate(l.id); }} className="w-full text-start px-3 py-2 text-sm hover:bg-[var(--color-surface-2)] text-[var(--color-error)] flex items-center gap-2">
                            <Trash2 className="size-3.5" /> {t("wa.contacts.lists.delete")}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Main panel */}
        <div className="space-y-4 min-w-0">
          {/* In-list header */}
          {isInListMode && activeList && (
            <div className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3">
              <span className={cn("size-3 rounded-full", COLOR_OPTIONS.find(c => c.key === activeList.color)?.className ?? "bg-[var(--color-primary)]")} />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-[var(--color-fg)] truncate">{activeList.name}</p>
                <p className="text-xs text-[var(--color-fg-muted)]">{t("wa.contacts.lists.memberCount", { count: activeList.member_count })}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setShowImportToList(true)}>
                <Upload className="size-4" /> {t("wa.contacts.lists.addContacts")}
              </Button>
            </div>
          )}

          {/* Tabs + Search + Actions */}
          <div className="flex flex-wrap items-center gap-2">
            {!isInListMode && (["all","new","active","inactive","smart"] as Tab[]).map(k => (
              <button key={k} onClick={() => setTab(k)} className={cn("px-3 py-1.5 text-sm rounded-lg transition-colors", tab === k ? "bg-[var(--color-primary)] text-white" : "bg-[var(--color-surface-2)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]")}>{t(`wa.contacts.tabs.${k}`)}</button>
            ))}
            <div className="flex-1" />
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[var(--color-fg-muted)]" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("wa.contacts.search")} className="pl-9 pr-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-sm w-48" />
            </div>
            <Button variant="outline" size="sm" onClick={handleExport}><Download className="size-4" /> {t("wa.contacts.actions.export")}</Button>
            {!isInListMode && (
              <Button variant="outline" size="sm" onClick={() => setShowImport(true)}><Upload className="size-4" /> {t("wa.contacts.actions.import")}</Button>
            )}
          </div>

          {/* Bulk bar */}
          {selected.size > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/20 flex-wrap">
              <span className="text-sm font-medium">{t("wa.contacts.bulk.title", { count: selected.size })}</span>
              {!isInListMode && (
                <>
                  <Button size="sm" variant="outline" onClick={() => {}} disabled><Tag className="size-3" /> {t("wa.contacts.bulk.tagSelected")}</Button>
                  <Button size="sm" variant="outline" onClick={() => {}} disabled><UserCheck className="size-3" /> {t("wa.contacts.bulk.assignSelected")}</Button>
                </>
              )}
              {isInListMode && (
                <Button size="sm" variant="outline" onClick={() => { selected.forEach(id => listMuts.removeOne.mutate({ listId: activeListId!, contactId: id })); setSelected(new Set()); }}>
                  <X className="size-3" /> {t("wa.contacts.lists.removeFromList")}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={bulkDelete}><Trash2 className="size-3" /> {t("wa.contacts.bulk.deleteSelected")}</Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}><X className="size-3" /></Button>
            </div>
          )}

          {/* Table */}
          <Card>
            <CardContent className="p-0 overflow-x-auto hidden md:block">
              <table className="w-full text-sm">
                <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-1)]">
                  <tr>
                    <th className="p-3 w-10"><input type="checkbox" checked={selected.size === displayedContacts.length && displayedContacts.length > 0} onChange={toggleAll} /></th>
                    <th className="p-3 text-start">{t("wa.contacts.fields.name")}</th>
                    <th className="p-3 text-start">{t("wa.contacts.fields.phone")}</th>
                    <th className="p-3 text-start hidden md:table-cell">{t("wa.contacts.fields.tags")}</th>
                    <th className="p-3 text-start hidden lg:table-cell">{t("wa.contacts.fields.lastSeen")}</th>
                    <th className="p-3 text-start hidden lg:table-cell">{t("wa.contacts.fields.messages")}</th>
                    <th className="p-3 w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={7} className="p-3"><div className="h-8 bg-[var(--color-surface-2)] rounded animate-pulse" /></td></tr>) :
                   displayedContacts.length === 0 ? (
                    <tr><td colSpan={7} className="p-8 text-center text-[var(--color-fg-muted)]">
                      {isInListMode ? t("wa.contacts.lists.emptyList") : t("wa.contacts.empty.title")}
                    </td></tr>
                  ) :
                   displayedContacts.map(c => (
                    <tr key={c.id} className={cn("border-b border-[var(--color-border)] hover:bg-[var(--color-surface-2)]", selected.has(c.id) && "bg-[var(--color-primary)]/5")}>
                      <td className="p-3"><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} /></td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className="size-8 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center text-xs font-bold text-[var(--color-primary)]">{c.push_name?.[0] || c.name?.[0] || "?"}</div>
                          <div>
                            <p className="font-medium">{c.push_name || c.name || "—"} {c.is_vip && <Star className="size-3 text-[var(--color-warning)] inline" />}</p>
                            <p className="text-xs text-[var(--color-fg-muted)]">{c.email || ""}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-3 text-[var(--color-fg-muted)]" dir="ltr">{c.phone}</td>
                      <td className="p-3 hidden md:table-cell"><div className="flex flex-wrap gap-1">{(c.tags ?? []).map((tg: string) => <Badge key={tg} variant="outline" className="text-[10px]">{tg}</Badge>)}</div></td>
                      <td className="p-3 text-[var(--color-fg-muted)] hidden lg:table-cell text-xs">{c.last_seen ? new Date(c.last_seen).toLocaleDateString() : "—"}</td>
                      <td className="p-3 hidden lg:table-cell">{c.total_messages || c.message_count || 0}</td>
                      <td className="p-3">
                        {isInListMode ? (
                          <Button size="icon" variant="ghost" className="size-7" onClick={() => listMuts.removeOne.mutate({ listId: activeListId!, contactId: c.id })} title={t("wa.contacts.lists.removeFromList")}><X className="size-3" /></Button>
                        ) : (
                          <div className="flex gap-1">
                            {mergeSource === c.id ? (
                              <Button size="sm" variant="ghost" onClick={() => setMergeSource(null)}><X className="size-3" /></Button>
                            ) : (
                              <>
                                <Button size="icon" variant="ghost" className="size-7" onClick={() => { setMergeSource(c.id); setShowMerge(true); }}><GitMerge className="size-3" /></Button>
                                <Button size="icon" variant="ghost" className="size-7" onClick={() => { if (confirm("Block?")) muts.block.mutate({ id: c.id, userId }); }}><ShieldOff className="size-3" /></Button>
                                <Button size="icon" variant="ghost" className="size-7" onClick={() => { if (confirm("Delete?")) muts.remove.mutate(c.id); }}><Trash2 className="size-3" /></Button>
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                  }
                </tbody>
              </table>
            </CardContent>
            <CardContent className="p-3 md:hidden space-y-2">
              {isLoading ? Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 bg-[var(--color-surface-2)] rounded animate-pulse" />) :
               displayedContacts.length === 0 ? (
                <p className="p-8 text-center text-[var(--color-fg-muted)]">
                  {isInListMode ? t("wa.contacts.lists.emptyList") : t("wa.contacts.empty.title")}
                </p>
              ) :
               displayedContacts.map(c => (
                <div key={c.id} className={cn("rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 space-y-2", selected.has(c.id) && "bg-[var(--color-primary)]/5 border-[var(--color-primary)]/30")}>
                  <div className="flex items-start gap-3">
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} className="mt-1.5 shrink-0" />
                    <div className="size-10 rounded-full bg-[var(--color-primary)]/10 flex items-center justify-center text-sm font-bold text-[var(--color-primary)] shrink-0">{c.push_name?.[0] || c.name?.[0] || "?"}</div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold truncate">{c.push_name || c.name || "—"} {c.is_vip && <Star className="size-3 text-[var(--color-warning)] inline" />}</p>
                      <p className="text-xs text-[var(--color-fg-muted)] truncate" dir="ltr">{c.phone}</p>
                      {c.email && <p className="text-xs text-[var(--color-fg-subtle)] truncate">{c.email}</p>}
                      {(c.tags ?? []).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">{(c.tags ?? []).map((tg: string) => <Badge key={tg} variant="outline" className="text-[10px]">{tg}</Badge>)}</div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      {isInListMode ? (
                        <Button size="icon" variant="ghost" className="size-7" onClick={() => listMuts.removeOne.mutate({ listId: activeListId!, contactId: c.id })} title={t("wa.contacts.lists.removeFromList")}><X className="size-3" /></Button>
                      ) : (
                        <>
                          <Button size="icon" variant="ghost" className="size-7" onClick={() => { setMergeSource(c.id); setShowMerge(true); }} title="Merge"><GitMerge className="size-3" /></Button>
                          <Button size="icon" variant="ghost" className="size-7" onClick={() => { if (confirm("Block?")) muts.block.mutate({ id: c.id, userId }); }} title="Block"><ShieldOff className="size-3" /></Button>
                          <Button size="icon" variant="ghost" className="size-7" onClick={() => { if (confirm("Delete?")) muts.remove.mutate(c.id); }} title="Delete"><Trash2 className="size-3" /></Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))
              }
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Import dialog */}
      <Dialog open={showImport} onClose={() => setShowImport(false)}>
        <DialogHeader><DialogTitle>{t("wa.contacts.import.title")}</DialogTitle><DialogClose onClose={() => setShowImport(false)} /></DialogHeader>
        <DialogBody>
          <div className="flex flex-col items-center gap-4 py-4">
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleImport} />
            <Upload className="size-10 text-[var(--color-fg-muted)]" />
            <p className="text-sm text-[var(--color-fg-muted)]">{t("wa.contacts.import.dropFile")}</p>
            <Button variant="outline" onClick={() => fileRef.current?.click()}>{t("wa.contacts.actions.import")}</Button>
            <Button variant="ghost" size="sm" onClick={downloadImportTemplate}>{t("wa.contacts.actions.downloadTemplate")}</Button>
          </div>
        </DialogBody>
      </Dialog>

      {/* Merge dialog */}
      <Dialog open={showMerge} onClose={() => { setShowMerge(false); setMergeSource(null); }}>
        <DialogHeader><DialogTitle>{t("wa.contacts.merge.title")}</DialogTitle><DialogClose onClose={() => { setShowMerge(false); setMergeSource(null); }} /></DialogHeader>
        <DialogBody>
          <p className="text-sm text-[var(--color-fg-muted)] mb-4">{t("wa.contacts.merge.pick")}</p>
          <div className="max-h-60 space-y-1 overflow-y-auto">
            {contacts?.filter(c => c.id !== mergeSource).map(c => (
              <button key={c.id} className="w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--color-surface-2)] text-sm" onClick={() => { if (mergeSource) muts.merge.mutate({ sourceId: mergeSource, targetId: c.id }, { onSuccess: () => { setShowMerge(false); setMergeSource(null); toast({ type: "success", title: t("wa.contacts.merge.confirm") }); } }); }}>
                {c.push_name || c.name || c.phone}
              </button>
            ))}
          </div>
        </DialogBody>
      </Dialog>

      {/* Create list dialog */}
      <CreateListDialog
        open={showCreateList}
        loading={listMuts.create.isPending}
        onClose={() => setShowCreateList(false)}
        onSubmit={(data) => {
          if (!ws) {
            toast({ type: "error", title: t("common.error"), description: "No workspace" });
            return;
          }
          listMuts.create.mutate(
            { workspaceId: ws, ...data, createdBy: userId },
            {
              onSuccess: (res) => {
                setShowCreateList(false);
                if (res?.id) setActiveListId(res.id);
                toast({ type: "success", title: t("wa.contacts.lists.created") });
              },
              onError: (err: any) => {
                toast({
                  type: "error",
                  title: t("wa.contacts.lists.createFailed"),
                  description: err?.message ?? String(err),
                });
              },
            },
          );
        }}
      />

      {/* Rename list dialog */}
      <RenameListDialog
        listId={showRenameList}
        currentName={lists?.find(l => l.id === showRenameList)?.name ?? ""}
        onClose={() => setShowRenameList(null)}
        onSubmit={(name) => {
          if (!showRenameList) return;
          listMuts.rename.mutate({ listId: showRenameList, name }, { onSuccess: () => { setShowRenameList(null); toast({ type: "success", title: t("wa.contacts.lists.renamed") }); } });
        }}
      />

      {/* Import to list dialog */}
      <Dialog open={showImportToList} onClose={() => setShowImportToList(false)}>
        <DialogHeader><DialogTitle>{t("wa.contacts.lists.importCsvTitle")}</DialogTitle><DialogClose onClose={() => setShowImportToList(false)} /></DialogHeader>
        <DialogBody>
          <div className="flex flex-col items-center gap-4 py-4">
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleImportToList} />
            <Upload className="size-10 text-[var(--color-fg-muted)]" />
            <p className="text-sm text-[var(--color-fg-muted)]">{t("wa.contacts.lists.importCsvHint")}</p>
            <Button variant="outline" onClick={() => fileRef.current?.click()}>{t("wa.contacts.actions.import")}</Button>
            <Button variant="ghost" size="sm" onClick={downloadImportTemplate}>{t("wa.contacts.actions.downloadTemplate")}</Button>
          </div>
        </DialogBody>
      </Dialog>
    </div>
  );
}

function CreateListDialog({ open, loading, onClose, onSubmit }: { open: boolean; loading?: boolean; onClose: () => void; onSubmit: (data: { name: string; description?: string; color?: string }) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("primary");

  const reset = () => { setName(""); setDescription(""); setColor("primary"); };

  return (
    <Dialog open={open} onClose={() => { onClose(); reset(); }}>
      <DialogHeader><DialogTitle>{t("wa.contacts.lists.createTitle")}</DialogTitle><DialogClose onClose={() => { onClose(); reset(); }} /></DialogHeader>
      <DialogBody>
        <div className="space-y-4 py-2">
          <div>
            <label className="text-sm font-medium">{t("wa.contacts.lists.name")}</label>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t("wa.contacts.lists.namePlaceholder")}
              className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-sm font-medium">{t("wa.contacts.lists.description")}</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={t("wa.contacts.lists.descriptionPlaceholder")}
              className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm min-h-[80px]"
            />
          </div>
          <div>
            <label className="text-sm font-medium">{t("wa.contacts.lists.color")}</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setColor(c.key)}
                  className={cn("size-8 rounded-full transition-all", c.className, color === c.key ? "ring-2 ring-offset-2 ring-offset-[var(--color-bg-elevated)] ring-[var(--color-fg)] scale-110" : "opacity-70 hover:opacity-100")}
                  aria-label={c.key}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => { onClose(); reset(); }} disabled={loading}>{t("common.cancel")}</Button>
            <Button
              loading={loading}
              disabled={!name.trim() || name.trim().length < 2}
              onClick={() => onSubmit({ name: name.trim(), description: description.trim() || undefined, color })}
            >
              <Plus className="size-4" /> {t("wa.contacts.lists.create")}
            </Button>
          </div>
        </div>
      </DialogBody>
    </Dialog>
  );
}

function RenameListDialog({ listId, currentName, onClose, onSubmit }: { listId: string | null; currentName: string; onClose: () => void; onSubmit: (name: string) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(currentName);
  if (!listId) return null;
  return (
    <Dialog open={!!listId} onClose={onClose}>
      <DialogHeader><DialogTitle>{t("wa.contacts.lists.renameTitle")}</DialogTitle><DialogClose onClose={onClose} /></DialogHeader>
      <DialogBody>
        <div className="space-y-4 py-2">
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
            <Button disabled={!name.trim()} onClick={() => onSubmit(name.trim())}>{t("common.save")}</Button>
          </div>
        </div>
      </DialogBody>
    </Dialog>
  );
}
