import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  X,
  Shield,
  ShieldOff,
  Trash2,
  Crown,
  Facebook,
  MessageCircle,
  UserCog,
  Loader2,
  Mail,
  Calendar,
  Users as UsersIcon,
  UserPlus,
  KeyRound,
  Ban,
  CheckCircle2,
  Pencil,
} from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useI18n } from "@/lib/i18n";
import {
  listAdminUsers,
  getAdminUserDetail,
  setUserRole,
  updateUserPlan,
  deleteUserAccount,
  createUserByAdmin,
  updateUserProfileByAdmin,
  setUserPasswordByAdmin,
  setUserBanned,
} from "@/lib/admin.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/users")({
  ssr: false,
  component: AdminUsersPage,
});

const PLANS = ["free", "starter", "pro", "business", "enterprise"];

function AdminUsersPage() {
  const { lang } = useI18n();
  const t = (ar: string, en: string) => (lang === "ar" ? ar : en);
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const usersQ = useQuery({
    queryKey: ["admin", "users", search, planFilter, roleFilter],
    queryFn: () => listAdminUsers({ data: { search, plan: planFilter, role: roleFilter, limit: 100, offset: 0 } }),
    staleTime: 20_000,
  });

  return (
    <AdminLayout title={t("إدارة المستخدمين", "User Management")}>
      {/* Toolbar */}
      <div className="rounded-2xl border border-border bg-card/70 backdrop-blur-xl p-4 mb-4 flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("ابحث بالاسم...", "Search by name...")}
            className="w-full ps-9 pe-3 py-2 rounded-xl bg-background border border-border focus:border-primary focus:outline-none text-sm"
          />
        </div>
        <select
          value={planFilter}
          onChange={(e) => setPlanFilter(e.target.value)}
          className="px-3 py-2 rounded-xl bg-background border border-border text-sm focus:outline-none focus:border-primary"
        >
          <option value="">{t("كل الباقات", "All Plans")}</option>
          {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="px-3 py-2 rounded-xl bg-background border border-border text-sm focus:outline-none focus:border-primary"
        >
          <option value="">{t("كل الأدوار", "All Roles")}</option>
          <option value="admin">Admin</option>
          <option value="moderator">Moderator</option>
        </select>
        <div className="flex items-center gap-2 text-xs text-muted-foreground px-2">
          <UsersIcon className="h-4 w-4" />
          <span>{usersQ.data?.total ?? 0}</span>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition"
        >
          <UserPlus className="h-4 w-4" />
          {t("إضافة مستخدم", "Add User")}
        </button>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-border bg-card/70 backdrop-blur-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-start font-semibold">{t("المستخدم", "User")}</th>
                <th className="px-4 py-3 text-start font-semibold">{t("الباقة", "Plan")}</th>
                <th className="px-4 py-3 text-start font-semibold">{t("الأدوار", "Roles")}</th>
                <th className="px-4 py-3 text-center font-semibold">FB</th>
                <th className="px-4 py-3 text-center font-semibold">WA</th>
                <th className="px-4 py-3 text-center font-semibold">{t("جهات", "Contacts")}</th>
                <th className="px-4 py-3 text-center font-semibold">{t("حملات", "Campaigns")}</th>
                <th className="px-4 py-3 text-start font-semibold">{t("تاريخ التسجيل", "Joined")}</th>
              </tr>
            </thead>
            <tbody>
              {usersQ.isLoading && (
                <tr><td colSpan={8} className="py-12 text-center"><Loader2 className="h-6 w-6 animate-spin text-primary mx-auto" /></td></tr>
              )}
              {usersQ.data?.rows.map((u) => (
                <tr
                  key={u.id}
                  onClick={() => setSelectedId(u.id)}
                  className="border-t border-border hover:bg-muted/40 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-primary-foreground text-xs font-bold shrink-0 overflow-hidden">
                        {u.avatar_url ? <img src={u.avatar_url} alt="" className="h-full w-full object-cover" /> : (u.full_name?.[0]?.toUpperCase() ?? "?")}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium truncate">{u.full_name || <span className="text-muted-foreground italic">{t("بدون اسم", "No name")}</span>}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{u.id.slice(0, 8)}…</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary text-xs font-semibold capitalize">{u.plan}</span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {u.roles.length === 0 && <span className="text-xs text-muted-foreground">user</span>}
                      {u.roles.map((r) => (
                        <span key={r} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${r === "admin" ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" : "bg-blue-500/15 text-blue-600 dark:text-blue-400"}`}>
                          {r === "admin" && <Crown className="h-2.5 w-2.5" />}
                          {r}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {u.fb ? <Facebook className="h-4 w-4 text-blue-500 mx-auto" /> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {u.wa.count > 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs">
                        <MessageCircle className={`h-3.5 w-3.5 ${u.wa.connected > 0 ? "text-emerald-500" : "text-muted-foreground"}`} />
                        {u.wa.connected}/{u.wa.count}
                      </span>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center text-xs font-medium">{u.contacts_count}</td>
                  <td className="px-4 py-3 text-center text-xs font-medium">{u.campaigns_count}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(u.created_at).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US", { dateStyle: "medium" })}
                  </td>
                </tr>
              ))}
              {usersQ.data && usersQ.data.rows.length === 0 && (
                <tr><td colSpan={8} className="py-12 text-center text-sm text-muted-foreground">{t("لا توجد نتائج", "No results")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail Drawer */}
      <AnimatePresence>
        {selectedId && (
          <UserDetailDrawer
            userId={selectedId}
            onClose={() => setSelectedId(null)}
            onChanged={() => qc.invalidateQueries({ queryKey: ["admin", "users"] })}
          />
        )}
      </AnimatePresence>

      {/* Create user modal */}
      <AnimatePresence>
        {createOpen && (
          <CreateUserModal
            onClose={() => setCreateOpen(false)}
            onCreated={() => {
              setCreateOpen(false);
              qc.invalidateQueries({ queryKey: ["admin", "users"] });
            }}
          />
        )}
      </AnimatePresence>
    </AdminLayout>
  );
}

function CreateUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { lang, dir } = useI18n();
  const t = (ar: string, en: string) => (lang === "ar" ? ar : en);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [plan, setPlan] = useState("free");
  const [makeAdmin, setMakeAdmin] = useState(false);

  const mut = useMutation({
    mutationFn: () => createUserByAdmin({ data: { email, password, fullName, plan, makeAdmin } }),
    onSuccess: () => { toast.success(t("تم إنشاء المستخدم", "User created")); onCreated(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
        dir={dir}
      >
        <div className="pointer-events-auto w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h3 className="font-bold flex items-center gap-2"><UserPlus className="h-4 w-4" /> {t("إضافة مستخدم جديد", "Add new user")}</h3>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted"><X className="h-4 w-4" /></button>
          </div>
          <form
            onSubmit={(e) => { e.preventDefault(); mut.mutate(); }}
            className="p-5 space-y-3"
          >
            <Field label={t("الاسم الكامل", "Full name")}>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:border-primary focus:outline-none text-sm" />
            </Field>
            <Field label={t("البريد الإلكتروني", "Email")}>
              <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:border-primary focus:outline-none text-sm" />
            </Field>
            <Field label={t("كلمة المرور (8 أحرف على الأقل)", "Password (min 8 chars)")}>
              <input required type="text" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:border-primary focus:outline-none text-sm font-mono" />
            </Field>
            <Field label={t("الباقة", "Plan")}>
              <select value={plan} onChange={(e) => setPlan(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:border-primary focus:outline-none text-sm">
                {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input type="checkbox" checked={makeAdmin} onChange={(e) => setMakeAdmin(e.target.checked)} className="h-4 w-4 rounded accent-primary" />
              <Crown className="h-3.5 w-3.5 text-amber-500" />
              {t("منح صلاحية الأدمن", "Grant Admin role")}
            </label>
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={onClose} className="flex-1 px-3 py-2 rounded-lg border border-border text-sm hover:bg-muted">{t("إلغاء", "Cancel")}</button>
              <button type="submit" disabled={mut.isPending} className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-50">
                {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                {t("إنشاء", "Create")}
              </button>
            </div>
          </form>
        </div>
      </motion.div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function UserDetailDrawer({ userId, onClose, onChanged }: { userId: string; onClose: () => void; onChanged: () => void }) {
  const { lang, dir } = useI18n();
  const t = (ar: string, en: string) => (lang === "ar" ? ar : en);
  const qc = useQueryClient();

  const detailQ = useQuery({
    queryKey: ["admin", "user", userId],
    queryFn: () => getAdminUserDetail({ data: { userId } }),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin", "user", userId] });
    onChanged();
  };

  const planMut = useMutation({
    mutationFn: (plan: string) => updateUserPlan({ data: { userId, plan } }),
    onSuccess: () => { toast.success(t("تم تحديث الباقة", "Plan updated")); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const roleMut = useMutation({
    mutationFn: ({ role, grant }: { role: "admin" | "moderator"; grant: boolean }) =>
      setUserRole({ data: { userId, role, grant } }),
    onSuccess: () => { toast.success(t("تم تحديث الدور", "Role updated")); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteUserAccount({ data: { userId } }),
    onSuccess: () => { toast.success(t("تم حذف الحساب", "Account deleted")); onChanged(); onClose(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const profileMut = useMutation({
    mutationFn: (input: { fullName?: string; email?: string }) => updateUserProfileByAdmin({ data: { userId, ...input } }),
    onSuccess: () => { toast.success(t("تم الحفظ", "Saved")); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const pwMut = useMutation({
    mutationFn: (password: string) => setUserPasswordByAdmin({ data: { userId, password } }),
    onSuccess: () => toast.success(t("تم تغيير كلمة المرور", "Password updated")),
    onError: (e: Error) => toast.error(e.message),
  });

  const banMut = useMutation({
    mutationFn: (banned: boolean) => setUserBanned({ data: { userId, banned } }),
    onSuccess: (_, banned) => { toast.success(banned ? t("تم إيقاف الحساب", "Account suspended") : t("تم تفعيل الحساب", "Account reactivated")); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const d = detailQ.data;
  const isAdmin = d?.roles.includes("admin");

  const [editingName, setEditingName] = useState<string | null>(null);
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
      />
      <motion.div
        initial={{ x: dir === "rtl" ? "-100%" : "100%" }}
        animate={{ x: 0 }}
        exit={{ x: dir === "rtl" ? "-100%" : "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 250 }}
        className={`fixed top-0 ${dir === "rtl" ? "left-0" : "right-0"} h-screen w-full md:w-[560px] bg-card border-${dir === "rtl" ? "r" : "l"} border-border z-50 shadow-2xl overflow-y-auto`}
        dir={dir}
      >
        <div className="sticky top-0 z-10 bg-card/95 backdrop-blur-xl border-b border-border p-4 flex items-center justify-between">
          <h2 className="font-bold">{t("تفاصيل المستخدم", "User Details")}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>

        {detailQ.isLoading || !d ? (
          <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <div className="p-5 space-y-5">
            {/* Header */}
            <div className="flex items-start gap-4">
              <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-primary-foreground text-xl font-bold overflow-hidden">
                {d.profile?.avatar_url ? <img src={d.profile.avatar_url} alt="" className="h-full w-full object-cover" /> : (d.profile?.full_name?.[0]?.toUpperCase() ?? "?")}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-bold truncate">{d.profile?.full_name || t("بدون اسم", "No name")}</h3>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-xs font-semibold capitalize">{d.profile?.plan ?? "free"}</span>
                  {d.roles.map((r) => (
                    <span key={r} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${r === "admin" ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" : "bg-blue-500/15 text-blue-600 dark:text-blue-400"}`}>
                      {r === "admin" && <Crown className="h-2.5 w-2.5" />}{r}
                    </span>
                  ))}
                  {d.auth.is_banned && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-destructive/15 text-destructive">
                      <Ban className="h-2.5 w-2.5" /> {t("موقوف", "Suspended")}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-2">
                  <Calendar className="h-3 w-3" />
                  {d.profile && new Date(d.profile.created_at).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US", { dateStyle: "long" })}
                </div>
              </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-3 gap-2">
              <StatBox label={t("جهات", "Contacts")} value={d.contacts_count} />
              <StatBox label={t("حملات", "Campaigns")} value={d.campaigns.length} />
              <StatBox label={t("جلسات WA", "WA Sessions")} value={d.whatsapp_sessions.length} />
            </div>

            {/* Profile edit */}
            <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-2"><Pencil className="h-4 w-4" /> {t("بيانات الحساب", "Account Info")}</h4>
              <EditableRow
                label={t("الاسم", "Name")}
                value={d.profile?.full_name ?? ""}
                editing={editingName}
                setEditing={setEditingName}
                onSave={(v) => profileMut.mutate({ fullName: v })}
                pending={profileMut.isPending}
              />
              <EditableRow
                label={t("البريد", "Email")}
                value={d.auth.email ?? ""}
                editing={editingEmail}
                setEditing={setEditingEmail}
                onSave={(v) => profileMut.mutate({ email: v })}
                pending={profileMut.isPending}
                type="email"
              />
              {d.auth.last_sign_in_at && (
                <div className="text-[11px] text-muted-foreground">
                  {t("آخر دخول:", "Last sign-in:")} {new Date(d.auth.last_sign_in_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-US")}
                </div>
              )}
            </div>

            {/* Password */}
            <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-2"><KeyRound className="h-4 w-4" /> {t("كلمة المرور", "Password")}</h4>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t("كلمة مرور جديدة (8 أحرف+)", "New password (8+ chars)")}
                  className="flex-1 px-3 py-2 rounded-lg bg-background border border-border text-sm font-mono focus:outline-none focus:border-primary"
                />
                <button
                  onClick={() => {
                    if (newPassword.length < 8) { toast.error(t("8 أحرف على الأقل", "At least 8 chars")); return; }
                    pwMut.mutate(newPassword, { onSuccess: () => setNewPassword("") });
                  }}
                  disabled={pwMut.isPending}
                  className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 disabled:opacity-50 inline-flex items-center gap-1"
                >
                  {pwMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                  {t("تغيير", "Update")}
                </button>
              </div>
            </div>

            {/* Plan controls */}
            <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-2"><UserCog className="h-4 w-4" /> {t("الباقة", "Plan")}</h4>
              <div className="flex flex-wrap gap-1.5">
                {PLANS.map((p) => (
                  <button
                    key={p}
                    onClick={() => planMut.mutate(p)}
                    disabled={planMut.isPending}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all ${
                      d.profile?.plan === p
                        ? "bg-primary text-primary-foreground shadow"
                        : "bg-background border border-border hover:border-primary"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Role + Ban controls */}
            <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
              <h4 className="text-sm font-semibold flex items-center gap-2"><Shield className="h-4 w-4" /> {t("الصلاحيات والحالة", "Access & Status")}</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  onClick={() => roleMut.mutate({ role: "admin", grant: !isAdmin })}
                  disabled={roleMut.isPending}
                  className={`inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    isAdmin
                      ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
                      : "bg-amber-500/15 text-amber-700 dark:text-amber-400 hover:bg-amber-500/25"
                  }`}
                >
                  {isAdmin ? <><ShieldOff className="h-3.5 w-3.5" /> {t("إزالة الأدمن", "Revoke Admin")}</> : <><Crown className="h-3.5 w-3.5" /> {t("منح الأدمن", "Grant Admin")}</>}
                </button>
                <button
                  onClick={() => {
                    if (confirm(d.auth.is_banned ? t("تفعيل الحساب؟", "Reactivate this account?") : t("إيقاف الحساب؟ لن يستطيع تسجيل الدخول.", "Suspend this account? They cannot sign in."))) {
                      banMut.mutate(!d.auth.is_banned);
                    }
                  }}
                  disabled={banMut.isPending}
                  className={`inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    d.auth.is_banned
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/25"
                      : "bg-orange-500/15 text-orange-700 dark:text-orange-400 hover:bg-orange-500/25"
                  }`}
                >
                  {d.auth.is_banned
                    ? <><CheckCircle2 className="h-3.5 w-3.5" /> {t("تفعيل الحساب", "Reactivate")}</>
                    : <><Ban className="h-3.5 w-3.5" /> {t("إيقاف الحساب", "Suspend")}</>
                  }
                </button>
              </div>
            </div>

            {/* FB + WA */}
            {d.facebook && (
              <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
                <h4 className="text-sm font-semibold flex items-center gap-2"><Facebook className="h-4 w-4 text-blue-500" /> Facebook</h4>
                <div className="text-xs space-y-1">
                  <div><span className="text-muted-foreground">Name:</span> {d.facebook.fb_user_name ?? "—"}</div>
                  <div className="flex items-center gap-1"><Mail className="h-3 w-3 text-muted-foreground" />{d.facebook.fb_user_email ?? "—"}</div>
                </div>
              </div>
            )}

            {d.whatsapp_sessions.length > 0 && (
              <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
                <h4 className="text-sm font-semibold flex items-center gap-2"><MessageCircle className="h-4 w-4 text-emerald-500" /> WhatsApp</h4>
                {d.whatsapp_sessions.map((s) => (
                  <div key={s.id} className="text-xs flex items-center justify-between border-t border-border pt-2 first:border-0 first:pt-0">
                    <span>{s.phone_number ?? s.session_id}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${s.status === "connected" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}>{s.status}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Recent campaigns */}
            {d.campaigns.length > 0 && (
              <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
                <h4 className="text-sm font-semibold">{t("آخر الحملات", "Recent Campaigns")}</h4>
                {d.campaigns.slice(0, 5).map((c) => (
                  <div key={c.id} className="flex items-center justify-between text-xs border-t border-border pt-2 first:border-0 first:pt-0">
                    <span className="truncate">{c.name}</span>
                    <span className="text-muted-foreground">{c.status}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Danger zone */}
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-3">
              <h4 className="text-sm font-semibold text-destructive flex items-center gap-2"><Trash2 className="h-4 w-4" /> {t("منطقة الخطر", "Danger Zone")}</h4>
              <button
                onClick={() => {
                  if (confirm(t("متأكد من حذف هذا الحساب؟ لا يمكن التراجع.", "Delete this account? Cannot be undone."))) {
                    deleteMut.mutate();
                  }
                }}
                disabled={deleteMut.isPending}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-destructive text-destructive-foreground hover:opacity-90 disabled:opacity-50"
              >
                {deleteMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                {t("حذف الحساب نهائياً", "Permanently delete account")}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </>
  );
}

function EditableRow({
  label, value, editing, setEditing, onSave, pending, type = "text",
}: {
  label: string;
  value: string;
  editing: string | null;
  setEditing: (v: string | null) => void;
  onSave: (v: string) => void;
  pending: boolean;
  type?: string;
}) {
  const isEditing = editing !== null;
  return (
    <div>
      <div className="text-[11px] text-muted-foreground mb-1">{label}</div>
      {isEditing ? (
        <div className="flex gap-2">
          <input
            type={type}
            value={editing}
            onChange={(e) => setEditing(e.target.value)}
            className="flex-1 px-3 py-1.5 rounded-lg bg-background border border-border text-sm focus:outline-none focus:border-primary"
          />
          <button
            onClick={() => { onSave(editing!); setEditing(null); }}
            disabled={pending}
            className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "✓"}
          </button>
          <button onClick={() => setEditing(null)} className="px-2 py-1.5 rounded-lg border border-border text-xs hover:bg-muted">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm truncate flex-1">{value || <span className="text-muted-foreground italic">—</span>}</span>
          <button onClick={() => setEditing(value)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition">
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-muted/40 border border-border p-3 text-center">
      <div className="text-lg font-bold">{value}</div>
      <div className="text-[10px] text-muted-foreground truncate">{label}</div>
    </div>
  );
}
