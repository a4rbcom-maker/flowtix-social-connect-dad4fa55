// Admin: full announcement management — create, edit, delete, preview, stats.
import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion, AnimatePresence } from "framer-motion";
import {
  Megaphone, Plus, Trash2, Loader2, Info, CheckCircle2, AlertTriangle, ShieldAlert,
  Bell, Wrench, Gift, Users, Package, UserCheck, User as UserIcon, UserX, UsersRound,
  Edit, Eye, BarChart3, X, Check, Clock,
} from "lucide-react";
import { toast } from "sonner";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useI18n } from "@/lib/i18n";
import {
  listAnnouncements, createAnnouncement, updateAnnouncement, deleteAnnouncement,
  listAdminUsers, getAnnouncementStats,
} from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/notifications")({ ssr: false, component: NotificationsPage });

const TYPES = [
  { v: "info", icon: Info, color: "text-sky-500 bg-sky-500/15", gradient: "from-sky-500 to-blue-600", ar: "معلومة", en: "Info" },
  { v: "success", icon: CheckCircle2, color: "text-emerald-500 bg-emerald-500/15", gradient: "from-emerald-500 to-teal-600", ar: "نجاح", en: "Success" },
  { v: "warning", icon: AlertTriangle, color: "text-amber-500 bg-amber-500/15", gradient: "from-amber-500 to-orange-600", ar: "تحذير", en: "Warning" },
  { v: "alert", icon: ShieldAlert, color: "text-rose-500 bg-rose-500/15", gradient: "from-rose-500 to-red-600", ar: "تنبيه", en: "Alert" },
  { v: "update", icon: Bell, color: "text-violet-500 bg-violet-500/15", gradient: "from-violet-500 to-purple-600", ar: "تحديث", en: "Update" },
  { v: "maintenance", icon: Wrench, color: "text-slate-500 bg-slate-500/15", gradient: "from-slate-500 to-zinc-700", ar: "صيانة", en: "Maintenance" },
  { v: "offer", icon: Gift, color: "text-fuchsia-500 bg-fuchsia-500/15", gradient: "from-fuchsia-500 to-pink-600", ar: "عرض", en: "Offer" },
] as const;

const PRIORITIES = [
  { v: "low", ar: "منخفضة", en: "Low", cls: "bg-muted text-muted-foreground" },
  { v: "normal", ar: "عادية", en: "Normal", cls: "bg-sky-500/15 text-sky-600" },
  { v: "high", ar: "عالية", en: "High", cls: "bg-amber-500/15 text-amber-600" },
  { v: "urgent", ar: "عاجلة", en: "Urgent", cls: "bg-rose-500/15 text-rose-600" },
] as const;

const TARGETS = [
  { v: "all", icon: Users, ar: "جميع المستخدمين", en: "All users" },
  { v: "plan", icon: Package, ar: "حسب الباقة", en: "By plan" },
  { v: "users", icon: UserCheck, ar: "مستخدمون محددون", en: "Specific users" },
  { v: "single_user", icon: UserIcon, ar: "مستخدم واحد", en: "Single user" },
  { v: "active_users", icon: UsersRound, ar: "المستخدمون النشطون", en: "Active users" },
  { v: "suspended_users", icon: UserX, ar: "موقوفون/محذرون", en: "Suspended/Warned" },
] as const;

const PLANS = ["free", "starter", "pro", "business", "enterprise"];

type AnnouncementRow = {
  id: string; title: string; body: string; level: string; notif_type: string; priority: string;
  require_ack: boolean; show_as_popup: boolean;
  target_kind: string; target_plan: string | null; target_user_ids: string[] | null;
  starts_at: string; ends_at: string | null; created_at: string;
};

const emptyForm = {
  title: "", body: "",
  level: "info" as "info" | "success" | "warning" | "error",
  notif_type: "info" as typeof TYPES[number]["v"],
  priority: "normal" as typeof PRIORITIES[number]["v"],
  require_ack: false,
  show_as_popup: true,
  target_kind: "all" as typeof TARGETS[number]["v"],
  target_plan: "free",
  target_user_ids: [] as string[],
  ends_at: "",
};

