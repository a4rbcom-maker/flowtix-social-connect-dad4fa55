import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  Star,
  StarOff,
  Eye,
  EyeOff,
  ArrowUp,
  ArrowDown,
  Package,
  Loader2,
  X,
  Save,
  GripVertical,
} from "lucide-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin/plans")({
  ssr: false,
  component: AdminPlansPage,
});

type PlanRow = {
  id: string;
  slug: string;
  name_ar: string;
  name_en: string;
  description_ar: string | null;
  description_en: string | null;
  price: number;
  currency: string;
  billing_period: string;
  credits: number;
  features_ar: string[];
  features_en: string[];
  limits: Record<string, unknown>;
  is_active: boolean;
  is_popular: boolean;
  sort_order: number;
};

function AdminPlansPage() {
  const { lang } = useI18n();
  const t = (ar: string, en: string) => (lang === "ar" ? ar : en);
  const qc = useQueryClient();
  const [editing, setEditing] = useState<PlanRow | null>(null);
  const [isNew, setIsNew] = useState(false);

  const listQ = useQuery({
    queryKey: ["admin", "plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plans" as never)
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as PlanRow[];
    },
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "plans"] });
  const refreshPublic = () => qc.invalidateQueries({ queryKey: ["public", "plans"] });

  const toggleActive = useMutation({
    mutationFn: async (p: PlanRow) => {
      const { error } = await supabase
        .from("plans" as never)
        .update({ is_active: !p.is_active } as never)
        .eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("تم التحديث", "Updated"));
      refresh();
      refreshPublic();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const togglePopular = useMutation({
    mutationFn: async (p: PlanRow) => {
      const { error } = await supabase
        .from("plans" as never)
        .update({ is_popular: !p.is_popular } as never)
        .eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("تم التحديث", "Updated"));
      refresh();
      refreshPublic();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reorder = useMutation({
    mutationFn: async ({ id, direction }: { id: string; direction: "up" | "down" }) => {
      const rows = listQ.data ?? [];
      const idx = rows.findIndex((r) => r.id === id);
      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      if (idx < 0 || swapIdx < 0 || swapIdx >= rows.length) return;
      const a = rows[idx];
      const b = rows[swapIdx];
      const { error: e1 } = await supabase
        .from("plans" as never)
        .update({ sort_order: b.sort_order } as never)
        .eq("id", a.id);
      const { error: e2 } = await supabase
        .from("plans" as never)
        .update({ sort_order: a.sort_order } as never)
        .eq("id", b.id);
      if (e1 || e2) throw e1 || e2;
    },
    onSuccess: () => {
      refresh();
      refreshPublic();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("plans" as never).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("تم حذف الباقة", "Plan deleted"));
      refresh();
      refreshPublic();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = listQ.data ?? [];

  return (
    <AdminLayout title={t("الباقات والأسعار", "Plans & Pricing")}>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              {t("إدارة الباقات", "Manage Plans")}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {t(
                "أي تغيير هنا ينعكس مباشرة على صفحة الهبوط ولوحة العميل.",
                "Changes here sync immediately with the landing page and client dashboard.",
              )}
            </p>
          </div>
          <button
            onClick={() => {
              setIsNew(true);
              setEditing(emptyPlan(rows.length));
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition"
          >
            <Plus className="h-4 w-4" />
            {t("باقة جديدة", "New Plan")}
          </button>
        </div>

        {listQ.isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : listQ.error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {(listQ.error as Error).message}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-10 text-center">
            <Package className="mx-auto h-12 w-12 text-muted-foreground/50" />
            <p className="mt-3 text-sm text-muted-foreground">
              {t("لا توجد باقات بعد. أضف باقة جديدة لتبدأ.", "No plans yet. Add a new plan to start.")}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((p, i) => (
              <motion.div
                key={p.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={`relative rounded-2xl border bg-card p-5 shadow-sm transition ${
                  p.is_popular ? "border-primary/50 ring-1 ring-primary/20" : "border-border"
                } ${!p.is_active ? "opacity-60" : ""}`}
              >
                <div className="absolute top-3 end-3 flex items-center gap-1">
                  <button
                    title={t("نقل للأعلى", "Move up")}
                    disabled={i === 0 || reorder.isPending}
                    onClick={() => reorder.mutate({ id: p.id, direction: "up" })}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    title={t("نقل للأسفل", "Move down")}
                    disabled={i === rows.length - 1 || reorder.isPending}
                    onClick={() => reorder.mutate({ id: p.id, direction: "down" })}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="flex items-start gap-2 mb-4">
                  <GripVertical className="h-4 w-4 text-muted-foreground mt-1" />
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-lg">{lang === "ar" ? p.name_ar : p.name_en}</h3>
                      {p.is_popular && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                          {t("الأكثر طلباً", "Popular")}
                        </span>
                      )}
                      {!p.is_active && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                          {t("معطّلة", "Disabled")}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{p.slug}</p>
                  </div>
                </div>

                <div className="flex items-baseline gap-1 mb-3">
                  <span className="text-3xl font-extrabold">{Number(p.price).toLocaleString()}</span>
                  <span className="text-sm text-muted-foreground">
                    {p.currency} / {p.billing_period === "yearly" ? t("سنوياً", "yearly") : t("شهرياً", "monthly")}
                  </span>
                </div>

                <div className="text-sm text-muted-foreground mb-3">
                  <span className="font-semibold text-foreground">{p.credits.toLocaleString()}</span> {t("كريدت", "credits")}
                </div>

                <ul className="space-y-1.5 text-sm mb-4">
                  {(lang === "ar" ? p.features_ar : p.features_en).slice(0, 5).map((f, fi) => (
                    <li key={fi} className="text-muted-foreground line-clamp-1">
                      • {f}
                    </li>
                  ))}
                  {(lang === "ar" ? p.features_ar : p.features_en).length > 5 && (
                    <li className="text-xs text-muted-foreground/70">
                      +{(lang === "ar" ? p.features_ar : p.features_en).length - 5} {t("ميزة أخرى", "more")}
                    </li>
                  )}
                </ul>

                <div className="flex items-center gap-2 pt-3 border-t border-border">
                  <button
                    onClick={() => {
                      setIsNew(false);
                      setEditing(p);
                    }}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium hover:bg-muted transition"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    {t("تعديل", "Edit")}
                  </button>
                  <button
                    onClick={() => toggleActive.mutate(p)}
                    title={p.is_active ? t("تعطيل", "Disable") : t("تفعيل", "Enable")}
                    className="rounded-lg border border-border bg-background p-2 hover:bg-muted transition"
                  >
                    {p.is_active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    onClick={() => togglePopular.mutate(p)}
                    title={p.is_popular ? t("إلغاء التميز", "Unmark popular") : t("تمييز", "Mark popular")}
                    className="rounded-lg border border-border bg-background p-2 hover:bg-muted transition"
                  >
                    {p.is_popular ? <Star className="h-3.5 w-3.5 fill-primary text-primary" /> : <StarOff className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(t(`حذف باقة "${p.name_ar}"؟`, `Delete plan "${p.name_en}"?`))) {
                        remove.mutate(p.id);
                      }
                    }}
                    title={t("حذف", "Delete")}
                    className="rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-destructive hover:bg-destructive/10 transition"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {editing && (
          <PlanEditor
            plan={editing}
            isNew={isNew}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              refresh();
              refreshPublic();
            }}
          />
        )}
      </AnimatePresence>
    </AdminLayout>
  );
}

function emptyPlan(existingCount: number): PlanRow {
  return {
    id: "",
    slug: "",
    name_ar: "",
    name_en: "",
    description_ar: "",
    description_en: "",
    price: 0,
    currency: "SAR",
    billing_period: "monthly",
    credits: 0,
    features_ar: [],
    features_en: [],
    limits: {},
    is_active: true,
    is_popular: false,
    sort_order: (existingCount + 1) * 10,
  };
}

function PlanEditor({
  plan,
  isNew,
  onClose,
  onSaved,
}: {
  plan: PlanRow;
  isNew: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { lang } = useI18n();
  const t = (ar: string, en: string) => (lang === "ar" ? ar : en);
  const [form, setForm] = useState<PlanRow>(plan);
  const [featuresArText, setFeaturesArText] = useState(plan.features_ar.join("\n"));
  const [featuresEnText, setFeaturesEnText] = useState(plan.features_en.join("\n"));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        slug: form.slug.trim(),
        name_ar: form.name_ar.trim(),
        name_en: form.name_en.trim(),
        description_ar: form.description_ar ?? "",
        description_en: form.description_en ?? "",
        price: Number(form.price) || 0,
        currency: form.currency.trim() || "SAR",
        billing_period: form.billing_period,
        credits: Math.max(0, Math.floor(Number(form.credits) || 0)),
        features_ar: featuresArText.split("\n").map((s) => s.trim()).filter(Boolean),
        features_en: featuresEnText.split("\n").map((s) => s.trim()).filter(Boolean),
        is_active: form.is_active,
        is_popular: form.is_popular,
        sort_order: Math.floor(Number(form.sort_order) || 0),
      };

      if (!payload.slug || !payload.name_ar || !payload.name_en) {
        toast.error(t("المعرف والاسم بالعربية والإنجليزية مطلوبة", "Slug and both names are required"));
        setSaving(false);
        return;
      }

      if (isNew) {
        const { error } = await supabase.from("plans" as never).insert(payload as never);
        if (error) throw error;
        toast.success(t("تمت إضافة الباقة", "Plan created"));
      } else {
        const { error } = await supabase
          .from("plans" as never)
          .update(payload as never)
          .eq("id", plan.id);
        if (error) throw error;
        toast.success(t("تم حفظ التعديلات", "Plan saved"));
      }
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-start sm:items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-2xl border border-border bg-card shadow-2xl my-8"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h3 className="font-bold text-lg">{isNew ? t("باقة جديدة", "New Plan") : t("تعديل الباقة", "Edit Plan")}</h3>
          <button onClick={onClose} className="rounded-md p-1.5 hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("المعرف (slug)", "Slug")} required>
              <input
                type="text"
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                placeholder="pro"
                className={inputCls}
              />
            </Field>
            <Field label={t("ترتيب العرض", "Sort order")}>
              <input
                type="number"
                value={form.sort_order}
                onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
                className={inputCls}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("الاسم بالعربية", "Name (Arabic)")} required>
              <input type="text" value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} className={inputCls} />
            </Field>
            <Field label={t("الاسم بالإنجليزية", "Name (English)")} required>
              <input type="text" value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} className={inputCls} />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label={t("السعر", "Price")}>
              <input type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} className={inputCls} />
            </Field>
            <Field label={t("العملة", "Currency")}>
              <input type="text" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className={inputCls} />
            </Field>
            <Field label={t("الفترة", "Billing")}>
              <select value={form.billing_period} onChange={(e) => setForm({ ...form, billing_period: e.target.value })} className={inputCls}>
                <option value="monthly">{t("شهري", "Monthly")}</option>
                <option value="yearly">{t("سنوي", "Yearly")}</option>
                <option value="lifetime">{t("مدى الحياة", "Lifetime")}</option>
              </select>
            </Field>
          </div>

          <Field label={t("عدد الكريدت", "Credits")}>
            <input type="number" value={form.credits} onChange={(e) => setForm({ ...form, credits: Number(e.target.value) })} className={inputCls} />
          </Field>

          <Field label={t("المميزات بالعربية (ميزة في كل سطر)", "Features Arabic (one per line)")}>
            <textarea
              rows={5}
              value={featuresArText}
              onChange={(e) => setFeaturesArText(e.target.value)}
              className={inputCls + " font-mono text-xs"}
              dir="rtl"
            />
          </Field>

          <Field label={t("المميزات بالإنجليزية (ميزة في كل سطر)", "Features English (one per line)")}>
            <textarea
              rows={5}
              value={featuresEnText}
              onChange={(e) => setFeaturesEnText(e.target.value)}
              className={inputCls + " font-mono text-xs"}
              dir="ltr"
            />
          </Field>

          <div className="flex items-center gap-6 pt-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                className="h-4 w-4 rounded border-border accent-primary"
              />
              {t("مفعّلة", "Active")}
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_popular}
                onChange={(e) => setForm({ ...form, is_popular: e.target.checked })}
                className="h-4 w-4 rounded border-border accent-primary"
              />
              {t("الأكثر طلباً", "Popular")}
            </label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
          <button onClick={onClose} className="rounded-lg border border-border bg-background px-4 py-2 text-sm hover:bg-muted">
            {t("إلغاء", "Cancel")}
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {t("حفظ", "Save")}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

const inputCls = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-muted-foreground mb-1.5">
        {label} {required && <span className="text-destructive">*</span>}
      </span>
      {children}
    </label>
  );
}
