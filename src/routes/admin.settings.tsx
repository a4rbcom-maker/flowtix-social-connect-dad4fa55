import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "framer-motion";
import { Save, Loader2, Settings as SettingsIcon, AlertTriangle, Bot, UserPlus, Package } from "lucide-react";
import { toast } from "sonner";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { useI18n } from "@/lib/i18n";
import { getPlatformSettings, updatePlatformSetting } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/settings")({ ssr: false, component: SettingsPage });

const PLANS = ["free", "starter", "pro", "business", "enterprise"];
const MODELS = [
  "google/gemini-2.5-flash",
  "google/gemini-2.5-flash-lite",
  "google/gemini-2.5-pro",
  "openai/gpt-5-mini",
  "openai/gpt-5",
  "openai/gpt-5-nano",
];

const META: Record<string, { icon: typeof SettingsIcon; type: "bool" | "plan" | "model"; ar: string; en: string; descAr: string; descEn: string }> = {
  maintenance_mode: { icon: AlertTriangle, type: "bool", ar: "وضع الصيانة", en: "Maintenance Mode", descAr: "إيقاف الوصول لكل المستخدمين عدا الأدمن", descEn: "Disable access for non-admin users" },
  signup_enabled: { icon: UserPlus, type: "bool", ar: "السماح بالتسجيل", en: "Signups Enabled", descAr: "السماح بإنشاء حسابات جديدة", descEn: "Allow new account registrations" },
  default_plan: { icon: Package, type: "plan", ar: "الباقة الافتراضية", en: "Default Plan", descAr: "الباقة المُعيَّنة تلقائياً لكل مستخدم جديد", descEn: "Plan auto-assigned to new users" },
  default_ai_model: { icon: Bot, type: "model", ar: "نموذج الذكاء الافتراضي", en: "Default AI Model", descAr: "النموذج المستخدم عند عدم تحديد اختيار", descEn: "Model used when no override is set" },
};

function SettingsPage() {
  const { lang, dir } = useI18n();
  const qc = useQueryClient();
  const fetchSettings = useServerFn(getPlatformSettings);
  const updateFn = useServerFn(updatePlatformSetting);

  const { data, isLoading } = useQuery({ queryKey: ["admin", "settings"], queryFn: () => fetchSettings() });

  const [local, setLocal] = useState<Record<string, unknown>>({});
  useEffect(() => {
    if (data?.rows) {
      const next: Record<string, unknown> = {};
      for (const r of data.rows) next[r.key] = r.value;
      setLocal(next);
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: (vars: { key: string; value: unknown }) => updateFn({ data: vars }),
    onSuccess: (_, vars) => {
      toast.success(lang === "ar" ? `تم حفظ ${META[vars.key]?.ar ?? vars.key}` : `Saved ${META[vars.key]?.en ?? vars.key}`);
      qc.invalidateQueries({ queryKey: ["admin", "settings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return <AdminLayout title={lang === "ar" ? "الإعدادات" : "Settings"}><div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div></AdminLayout>;
  }

  return (
    <AdminLayout title={lang === "ar" ? "إعدادات النظام" : "Platform Settings"}>
      <div dir={dir} className="space-y-6 max-w-4xl">
        <p className="text-sm text-muted-foreground">{lang === "ar" ? "تتحكم هذه الإعدادات في سلوك المنصة لكل المستخدمين." : "These settings control platform-wide behavior for all users."}</p>

        <div className="grid gap-4">
          {(data?.rows ?? []).map((row, i) => {
            const meta = META[row.key] ?? { icon: SettingsIcon, type: "bool" as const, ar: row.key, en: row.key, descAr: row.description ?? "", descEn: row.description ?? "" };
            const Icon = meta.icon;
            const value = local[row.key];
            const isDirty = JSON.stringify(value) !== JSON.stringify(row.value);

            return (
              <motion.div
                key={row.key}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="rounded-2xl border border-border bg-card/70 backdrop-blur-xl p-6 shadow-lg"
              >
                <div className="flex items-start gap-4">
                  <div className="rounded-xl bg-primary/10 p-3"><Icon className="h-5 w-5 text-primary" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div>
                        <h3 className="font-bold text-lg">{lang === "ar" ? meta.ar : meta.en}</h3>
                        <p className="text-xs text-muted-foreground mt-1">{lang === "ar" ? meta.descAr : meta.descEn}</p>
                        <code className="text-[10px] text-muted-foreground/70 font-mono mt-2 inline-block">{row.key}</code>
                      </div>
                      <div className="flex items-center gap-2">
                        {meta.type === "bool" && (
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={value === true}
                              onChange={(e) => setLocal((p) => ({ ...p, [row.key]: e.target.checked }))}
                              className="sr-only peer"
                            />
                            <div className="w-12 h-7 bg-muted peer-checked:bg-primary rounded-full transition-colors relative after:content-[''] after:absolute after:top-0.5 after:start-0.5 after:bg-white after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:after:translate-x-5 rtl:peer-checked:after:-translate-x-5" />
                          </label>
                        )}
                        {meta.type === "plan" && (
                          <select
                            value={String(value ?? "")}
                            onChange={(e) => setLocal((p) => ({ ...p, [row.key]: e.target.value }))}
                            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
                          >
                            {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
                          </select>
                        )}
                        {meta.type === "model" && (
                          <select
                            value={String(value ?? "")}
                            onChange={(e) => setLocal((p) => ({ ...p, [row.key]: e.target.value }))}
                            className="rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
                          >
                            {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
                          </select>
                        )}
                        <button
                          disabled={!isDirty || mutation.isPending}
                          onClick={() => mutation.mutate({ key: row.key, value })}
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition"
                        >
                          {mutation.isPending && mutation.variables?.key === row.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                          {lang === "ar" ? "حفظ" : "Save"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </AdminLayout>
  );
}