function NotificationsPage() {
  const { lang, dir } = useI18n();
  const qc = useQueryClient();
  const fetchFn = useServerFn(listAnnouncements);
  const createFn = useServerFn(createAnnouncement);
  const updateFn = useServerFn(updateAnnouncement);
  const deleteFn = useServerFn(deleteAnnouncement);
  const listUsersFn = useServerFn(listAdminUsers);
  const statsFn = useServerFn(getAnnouncementStats);

  const { data, isLoading } = useQuery({ queryKey: ["admin", "announcements"], queryFn: () => fetchFn() });
  const { data: usersData } = useQuery({ queryKey: ["admin", "users-mini"], queryFn: () => listUsersFn({ data: { search: "", limit: 500 } }) });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [form, setForm] = useState(emptyForm);
  const [userSearch, setUserSearch] = useState("");
  const [statsForId, setStatsForId] = useState<string | null>(null);

  const startCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
    setTab("edit");
  };
  const startEdit = (row: AnnouncementRow) => {
    setEditingId(row.id);
    setForm({
      title: row.title, body: row.body,
      level: row.level as never,
      notif_type: (row.notif_type as never) ?? "info",
      priority: (row.priority as never) ?? "normal",
      require_ack: !!row.require_ack,
      show_as_popup: row.show_as_popup ?? true,
      target_kind: (row.target_kind as never) ?? "all",
      target_plan: row.target_plan ?? "free",
      target_user_ids: row.target_user_ids ?? [],
      ends_at: row.ends_at ? new Date(row.ends_at).toISOString().slice(0, 16) : "",
    });
    setShowForm(true);
    setTab("edit");
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        title: form.title, body: form.body,
        level: form.level, notif_type: form.notif_type, priority: form.priority,
        require_ack: form.require_ack, show_as_popup: form.show_as_popup,
        target_kind: form.target_kind,
        target_plan: form.target_kind === "plan" ? form.target_plan : null,
        target_user_ids: (form.target_kind === "users" || form.target_kind === "single_user") ? form.target_user_ids : [],
        ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
      };
      if (editingId) return updateFn({ data: { id: editingId, ...payload } });
      return createFn({ data: payload });
    },
    onSuccess: () => {
      toast.success(lang === "ar" ? (editingId ? "تم التحديث" : "تم النشر") : (editingId ? "Updated" : "Published"));
      qc.invalidateQueries({ queryKey: ["admin", "announcements"] });
      setShowForm(false);
      setEditingId(null);
      setForm(emptyForm);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success(lang === "ar" ? "تم الحذف" : "Deleted");
      qc.invalidateQueries({ queryKey: ["admin", "announcements"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filteredUsers = useMemo(() => {
    type U = { id: string; full_name?: string | null };
    return ((usersData?.rows ?? []) as U[]).filter((u) =>
      !userSearch || u.full_name?.toLowerCase().includes(userSearch.toLowerCase()) || u.id.includes(userSearch),
    ).slice(0, 50);
  }, [usersData, userSearch]);

  const canSave =
    form.title.trim() && form.body.trim() &&
    !((form.target_kind === "users" || form.target_kind === "single_user") && form.target_user_ids.length === 0);

  return (
    <AdminLayout title={lang === "ar" ? "الإشعارات والإعلانات" : "Notifications"}>
      <div dir={dir} className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-sm text-muted-foreground">
            {lang === "ar"
              ? "أرسل إشعارات للمنصة بالكامل أو لشريحة محددة، وتابع حالة القراءة لكل إشعار."
              : "Broadcast notifications platform-wide or to specific segments, and track read state per recipient."}
          </p>
          <button onClick={startCreate} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition">
            <Plus className="h-4 w-4" /> {lang === "ar" ? "إشعار جديد" : "New notification"}
          </button>
        </div>

        <AnimatePresence>
          {showForm && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="rounded-2xl border border-border bg-card/70 backdrop-blur-xl p-6 space-y-4 overflow-hidden"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg flex items-center gap-2">
                  <Megaphone className="h-5 w-5 text-primary" />
                  {editingId ? (lang === "ar" ? "تعديل الإشعار" : "Edit Notification") : (lang === "ar" ? "إشعار جديد" : "New Notification")}
                </h3>
                <div className="flex gap-1 rounded-lg border border-border p-1">
                  {(["edit", "preview"] as const).map((t) => (
                    <button key={t} onClick={() => setTab(t)}
                      className={`rounded-md px-3 py-1 text-xs font-semibold transition ${tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}>
                      {t === "edit" ? (lang === "ar" ? "تحرير" : "Edit") : (
                        <span className="inline-flex items-center gap-1"><Eye className="h-3 w-3" />{lang === "ar" ? "معاينة" : "Preview"}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {tab === "edit" ? (
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold mb-1.5">{lang === "ar" ? "العنوان" : "Title"} *</label>
                    <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={200}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold mb-1.5">{lang === "ar" ? "النص" : "Body"} *</label>
                    <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} maxLength={4000} rows={3}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-y" />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold mb-1.5">{lang === "ar" ? "نوع الإشعار" : "Type"}</label>
                    <div className="flex gap-2 flex-wrap">
                      {TYPES.map((t) => (
                        <button key={t.v} type="button"
                          onClick={() => setForm({ ...form, notif_type: t.v, level: (t.v === "success" || t.v === "warning" || t.v === "info") ? t.v : "info" })}
                          className={`px-3 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition ${form.notif_type === t.v ? t.color + " ring-2 ring-current" : "bg-muted text-muted-foreground"}`}>
                          <t.icon className="h-3.5 w-3.5" /> {lang === "ar" ? t.ar : t.en}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold mb-1.5">{lang === "ar" ? "الأولوية" : "Priority"}</label>
                    <div className="flex gap-2 flex-wrap">
                      {PRIORITIES.map((p) => (
                        <button key={p.v} type="button" onClick={() => setForm({ ...form, priority: p.v })}
                          className={`px-3 py-2 rounded-lg text-xs font-semibold transition ${form.priority === p.v ? p.cls + " ring-2 ring-current" : "bg-muted text-muted-foreground"}`}>
                          {lang === "ar" ? p.ar : p.en}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="md:col-span-2 grid grid-cols-2 gap-4">
                    <label className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm cursor-pointer">
                      <input type="checkbox" checked={form.show_as_popup} onChange={(e) => setForm({ ...form, show_as_popup: e.target.checked })} />
                      <span>{lang === "ar" ? "إظهار كنافذة منبثقة" : "Show as popup modal"}</span>
                    </label>
                    <label className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm cursor-pointer">
                      <input type="checkbox" checked={form.require_ack} onChange={(e) => setForm({ ...form, require_ack: e.target.checked })} />
                      <span>{lang === "ar" ? "يتطلب تأكيد قراءة" : "Require read acknowledgment"}</span>
                    </label>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold mb-1.5">{lang === "ar" ? "تنتهي في (اختياري)" : "Ends at (optional)"}</label>
                    <input type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-xs font-semibold mb-1.5">{lang === "ar" ? "الجمهور المستهدف" : "Target audience"}</label>
                    <div className="flex gap-2 flex-wrap">
                      {TARGETS.map((t) => (
                        <button key={t.v} type="button" onClick={() => setForm({ ...form, target_kind: t.v, target_user_ids: t.v === "single_user" ? form.target_user_ids.slice(0, 1) : form.target_user_ids })}
                          className={`px-3 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition ${form.target_kind === t.v ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                          <t.icon className="h-3.5 w-3.5" /> {lang === "ar" ? t.ar : t.en}
                        </button>
                      ))}
                    </div>
                  </div>

                  {form.target_kind === "plan" && (
                    <div className="md:col-span-2">
                      <select value={form.target_plan} onChange={(e) => setForm({ ...form, target_plan: e.target.value })}
                        className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
                        {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                  )}

                  {(form.target_kind === "users" || form.target_kind === "single_user") && (
                    <div className="md:col-span-2 space-y-2">
                      <input value={userSearch} onChange={(e) => setUserSearch(e.target.value)}
                        placeholder={lang === "ar" ? "بحث عن مستخدم..." : "Search user..."}
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
                      <div className="max-h-48 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                        {filteredUsers.map((u) => (
                          <label key={u.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/40 cursor-pointer text-sm">
                            <input
                              type={form.target_kind === "single_user" ? "radio" : "checkbox"}
                              name="targetUser"
                              checked={form.target_user_ids.includes(u.id)}
                              onChange={(e) => {
                                if (form.target_kind === "single_user") {
                                  setForm({ ...form, target_user_ids: [u.id] });
                                } else {
                                  setForm({ ...form, target_user_ids: e.target.checked ? [...form.target_user_ids, u.id] : form.target_user_ids.filter((x) => x !== u.id) });
                                }
                              }} />
                            <span className="font-medium">{u.full_name ?? "—"}</span>
                            <span className="text-xs text-muted-foreground font-mono">{u.id.slice(0, 8)}</span>
                          </label>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">{lang === "ar" ? `محدد: ${form.target_user_ids.length}` : `Selected: ${form.target_user_ids.length}`}</p>
                    </div>
                  )}
                </div>
              ) : (
                <PreviewBlock form={form} lang={lang} />
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => { setShowForm(false); setEditingId(null); }}
                  className="px-4 py-2 rounded-lg border border-border text-sm font-semibold hover:bg-muted">
                  {lang === "ar" ? "إلغاء" : "Cancel"}
                </button>
                <button onClick={() => saveMut.mutate()} disabled={!canSave || saveMut.isPending}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-40 hover:bg-primary/90">
                  {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
                  {editingId ? (lang === "ar" ? "حفظ التعديلات" : "Save changes") : (lang === "ar" ? "نشر الإشعار" : "Publish")}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* List */}
        {isLoading ? (
          <div className="flex items-center justify-center h-40"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : (data?.rows.length === 0) ? (
          <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">
            <Megaphone className="h-10 w-10 mx-auto mb-3 opacity-40" />
            {lang === "ar" ? "لا توجد إشعارات بعد" : "No notifications yet"}
          </div>
        ) : (
          <div className="grid gap-3">
            {((data?.rows ?? []) as AnnouncementRow[]).map((row, i) => {
              const type = TYPES.find((t) => t.v === (row.notif_type ?? "info")) ?? TYPES[0];
              const prio = PRIORITIES.find((p) => p.v === (row.priority ?? "normal")) ?? PRIORITIES[1];
              const active = (!row.ends_at || new Date(row.ends_at) > new Date()) && new Date(row.starts_at) <= new Date();
              const tgt = TARGETS.find((t) => t.v === row.target_kind) ?? TARGETS[0];
              return (
                <motion.div key={row.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                  className="rounded-2xl border border-border bg-card/70 backdrop-blur-xl p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className={`rounded-lg p-2 ${type.color}`}><type.icon className="h-4 w-4" /></div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-bold">{row.title}</h4>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${prio.cls}`}>
                            {lang === "ar" ? prio.ar : prio.en}
                          </span>
                          {active ? (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600">{lang === "ar" ? "نشط" : "Active"}</span>
                          ) : (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{lang === "ar" ? "منتهي" : "Expired"}</span>
                          )}
                          {row.require_ack && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600">
                              {lang === "ar" ? "يتطلب تأكيد" : "Ack required"}
                            </span>
                          )}
                          {!row.show_as_popup && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                              {lang === "ar" ? "بدون مودال" : "No popup"}
                            </span>
                          )}
                          <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                            <tgt.icon className="h-3 w-3" />
                            {lang === "ar" ? tgt.ar : tgt.en}
                            {row.target_kind === "plan" && `: ${row.target_plan}`}
                            {(row.target_kind === "users" || row.target_kind === "single_user") && ` (${row.target_user_ids?.length ?? 0})`}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap line-clamp-3">{row.body}</p>
                        <div className="text-[10px] text-muted-foreground mt-2">
                          {new Date(row.created_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-US")}
                          {row.ends_at && ` • ${lang === "ar" ? "ينتهي:" : "ends:"} ${new Date(row.ends_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-US")}`}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setStatsForId(row.id)}
                        className="p-2 rounded-lg text-muted-foreground hover:bg-primary/10 hover:text-primary transition"
                        title={lang === "ar" ? "إحصائيات" : "Stats"}>
                        <BarChart3 className="h-4 w-4" />
                      </button>
                      <button onClick={() => startEdit(row)}
                        className="p-2 rounded-lg text-muted-foreground hover:bg-primary/10 hover:text-primary transition"
                        title={lang === "ar" ? "تعديل" : "Edit"}>
                        <Edit className="h-4 w-4" />
                      </button>
                      <button onClick={() => { if (confirm(lang === "ar" ? "حذف الإشعار؟" : "Delete this notification?")) deleteMut.mutate(row.id); }}
                        className="p-2 rounded-lg text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500 transition"
                        title={lang === "ar" ? "حذف" : "Delete"}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        {statsForId && (
          <StatsModal id={statsForId} statsFn={statsFn} onClose={() => setStatsForId(null)} lang={lang} dir={dir} />
        )}
      </div>
    </AdminLayout>
  );
}

function PreviewBlock({ form, lang }: { form: typeof emptyForm; lang: "ar" | "en" }) {
  const type = TYPES.find((t) => t.v === form.notif_type) ?? TYPES[0];
  const prio = PRIORITIES.find((p) => p.v === form.priority) ?? PRIORITIES[1];
  const Icon = type.icon;
  return (
    <div className="rounded-2xl border border-border bg-background/50 p-6">
      <p className="text-xs font-semibold text-muted-foreground mb-3">
        {lang === "ar" ? "كما سيظهر للمستخدم:" : "How users will see it:"}
      </p>
      <div className="mx-auto max-w-md overflow-hidden rounded-2xl border border-border/60 bg-card shadow-xl">
        <div className={`bg-gradient-to-br ${type.gradient} p-5 text-white`}>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-white/20 p-2"><Icon className="h-5 w-5" /></div>
            <div>
              <span className="text-xs font-semibold uppercase opacity-90">{lang === "ar" ? type.ar : type.en}</span>
              <span className={`ms-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${prio.cls}`}>{lang === "ar" ? prio.ar : prio.en}</span>
            </div>
          </div>
          <h3 className="mt-3 text-lg font-bold">{form.title || (lang === "ar" ? "العنوان…" : "Title…")}</h3>
        </div>
        <div className="p-5">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {form.body || (lang === "ar" ? "نص الإشعار سيظهر هنا…" : "Body text will appear here…")}
          </p>
          {form.require_ack && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>{lang === "ar" ? "يجب تأكيد قراءة هذا الإشعار قبل المتابعة." : "Confirmation required before continuing."}</span>
            </div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button className={`inline-flex items-center gap-1 rounded-lg bg-gradient-to-br ${type.gradient} px-3 py-1.5 text-xs font-bold text-white`}>
              <Check className="h-3 w-3" />
              {form.require_ack ? (lang === "ar" ? "أؤكد القراءة" : "Confirm reading") : (lang === "ar" ? "حسناً" : "Got it")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatsModal({ id, statsFn, onClose, lang, dir }: {
  id: string;
  statsFn: ReturnType<typeof useServerFn<typeof getAnnouncementStats>>;
  onClose: () => void;
  lang: "ar" | "en";
  dir: "rtl" | "ltr";
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["admin", "ann-stats", id],
    queryFn: () => statsFn({ data: { id } }),
  });

  const fmtSec = (s: number | null) => {
    if (s == null) return "—";
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.round(s / 60)}m`;
    return `${Math.round(s / 3600)}h`;
  };

  return (
    <div dir={dir} className="fixed inset-0 z-[90] flex items-center justify-center bg-background/80 backdrop-blur-md p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-2xl rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-border bg-gradient-to-br from-primary/5 to-transparent px-5 py-3">
          <h3 className="font-bold flex items-center gap-2"><BarChart3 className="h-5 w-5 text-primary" /> {lang === "ar" ? "إحصائيات الإشعار" : "Notification Stats"}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          {isLoading || !data ? (
            <div className="flex items-center justify-center h-40"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[
                  { label: lang === "ar" ? "الجمهور" : "Audience", value: data.audienceSize, color: "text-foreground" },
                  { label: lang === "ar" ? "وصل" : "Delivered", value: data.delivered, color: "text-sky-500" },
                  { label: lang === "ar" ? "فُتح" : "Opened", value: data.opened, color: "text-violet-500" },
                  { label: lang === "ar" ? "قُرئ" : "Read", value: data.read, color: "text-emerald-500" },
                  { label: lang === "ar" ? "أُكّد" : "Acked", value: data.acked, color: "text-amber-500" },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl border border-border bg-background/50 p-3 text-center">
                    <div className={`text-2xl font-black ${s.color}`}>{s.value}</div>
                    <div className="text-[10px] text-muted-foreground mt-1">{s.label}</div>
                  </div>
                ))}
              </div>
              <div className="rounded-xl border border-border bg-background/50 p-3 inline-flex items-center gap-2 text-sm">
                <Clock className="h-4 w-4 text-primary" />
                <span className="text-muted-foreground">{lang === "ar" ? "متوسط وقت القراءة:" : "Avg read latency:"}</span>
                <span className="font-bold">{fmtSec(data.avgReadLatency)}</span>
              </div>
              <div>
                <h4 className="text-sm font-semibold mb-2">{lang === "ar" ? "المستلمون" : "Recipients"}</h4>
                <div className="max-h-64 overflow-y-auto rounded-xl border border-border divide-y divide-border">
                  {data.readers.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-muted-foreground">{lang === "ar" ? "لا يوجد بعد" : "No reads yet"}</p>
                  ) : (
                    data.readers.map((r) => (
                      <div key={r.user_id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium truncate">{r.full_name ?? r.user_id.slice(0, 8)}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          {r.read_at ? <span className="text-emerald-500 inline-flex items-center gap-0.5"><CheckCircle2 className="h-3 w-3" />{lang === "ar" ? "قرأ" : "Read"}</span>
                            : r.opened_at ? <span className="text-violet-500">{lang === "ar" ? "فتح" : "Opened"}</span>
                            : <span>{lang === "ar" ? "وصل" : "Delivered"}</span>}
                          <span>{new Date(r.read_at ?? r.opened_at ?? r.delivered_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-US")}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
