import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Group, Search, AlertTriangle, RefreshCw, Send, Users, Globe, Lock, Shield, CheckSquare, Square } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { FbSessionSelector } from "@/components/extraction/FbSessionSelector";
import type { ManagedGroup, ListGroupsResponse } from "./types";

interface Props {
  onGoToPublish: (ids: string[], names: string[]) => void;
}

export function MyGroupsTab({ onGoToPublish }: Props) {
  const { t } = useTranslation();
  const [sessionId, setSessionId] = useState("");

  const [phase, setPhase] = useState<"idle" | "loading" | "loaded" | "error" | "empty">("idle");
  const [groups, setGroups] = useState<ManagedGroup[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "members" | "privacy">("name");
  const [privacyFilter, setPrivacyFilter] = useState<"all" | "public" | "private">("all");
  const [roleFilter, setRoleFilter] = useState<"all" | "admin" | "moderator" | "member">("all");

  const fetchGroups = useCallback(async () => {
    if (!sessionId) return;
    setPhase("loading");
    try {
      const res = await fetch(`${import.meta.env.VITE_EXTRACTION_API_URL}/list-groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": import.meta.env.VITE_EXTRACTION_API_KEY || "" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      const data = await res.json() as ListGroupsResponse;
      if (!res.ok || data.error) throw new Error(data.error?.message || "Failed");
      
      // Handle platform limitation notice
      if (data.notice?.platform_limitation) {
        setGroups([]);
        setPhase("empty");
        return;
      }
      
      // Handle normal empty state
      if (!data.groups?.length) { 
        setGroups([]);
        setPhase("empty"); 
        return;
      }
      
      setGroups(data.groups);
      setPhase("loaded");
    } catch { setPhase("error"); }
  }, [sessionId]);

  useEffect(() => { if (sessionId && phase === "idle") fetchGroups(); }, [sessionId, phase, fetchGroups]);

  const filtered = useMemo(() => {
    let result = [...groups];
    if (search) result = result.filter(g => g.name.toLowerCase().includes(search.toLowerCase()));
    if (privacyFilter !== "all") result = result.filter(g => g.privacy.toLowerCase() === privacyFilter.toLowerCase());
    if (roleFilter !== "all") result = result.filter(g => g.role === roleFilter || (roleFilter === "admin" && (g.role === "مدير" || g.role === "admin")));
    if (sortBy === "name") result.sort((a, b) => a.name.localeCompare(b.name));
    if (sortBy === "members") result.sort((a, b) => parseInt(b.member_count || "0") - parseInt(a.member_count || "0"));
    if (sortBy === "privacy") result.sort((a, b) => a.privacy.localeCompare(b.privacy));
    return result;
  }, [groups, search, sortBy, privacyFilter, roleFilter]);

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map(g => g.id)));
  };

  // IDLE STATE — Session check
  if (phase === "idle") {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Card className="max-w-md w-full border-dashed border-2 border-[var(--color-border)] bg-[var(--color-surface-1)]/50">
          <CardContent className="flex flex-col items-center gap-5 py-14">
            <div className="p-4 rounded-full bg-[var(--color-primary)]/10">
              <Group className="size-10 text-[var(--color-primary)]" />
            </div>
            <div className="text-center space-y-2">
              <p className="text-xl font-bold tracking-tight">{t("pages.groups.myGroups")}</p>
              <p className="text-sm text-[var(--color-fg-muted)] max-w-xs">اكتشف جميع الجروبات التي تنتمي إليها أو تديرها على فيسبوك</p>
            </div>
            <div className="w-full max-w-xs">
              <FbSessionSelector value={sessionId} onChange={setSessionId} />
            </div>
            <Button size="lg" onClick={fetchGroups} disabled={!sessionId} className="gap-2 px-6">
              <Group className="size-5" /> جلب الجروبات
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // LOADING SKELETON
  if (phase === "loading") {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mt-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="overflow-hidden">
            <CardContent className="p-0">
              <div className="p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <Skeleton className="size-6 rounded shrink-0" />
                  <Skeleton className="size-14 rounded-xl shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
                <div className="flex gap-2"><Skeleton className="h-6 w-16 rounded-full" /><Skeleton className="h-6 w-16 rounded-full" /></div>
              </div>
              <div className="h-1 bg-[var(--color-surface-2)]"><Skeleton className="h-1 w-1/3" /></div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  // ERROR STATE
  if (phase === "error") {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Card className="max-w-md w-full border-dashed border-2 border-[var(--color-error)]/30 bg-[var(--color-error)]/5">
          <CardContent className="flex flex-col items-center gap-4 py-14">
            <div className="p-4 rounded-full bg-[var(--color-error)]/10"><AlertTriangle className="size-10 text-[var(--color-error)]" /></div>
            <p className="text-xl font-bold">{t("pages.groups.fetchError")}</p>
            <p className="text-sm text-[var(--color-fg-muted)]">تعذر الاتصال بخدمة فيسبوك. تحقق من اتصالك وحالة الجلسة.</p>
            <Button onClick={fetchGroups} className="gap-2"><RefreshCw className="size-4" /> إعادة المحاولة</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // EMPTY STATE — include platform notice if relevant
  if (phase === "empty") {
    const isPlatformLimit = groups.length === 0 && sessionId;
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Card className="max-w-md w-full border-dashed border-2 border-[var(--color-border)] bg-[var(--color-surface-1)]/50">
          <CardContent className="flex flex-col items-center gap-4 py-14">
            {isPlatformLimit ? (
              <>
                <div className="p-4 rounded-full bg-[var(--color-warning)]/10"><AlertTriangle className="size-10 text-[var(--color-warning)]" /></div>
                <p className="text-xl font-bold">قائمة الجروبات غير متاحة</p>
                <p className="text-sm text-center text-[var(--color-fg-muted)]">
                  فيسبوك لا يسمح بالوصول للجروبات عبر الويب. هذه ميزة منصة وليست عطل في FlowTix.
                  <br />
                  <span className="text-[var(--color-fg-muted)]/70">يمكنك النشر باستخدام الجروبات التي تعرفها يدوياً.</span>
                </p>
                <div className="text-xs text-[var(--color-fg-muted)]/60 bg-[var(--color-surface-2)] px-3 py-2 rounded-lg border border-[var(--color-border)]">
                  <strong>ملاحظة:</strong> هذه رسالة واضحة لتجنب التوقعات الخاطئة. FlowTix يعمل بشكل طبيعي للخدمات الأخرى.
                </div>
              </>
            ) : (
              <>
                <div className="p-4 rounded-full bg-[var(--color-fg-muted)]/10"><Group className="size-10 text-[var(--color-fg-muted)]" /></div>
                <p className="text-xl font-bold">{t("pages.groups.noGroups")}</p>
                <p className="text-sm text-[var(--color-fg-muted)]">{t("pages.groups.noGroupsDesc")}</p>
                <Button onClick={fetchGroups} variant="outline" className="gap-2"><RefreshCw className="size-4" /> تحديث</Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // LOADED — Toolbar + Grid
  return (
    <div className="space-y-5 mt-2">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-56">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[var(--color-fg-muted)]" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="بحث في الجروبات..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20" />
          </div>
          <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm h-10">
            <option value="name">{t("pages.groups.sortByName")}</option>
            <option value="members">{t("pages.groups.sortByMembers")}</option>
            <option value="privacy">{t("pages.groups.sortByPrivacy")}</option>
          </select>
          <select value={privacyFilter} onChange={e => setPrivacyFilter(e.target.value as any)} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm h-10">
            <option value="all">كل الأنواع</option>
            <option value="public">{t("pages.groups.public")}</option>
            <option value="private">{t("pages.groups.private")}</option>
          </select>
          <select value={roleFilter} onChange={e => setRoleFilter(e.target.value as any)} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm h-10">
            <option value="all">كل الأدوار</option>
            <option value="admin">{t("pages.groups.admin")}</option>
            <option value="member">{t("pages.groups.member")}</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={fetchGroups} title="تحديث"><RefreshCw className="size-4" /></Button>
          <span className="text-sm text-[var(--color-fg-muted)] font-medium tabular-nums">{filtered.length} جروب</span>
          <Button variant="outline" size="sm" onClick={toggleAll} className={cn(selected.size > 0 && "border-[var(--color-primary)] text-[var(--color-primary)]")}>
            {selected.size === filtered.length ? <Square className="size-4" /> : <CheckSquare className="size-4" />}
            {selected.size === filtered.length ? "إلغاء الكل" : "تحديد الكل"}
          </Button>
          {selected.size > 0 && (
            <Button size="sm" onClick={() => { const ids = Array.from(selected); const names = ids.map(id => groups.find(g => g.id === id)?.name || id); onGoToPublish(ids, names); }} className="gap-2">
              <Send className="size-4" /> نشر ({selected.size})
            </Button>
          )}
        </div>
      </div>

      {/* Session status indicator */}
      <div className="flex items-center gap-2 text-xs">
        {sessionId ? (
          <><div className="size-2 rounded-full bg-[var(--color-success)] animate-pulse" /><span className="text-[var(--color-fg-muted)]">الجلسة متصلة</span></>
        ) : (
          <><div className="size-2 rounded-full bg-[var(--color-error)]" /><span className="text-[var(--color-error)]">الجلسة غير متصلة — لن تتمكن من النشر</span></>
        )}
      </div>

      {/* Group Cards Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map(group => {
          const isSel = selected.has(group.id);
          return (
            <Card
              key={group.id}
              className={cn(
                "group cursor-pointer transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5 border-2",
                isSel ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5 shadow-md" : "border-transparent hover:border-[var(--color-border)]"
              )}
              onClick={() => toggleSelect(group.id)}
            >
              <CardContent className="p-5">
                {/* Top: Check + Avatar + Info */}
                <div className="flex items-start gap-3">
                  <div className={cn("mt-1 size-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
                    isSel ? "border-[var(--color-primary)] bg-[var(--color-primary)]" : "border-[var(--color-border)]"
                  )}>
                    {isSel && <svg className="size-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                  </div>
                  <div className={cn("size-12 rounded-xl flex items-center justify-center shrink-0 overflow-hidden",
                    group.picture_url ? "bg-transparent" : "bg-gradient-to-br from-[var(--color-primary)]/10 to-[var(--color-primary)]/5"
                  )}>
                    {group.picture_url ? (
                      <img src={group.picture_url} alt="" className="size-full object-cover" />
                    ) : (
                      <Group className="size-6 text-[var(--color-primary)]/60" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 pt-0.5">
                    <p className="font-semibold text-sm leading-tight truncate">{group.name}</p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {group.member_count && (
                        <Badge variant="outline" className="text-[11px] gap-1 px-2 py-0.5">
                          <Users className="size-3" />{group.member_count}
                        </Badge>
                      )}
                      <Badge variant={group.privacy === "Public" ? "primary" : "outline"} className="text-[11px] gap-1 px-2 py-0.5">
                        {group.privacy === "Public" ? <Globe className="size-3" /> : <Lock className="size-3" />}
                        {group.privacy === "Public" ? "عام" : "خاص"}
                      </Badge>
                      {group.role && (
                        <Badge variant="outline" className="text-[11px] gap-1 px-2 py-0.5">
                          <Shield className="size-3" />{group.role}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                {/* Bottom status bar */}
                <div className="mt-4 pt-3 border-t border-[var(--color-border)] flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <div className={cn("size-2 rounded-full", group.can_post ? "bg-[var(--color-success)]" : "bg-[var(--color-warning)]")} />
                    <span className="text-[11px] text-[var(--color-fg-muted)]">{group.can_post ? "يمكن النشر" : "لا يمكن النشر"}</span>
                  </div>
                  <span className="text-[11px] text-[var(--color-fg-muted)] opacity-0 group-hover:opacity-100 transition-opacity">اختيار</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
