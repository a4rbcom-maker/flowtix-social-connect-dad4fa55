import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Users, UserCog, Pause, Play, Trash2, KeyRound, UserPlus, Mail, Building2, Clock, Search, Loader2, CreditCard, MoreVertical, Eye, EyeOff } from "lucide-react";
import { useAdminUsers, useAdminUser, useUpdateUserStatus, useChangeUserRole, useSetUserPassword, useInviteUser, useDeleteUser } from "@/hooks/useAdmin";
import { PageHeader } from "@/components/ui/page";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogHeader, DialogTitle, DialogClose, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { AdminUserListItem, AdminUserRole, AdminInviteUserInput } from "@/types/admin.types";

const STATUS_BADGE: Record<string, "success" | "warning" | "error" | "default"> = { active: "success", pending: "warning", suspended: "error", expired: "default", deleted: "default" };
const ROLE_BADGE: Record<string, "primary" | "success" | "default"> = { super_admin: "primary", admin: "success", user: "default" };
const PAGE_SIZE = 20;

export function AdminUsersPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [page, setPage] = useState(0);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!openMenu) return;
    const close = () => setOpenMenu(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [openMenu]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [roleDialog, setRoleDialog] = useState<{ userId: string; currentRole: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [pwdDialog, setPwdDialog] = useState<string | null>(null);

  const filters = useMemo(() => ({
    search: search || undefined, status: statusFilter || undefined, role: roleFilter || undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE,
  }), [search, statusFilter, roleFilter, page]);

  const { data: users, isLoading } = useAdminUsers(filters);
  const updateStatus = useUpdateUserStatus();
  const changeRole = useChangeUserRole();
  const setPwd = useSetUserPassword();
  const invite = useInviteUser();
  const delUser = useDeleteUser();

  function handleAction(userId: string, action: string, user: AdminUserListItem) {
    switch (action) {
      case "view": setSelectedUserId(userId); break;
      case "suspend": updateStatus.mutate({ userId, status: "suspended" }, { onSuccess: () => toast({ type: "success", title: t("admin.users.suspendedOk") }), onError: (e) => toast({ type: "error", title: e.message }) }); break;
      case "activate": updateStatus.mutate({ userId, status: "active" }, { onSuccess: () => toast({ type: "success", title: t("admin.users.activatedOk") }), onError: (e) => toast({ type: "error", title: e.message }) }); break;
      case "delete": setDeleteTarget(userId); break;
      case "reset_password": setPwdDialog(userId); break;
      case "change_role": setRoleDialog({ userId, currentRole: user.role }); break;
    }
  }

  function renderRowActions(u: AdminUserListItem, isMobile: boolean) {
    const actions = [
      { key: "change_role", label: t("admin.users.actionChangeRole"), icon: UserCog, color: "hover:bg-[var(--color-warning)]/10 hover:text-[var(--color-warning)]" },
      { key: "reset_password", label: t("admin.users.actionResetPassword"), icon: KeyRound, color: "hover:bg-[var(--color-info)]/10 hover:text-[var(--color-info)]", onClick: () => setPwdDialog(u.user_id) },
      ...(u.status === "active"
        ? [{ key: "suspend", label: t("admin.users.actionSuspend"), icon: Pause, color: "hover:bg-[var(--color-warning)]/10 hover:text-[var(--color-warning)]" }]
        : [{ key: "activate", label: t("admin.users.actionActivate"), icon: Play, color: "hover:bg-[var(--color-success)]/10 hover:text-[var(--color-success)]" }]),
      { key: "subscription", label: t("admin.subscriptions.title"), icon: CreditCard, color: "hover:bg-[var(--color-primary)]/10 hover:text-[var(--color-primary)]", onClick: () => { window.location.href = "/admin/subscriptions"; } },
      { key: "delete", label: t("admin.users.actionDelete"), icon: Trash2, color: "hover:bg-[var(--color-error)]/10 hover:text-[var(--color-error)]" },
    ];

    if (isMobile) {
      return (
        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setOpenMenu(openMenu === u.user_id ? null : u.user_id); }}
            className="rounded-md p-2 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)]"
          >
            <MoreVertical className="size-4" />
          </button>
          {openMenu === u.user_id && (
            <div className="absolute end-0 top-full mt-1 z-20 w-44 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-lg py-1">
              {actions.map((a) => {
                const Icon = a.icon;
                return (
                  <button
                    key={a.key}
                    onClick={(e) => { e.stopPropagation(); setOpenMenu(null); a.onClick ? a.onClick() : handleAction(u.user_id, a.key, u); }}
                    className={cn("flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-[var(--color-surface-2)]", a.color)}
                  >
                    <Icon className="size-3.5" />
                    {a.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="flex items-center justify-end gap-1">
        <button onClick={() => setRoleDialog({ userId: u.user_id, currentRole: u.role })} className="rounded-md p-1.5 text-[var(--color-fg-muted)] transition-colors hover:bg-[var(--color-warning)]/10 hover:text-[var(--color-warning)]" title={t("admin.users.actionChangeRole")}>
          <UserCog className="size-4" />
        </button>
        <button onClick={() => setPwdDialog(u.user_id)} className="rounded-md p-1.5 text-[var(--color-fg-muted)] transition-colors hover:bg-[var(--color-info)]/10 hover:text-[var(--color-info)]" title={t("admin.users.actionResetPassword")}>
          <KeyRound className="size-4" />
        </button>
        {u.status === "active" ? (
          <button onClick={() => updateStatus.mutate({ userId: u.user_id, status: "suspended" }, { onSuccess: () => toast({ type: "success", title: t("admin.users.suspendedOk") }), onError: (e) => toast({ type: "error", title: e.message }) })} className="rounded-md p-1.5 text-[var(--color-fg-muted)] transition-colors hover:bg-[var(--color-warning)]/10 hover:text-[var(--color-warning)]" title={t("admin.users.actionSuspend")}>
            <Pause className="size-4" />
          </button>
        ) : (
          <button onClick={() => updateStatus.mutate({ userId: u.user_id, status: "active" }, { onSuccess: () => toast({ type: "success", title: t("admin.users.activatedOk") }), onError: (e) => toast({ type: "error", title: e.message }) })} className="rounded-md p-1.5 text-[var(--color-fg-muted)] transition-colors hover:bg-[var(--color-success)]/10 hover:text-[var(--color-success)]" title={t("admin.users.actionActivate")}>
            <Play className="size-4" />
          </button>
        )}
        <button onClick={() => { window.location.href = "/admin/subscriptions"; }} className="rounded-md p-1.5 text-[var(--color-fg-muted)] transition-colors hover:bg-[var(--color-primary)]/10 hover:text-[var(--color-primary)]" title={t("admin.subscriptions.title")}>
          <CreditCard className="size-4" />
        </button>
        <button onClick={() => setDeleteTarget(u.user_id)} className="rounded-md p-1.5 text-[var(--color-fg-muted)] transition-colors hover:bg-[var(--color-error)]/10 hover:text-[var(--color-error)]" title={t("admin.users.actionDelete")}>
          <Trash2 className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("admin.users.title")} icon={Users} action={<Button onClick={() => setInviteOpen(true)} className="gap-2"><UserPlus className="size-4" />{t("admin.users.invite")}</Button>} />

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-4 text-[var(--color-fg-muted)]" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            placeholder={t("admin.users.searchPlaceholder")}
            className="w-full ps-9 pe-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-sm h-10" autoComplete="off"
          />
        </div>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(0); }} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm h-10 sm:w-auto">
          <option value="">{t("admin.users.filterStatus")}</option>
          <option value="active">{t("admin.users.statusActive")}</option>
          <option value="pending">{t("admin.users.statusPending")}</option>
          <option value="suspended">{t("admin.users.statusSuspended")}</option>
          <option value="expired">{t("admin.users.statusExpired")}</option>
        </select>
        <select value={roleFilter} onChange={e => { setRoleFilter(e.target.value); setPage(0); }} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm h-10 sm:w-auto">
          <option value="">{t("admin.users.filterRole")}</option>
          <option value="super_admin">{t("admin.users.roleSuperAdmin")}</option>
          <option value="admin">{t("admin.users.roleAdmin")}</option>
          <option value="user">{t("admin.users.roleUser")}</option>
        </select>
      </div>

      <Card className="overflow-hidden p-0 relative">
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="size-8 animate-spin text-[var(--color-primary)]" /></div>
        ) : !users || users.length === 0 ? (
          <div className="py-12 text-center text-[var(--color-fg-muted)]">{t("admin.users.empty")}</div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-1)]">
                  <tr>
                    <th className="p-3 text-start font-semibold text-[var(--color-fg-muted)]">{t("admin.users.colUser")}</th>
                    <th className="p-3 text-start font-semibold text-[var(--color-fg-muted)]">{t("admin.users.colRole")}</th>
                    <th className="p-3 text-start font-semibold text-[var(--color-fg-muted)] hidden md:table-cell">{t("admin.users.colWorkspace")}</th>
                    <th className="p-3 text-start font-semibold text-[var(--color-fg-muted)]">{t("admin.users.colStatus")}</th>
                    <th className="p-3 text-start font-semibold text-[var(--color-fg-muted)] hidden lg:table-cell">{t("admin.users.colLastSignIn")}</th>
                    <th className="p-3 text-start font-semibold text-[var(--color-fg-muted)] hidden lg:table-cell">{t("admin.users.colCreated")}</th>
                    <th className="p-3 w-32 lg:w-40 text-end font-semibold text-[var(--color-fg-muted)]">{t("common.actions", "Actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.user_id} className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-2)] transition-colors">
                      <td className="p-3">
                        <div className="flex items-center gap-3">
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)]/10 text-xs font-bold text-[var(--color-primary)]">{(u.full_name || u.email || "?").charAt(0).toUpperCase()}</div>
                          <div className="min-w-0"><p className="truncate text-sm font-medium">{u.full_name || "—"}</p><p className="truncate text-xs text-[var(--color-fg-muted)]">{u.email}</p></div>
                        </div>
                      </td>
                      <td className="p-3"><Badge variant={ROLE_BADGE[u.role] ?? "default"}>{t(`admin.users.role${u.role === "super_admin" ? "SuperAdmin" : u.role === "admin" ? "Admin" : "User"}`)}</Badge></td>
                      
                      <td className="p-3"><Badge variant={STATUS_BADGE[u.status] ?? "default"}>{t(`admin.users.status${u.status.charAt(0).toUpperCase()}${u.status.slice(1)}`)}</Badge></td>
                      <td className="p-3 hidden lg:table-cell text-xs text-[var(--color-fg-muted)]">{u.last_sign_in ? new Date(u.last_sign_in).toLocaleDateString() : t("admin.users.never")}</td>
                      <td className="p-3 hidden lg:table-cell text-xs text-[var(--color-fg-muted)]">{new Date(u.created_at).toLocaleDateString()}</td>
                      <td className="p-3 text-end">{renderRowActions(u, false)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden space-y-3 p-3">
              {users.map((u) => (
                <div key={u.user_id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)]/10 text-sm font-bold text-[var(--color-primary)]">{(u.full_name || u.email || "?").charAt(0).toUpperCase()}</div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{u.full_name || "—"}</p>
                        <p className="truncate text-xs text-[var(--color-fg-muted)]">{u.email}</p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <Badge variant={ROLE_BADGE[u.role] ?? "default"} className="text-[0.65rem]">
                            {t(`admin.users.role${u.role === "super_admin" ? "SuperAdmin" : u.role === "admin" ? "Admin" : "User"}`)}
                          </Badge>
                          <Badge variant={STATUS_BADGE[u.status] ?? "default"} className="text-[0.65rem]">
                            {t(`admin.users.status${u.status.charAt(0).toUpperCase()}${u.status.slice(1)}`)}
                          </Badge>
                        </div>
                      </div>
                    </div>
                    {renderRowActions(u, true)}
                  </div>
                  {u.workspace_name && (
                    <div className="flex items-center justify-between text-xs border-t border-[var(--color-border)] pt-2">
                      <span className="text-[var(--color-fg-muted)]">{t("admin.users.colWorkspace")}</span>
                      <span className="font-medium">{u.workspace_name}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--color-fg-muted)]">{t("admin.users.colCreated")}</span>
                    <span>{new Date(u.created_at).toLocaleDateString()}</span>
                  </div>
                  {u.last_sign_in && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[var(--color-fg-muted)]">{t("admin.users.colLastSignIn")}</span>
                      <span>{new Date(u.last_sign_in).toLocaleDateString()}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      {users && users.length === PAGE_SIZE && (
        <div className="flex justify-center"><Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)}>{t("admin.users.loadMore")}</Button></div>
      )}

      <AdminUserDrawer userId={selectedUserId} onClose={() => setSelectedUserId(null)} />
      <AdminInviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} onInvite={(i: any) => invite.mutateAsync(i)} />
      {roleDialog && <AdminRoleDialog userId={roleDialog.userId} currentRole={roleDialog.currentRole} onClose={() => setRoleDialog(null)} onChange={(v: any) => changeRole.mutateAsync(v)} />}
      {pwdDialog !== null && (
        <Dialog open onClose={() => setPwdDialog(null)}>
          <DialogHeader><DialogTitle>تغيير كلمة المرور</DialogTitle><DialogClose onClose={() => setPwdDialog(null)} /></DialogHeader>
          <PwdForm userId={pwdDialog} onClose={() => setPwdDialog(null)} setPwd={setPwd} />
        </Dialog>
      )}
      {deleteTarget && (
        <Dialog open onClose={() => setDeleteTarget(null)}>
          <DialogHeader><DialogTitle>{t("admin.users.confirmDelete")}</DialogTitle><DialogClose onClose={() => setDeleteTarget(null)} /></DialogHeader>
          <DialogBody>
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <div className="flex size-16 items-center justify-center rounded-2xl bg-[color-mix(in_oklab,var(--color-error)_12%,transparent)]">
                <Trash2 className="size-8 text-[var(--color-error)]" />
              </div>
              <p className="text-sm text-[var(--color-fg-muted)]">{t("admin.users.confirmDelete")}</p>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>{t("common.no")}</Button>
            <Button variant="danger" onClick={() => {
              delUser.mutate(deleteTarget, {
                onSuccess: () => { toast({ type: "success", title: t("admin.users.deletedOk") }); setDeleteTarget(null); },
                onError: (e) => toast({ type: "error", title: e.message }),
              });
            }}>{t("common.yes")}</Button>
          </DialogFooter>
        </Dialog>
      )}
    </div>
  );
}

function AdminUserDrawer({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { data: user, isLoading } = useAdminUser(userId);
  if (!userId) return null;
  return (
    <Dialog open onClose={onClose}><DialogHeader><DialogTitle>{t("admin.users.detailsTitle")}</DialogTitle><DialogClose onClose={onClose} /></DialogHeader>
      <DialogBody>{isLoading || !user ? <Loader2 className="size-8 animate-spin mx-auto py-8" /> : (
        <div className="space-y-5">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-3 sm:gap-4 text-center sm:text-start">
            <div className="flex size-14 sm:size-16 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)]/10 text-xl font-bold text-[var(--color-primary)] mx-auto sm:mx-0">{(user.full_name || user.email || "?").charAt(0).toUpperCase()}</div>
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-bold truncate">{user.full_name || "—"}</h3>
              <p className="text-sm text-[var(--color-fg-muted)] truncate">{user.email}</p>
              <div className="mt-2 flex flex-wrap gap-2 justify-center sm:justify-start">
                <Badge variant={ROLE_BADGE[user.role] ?? "default"}>{t(`admin.users.role${user.role === "super_admin" ? "SuperAdmin" : user.role === "admin" ? "Admin" : "User"}`)}</Badge>
                <Badge variant={STATUS_BADGE[user.status] ?? "default"}>{t(`admin.users.status${user.status?.charAt(0).toUpperCase()}${user.status?.slice(1)}`)}</Badge>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Info icon={Mail} label={t("admin.users.email")} val={user.email} />
            <Info icon={Building2} label={t("admin.users.workspace")} val={user.workspace_name || "—"} />
            <Info icon={Clock} label={t("admin.users.lastSignIn")} val={user.last_sign_in ? new Date(user.last_sign_in).toLocaleString() : t("admin.users.never")} />
            <Info icon={Clock} label={t("admin.users.created")} val={new Date(user.created_at).toLocaleString()} />
          </div>
          {(user as any).plan_name && (
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
              <p className="text-xs font-semibold text-[var(--color-fg-muted)] mb-2">{t("admin.subscriptions.title", "Subscription")}</p>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--color-fg)] truncate">{(user as any).plan_name}</p>
                  <p className="text-xs text-[var(--color-fg-muted)] truncate">{(user as any).plan_interval === "yearly" ? t("admin.plans.year") : t("admin.plans.month")} · {String(t(`admin.subscriptions.${(user as any).subscription_status}`) || (user as any).subscription_status || "active")}</p>
                </div>
                {(user as any).subscription_end && (
                  <div className="text-end shrink-0">
                    <p className="text-xs text-[var(--color-fg-muted)]">{new Date((user as any).subscription_end).toLocaleDateString()}</p>
                    <p className="text-[0.65rem] text-[var(--color-success)] font-semibold">{t("admin.subscriptions.active")}</p>
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            <Usage label={t("admin.users.waSessions")} val={(user as any).wa_sessions_count} />
            <Usage label={t("admin.users.waMessages")} val={(user as any).wa_messages_count} />
            <Usage label={t("admin.users.aiCost")} val={`$${Number((user as any).ai_cost_usd ?? 0).toFixed(2)}`} />
          </div>
        </div>
      )}</DialogBody>
    </Dialog>
  );
}
function Info({ icon: I, label, val }: { icon: any; label: string; val: string }) { return <div className="rounded-lg border border-[var(--color-border)] p-3"><div className="flex items-center gap-2 text-xs text-[var(--color-fg-muted)]"><I className="size-3.5" />{label}</div><p className="mt-1 truncate text-sm font-medium">{val}</p></div>; }
function Usage({ label, val }: { label: string; val: string | number }) { return <div className="rounded-lg border border-[var(--color-border)] p-3 text-center"><p className="text-lg font-bold">{val}</p><p className="text-xs text-[var(--color-fg-muted)]">{label}</p></div>; }

function AdminInviteDialog({ open, onClose, onInvite }: { open: boolean; onClose: () => void; onInvite: (i: AdminInviteUserInput) => Promise<string> }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState(""); const [fullName, setFullName] = useState(""); const [role, setRole] = useState<AdminUserRole>("user"); const [loading, setLoading] = useState(false);
  async function submit() { if (!email) return; setLoading(true); try { await onInvite({ email, full_name: fullName || undefined, role }); toast({ type: "success", title: t("admin.users.invitedOk") }); setEmail(""); setFullName(""); setRole("user"); onClose(); } catch (e: any) { toast({ type: "error", title: e.message.includes("already_exists") ? t("admin.users.alreadyExists") : e.message }); } finally { setLoading(false); } }
  return (
    <Dialog open={open} onClose={onClose}><DialogHeader><DialogTitle>{t("admin.users.inviteTitle")}</DialogTitle><DialogClose onClose={onClose} /></DialogHeader>
      <DialogBody className="space-y-4"><div><Label>{t("admin.users.email")}</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="user@example.com" /></div>
        <div><Label>{t("admin.users.fullName")}</Label><Input value={fullName} onChange={e => setFullName(e.target.value)} placeholder={t("admin.users.fullNamePlaceholder")} /></div>
        <div><Label>{t("admin.users.role")}</Label><select value={role} onChange={e => setRole(e.target.value as AdminUserRole)} className="w-full border rounded-lg px-3 py-2 text-sm">
          <option value="user">{t("admin.users.roleUser")}</option><option value="admin">{t("admin.users.roleAdmin")}</option><option value="super_admin">{t("admin.users.roleSuperAdmin")}</option></select></div>
      </DialogBody>
      <DialogFooter><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button onClick={submit} disabled={loading || !email}>{loading ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}{t("admin.users.sendInvite")}</Button></DialogFooter>
    </Dialog>
  );
}

function AdminRoleDialog({ userId, currentRole, onClose, onChange }: { userId: string; currentRole: string; onClose: () => void; onChange: (v: { userId: string; role: string }) => Promise<void> }) {
  const { t } = useTranslation(); const [newRole, setNewRole] = useState(currentRole); const [loading, setLoading] = useState(false);
  async function submit() { if (newRole === currentRole) { onClose(); return; } setLoading(true); try { await onChange({ userId, role: newRole }); toast({ type: "success", title: t("admin.users.roleChanged") }); onClose(); } catch (e: any) { toast({ type: "error", title: e.message }); } finally { setLoading(false); } }
  return (
    <Dialog open onClose={onClose}><DialogHeader><DialogTitle>{t("admin.users.changeRoleTitle")}</DialogTitle><DialogClose onClose={onClose} /></DialogHeader>
       <DialogBody className="space-y-2"><p className="text-sm text-[var(--color-fg-muted)]">{t("admin.users.currentRole")}: <span className="font-medium">{currentRole === "super_admin" ? t("admin.users.roleSuperAdmin") : currentRole === "admin" ? t("admin.users.roleAdmin") : t("admin.users.roleUser")}</span></p>
        <Label>{t("admin.users.newRole")}</Label>
        <select value={newRole} onChange={e => setNewRole(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
          <option value="user">{t("admin.users.roleUser")}</option><option value="admin">{t("admin.users.roleAdmin")}</option><option value="super_admin">{t("admin.users.roleSuperAdmin")}</option></select>
      </DialogBody>
      <DialogFooter><Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button><Button onClick={submit} disabled={loading}>{t("common.save")}</Button></DialogFooter>
    </Dialog>
  );
}

export type { AdminUserRole, AdminInviteUserInput };

function PwdForm({ userId, onClose, setPwd }: { userId: string; onClose: () => void; setPwd: ReturnType<typeof useSetUserPassword> }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (password.length < 8) { toast({ type: "error", title: "كلمة المرور يجب أن تكون 8 أحرف على الأقل" }); return; }
    if (password !== confirm) { toast({ type: "error", title: "كلمتا المرور غير متطابقتين" }); return; }
    setLoading(true);
    try {
      await setPwd.mutateAsync({ userId, password });
      toast({ type: "success", title: "تم تغيير كلمة المرور بنجاح" });
      onClose();
    } catch (e: any) {
      toast({ type: "error", title: e.message || "فشل تغيير كلمة المرور" });
    } finally { setLoading(false); }
  }

  return (
    <>
      <DialogBody className="space-y-4">
        <div className="space-y-2">
          <Label>كلمة المرور الجديدة</Label>
          <div className="relative">
            <Input type={show ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
            <button type="button" onClick={() => setShow(!show)} className="absolute end-3 top-1/2 -translate-y-1/2">
              {show ? <EyeOff className="size-4 text-[var(--color-fg-muted)]" /> : <Eye className="size-4 text-[var(--color-fg-muted)]" />}
            </button>
          </div>
        </div>
        <div className="space-y-2">
          <Label>تأكيد كلمة المرور</Label>
          <Input type={show ? "text" : "password"} value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="••••••••" />
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
        <Button onClick={submit} disabled={loading || !password || !confirm}>
          {loading ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
          حفظ كلمة المرور
        </Button>
      </DialogFooter>
    </>
  );
}