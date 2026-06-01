import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion, AnimatePresence } from "framer-motion";
import { Megaphone, Plus, Trash2, Loader2, Info, CheckCircle2, AlertTriangle, XCircle, Users, Package, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useI18n } from "@/lib/i18n";
import { listAnnouncements, createAnnouncement, deleteAnnouncement, listAdminUsers } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/notifications")({ ssr: false, component: NotificationsPage });

const LEVELS = [
  { value: "info", icon: Info, color: "text-sky-500 bg-sky-500/15", ar: "معلومة", en: "Info" },
  { value: "success", icon: CheckCircle2, color: "text-emerald-500 bg-emerald-500/15", ar: "نجاح", en: "Success" },
  { value: "warning", icon: AlertTriangle, color: "text-amber-500 bg-amber-500/15", ar: "تحذير", en: "Warning" },
  { value: "error", icon: XCircle, color: "text-rose-500 bg-rose-500/15", ar: "خطأ", en: "Error" },
] as const;

const PLANS = ["free", "starter", "pro", "business", "enterprise"];

function NotificationsPage() {
  const { lang, dir } = useI18n();
  const qc = useQueryClient();
  const fetchFn = useServerFn(listAnnouncements);
  const createFn = useServerFn(createAnnouncement);
  const deleteFn = useServerFn(deleteAnnouncement);
  const listUsersFn = useServerFn(listAdminUsers);

  const { data, isLoading } = useQuery({ queryKey: ["admin", "announcements"], queryFn: () => fetchFn() });
  const { data: usersData } = useQuery({ queryKey: ["admin", "users-mini"], queryFn: () => listUsersFn({ data: { search: "", limit: 200 } }) });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    title: "", body: "", level: "info" as const,
    target_kind: "all" as "all" | "plan" | "users",
    target_plan: "free",
    target_user_ids: [] as string[],
    ends_at: "",
  });
  const [userSearch, setUserSearch] = useState("");

  const createMut = useMutation({
    mutationFn: () => createFn({ data: {
      title: form.title, body: form.body, level: form.level,
      target_kind: form.target_kind,
      target_plan: form.target_kind === "plan" ? form.target_plan : null,
      target_user_ids: form.target_kind === "users" ? form.target_user_ids : [],
      ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
    } }),
    onSuccess: () => {
      toast.success(lang === "ar" ? "تم نشر الإعلان" : "Announcement published");
      qc.invalidateQueries({ queryKey: ["admin", "announcements"] });
      setShowForm(false);
      setForm({ title: "", body: "", level: "info", target_kind: "all", target_plan: "free", target_user_ids: [], ends_at: "" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => { toast.success(lang === "ar" ? "تم الحذف" : "Deleted"); qc.invalidateQueries({ queryKey: ["admin", "announcements"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const filteredUsers = (usersData?.rows ?? []).filter((u: any) =>
    !userSearch || u.full_name?.toLowerCase().includes(userSearch.toLowerCase()),
  ).slice(0, 50);

  return (
    <AdminLayout title={lang === "ar" ? "الإشعارات والإعلانات" : "Announcements"}>
      <div dir={dir} className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-sm text-muted-foreground">{lang === "ar" ? "أرسل إعلانات للمنصة بالكامل أو لشريحة محددة من المستخدمين." : "Broadcast announcements platform-wide or target specific user segments."}</p>
          <button onClick={() => setShowForm((v) => !v)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition">
            <Plus className="h-4 w-4" /> {lang === "ar" ? "إعلان جديد" : "New announcement"}
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
              <h3 className="font-bold text-lg flex items-center gap-2"><Megaphone className="h-5 w-5 text-primary" /> {lang === "ar" ? "إعلان جديد" : "New Announcement"}</h3>

              <div className="grid md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold mb-1.5">{lang === "ar" ? "العنوان" : "Title"} *</label>
                  <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={200} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold mb-1.5">{lang === "ar" ? "النص" : "Body"} *</label>
                  <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} maxLength={4000} rows={3} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm resize-y" />
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1.5">{lang === "ar" ? "المستوى" : "Level"}</label>
                  <div className="flex gap-2 flex-wrap">
                    {LEVELS.map((l) => (
                      <button key={l.value} type="button" onClick={() => setForm({ ...form, level: l.value as never })}
                        className={`px-3 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition ${form.level === l.value ? l.color + " ring-2 ring-current" : "bg-muted text-muted-foreground"}`}>
                        <l.icon className="h-3.5 w-3.5" /> {lang === "ar" ? l.ar : l.en}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold mb-1.5">{lang === "ar" ? "تنتهي في (اختياري)" : "Ends At (optional)"}</label>
                  <input type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold mb-1.5">{lang === "ar" ? "الجمهور المستهدف" : "Target audience"}</label>
                  <div className="flex gap-2 flex-wrap">
                    {[
                      { v: "all", icon: Users, ar: "جميع المستخدمين", en: "All users" },
                      { v: "plan", icon: Package, ar: "حسب الباقة", en: "By plan" },
                      { v: "users", icon: UserCheck, ar: "مستخدمون محددون", en: "Specific users" },
                    ].map((t) => (
                      <button key={t.v} type="button" onClick={() => setForm({ ...form, target_kind: t.v as never })}
                        className={`px-3 py-2 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition ${form.target_kind === t.v ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                        <t.icon className="h-3.5 w-3.5" /> {lang === "ar" ? t.ar : t.en}
                      </button>
                    ))}
                  </div>
                </div>

                {form.target_kind === "plan" && (
                  <div className="md:col-span-2">
                    <select value={form.target_plan} onChange={(e) => setForm({ ...form, target_plan: e.target.value })} className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
                      {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                )}

                {form.target_kind === "users" && (
                  <div className="md:col-span-2 space-y-2">
                    <input value={userSearch} onChange={(e) => setUserSearch(e.target.value)} placeholder={lang === "ar" ? "بحث عن مستخدم..." : "Search user..."} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
                    <div className="max-h-48 overflow-y-auto rounded-lg border border-border divide-y divide-border">
                      {filteredUsers.map((u: any) => (
                        <label key={u.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/40 cursor-pointer text-sm">
                          <input type="checkbox" checked={form.target_user_ids.includes(u.id)} onChange={(e) => {
                            setForm({ ...form, target_user_ids: e.target.checked ? [...form.target_user_ids, u.id] : form.target_user_ids.filter((x) => x !== u.id) });
                          }} />
                          <span className="font-medium">{u.full_name ?? "—"}</span>
                          <span className="text-xs text-muted-foreground">{u.email}</span>
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">{lang === "ar" ? `محدد: ${form.target_user_ids.length}` : `Selected: ${form.target_user_ids.length}`}</p>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg border border-border text-sm font-semibold hover:bg-muted">
                  {lang === "ar" ? "إلغاء" : "Cancel"}
                </button>
                <button
                  onClick={() => createMut.mutate()}
                  disabled={!form.title || !form.body || createMut.isPending || (form.target_kind === "users" && form.target_user_ids.length === 0)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-40 hover:bg-primary/90"
                >
                  {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
                  {lang === "ar" ? "نشر الإعلان" : "Publish"}
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
            {lang === "ar" ? "لا توجد إعلانات بعد" : "No announcements yet"}
          </div>
        ) : (
          <div className="grid gap-3">
            {data?.rows.map((row: any, i: number) => {
              const level = LEVELS.find((l) => l.value === row.level) ?? LEVELS[0];
              const active = (!row.ends_at || new Date(row.ends_at) > new Date()) && new Date(row.starts_at) <= new Date();
              return (
                <motion.div key={row.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                  className="rounded-2xl border border-border bg-card/70 backdrop-blur-xl p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className={`rounded-lg p-2 ${level.color}`}><level.icon className="h-4 w-4" /></div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-bold">{row.title}</h4>
                          {active ? (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600">{lang === "ar" ? "نشط" : "Active"}</span>
                          ) : (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{lang === "ar" ? "منتهي" : "Expired"}</span>
                          )}
                          <span className="text-[10px] text-muted-foreground">
                            {row.target_kind === "all" ? (lang === "ar" ? "الجميع" : "Everyone") :
                             row.target_kind === "plan" ? `${lang === "ar" ? "باقة" : "Plan"}: ${row.target_plan}` :
                             `${row.target_user_ids?.length ?? 0} ${lang === "ar" ? "مستخدم" : "users"}`}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{row.body}</p>
                        <div className="text-[10px] text-muted-foreground mt-2">
                          {new Date(row.created_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-US")}
                          {row.ends_at && ` • ${lang === "ar" ? "ينتهي:" : "ends:"} ${new Date(row.ends_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-US")}`}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => { if (confirm(lang === "ar" ? "حذف الإعلان؟" : "Delete this announcement?")) deleteMut.mutate(row.id); }}
                      className="p-2 rounded-lg text-muted-foreground hover:bg-rose-500/10 hover:text-rose-500 transition"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
