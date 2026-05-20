import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Trash2, Pencil, Save, X, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import {
  listTextTemplates,
  saveTextTemplate,
  deleteTextTemplate,
} from "@/lib/fb-campaigns.functions";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/dashboard/facebook/templates")({
  ssr: false,
  component: TemplatesPage,
});

type Template = Tables<"fb_text_templates">;

function TemplatesPage() {
  const { user, loading } = useAuth();
  const { lang, dir } = useI18n();
  const navigate = useNavigate();
  const [items, setItems] = useState<Template[]>([]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Partial<Template> | null>(null);

  const t = lang === "ar"
    ? {
        title: "القوالب النصية",
        subtitle: "مكتبة منشورات قابلة لإعادة الاستخدام في حملاتك",
        add: "قالب جديد",
        empty: "لا توجد قوالب بعد. أضف أول قالب لإعادة استخدامه في الحملات.",
        name: "اسم القالب",
        content: "نص المنشور",
        save: "حفظ",
        cancel: "إلغاء",
        delete: "حذف",
        edit: "تعديل",
        confirmDelete: "حذف هذا القالب؟",
        saved: "تم الحفظ",
        deleted: "تم الحذف",
        chars: "حرف",
      }
    : {
        title: "Text Templates",
        subtitle: "Reusable post library for your campaigns",
        add: "New template",
        empty: "No templates yet. Add your first one to reuse it across campaigns.",
        name: "Template name",
        content: "Post content",
        save: "Save",
        cancel: "Cancel",
        delete: "Delete",
        edit: "Edit",
        confirmDelete: "Delete this template?",
        saved: "Saved",
        deleted: "Deleted",
        chars: "chars",
      };

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login" });
  }, [user, loading, navigate]);

  const callFn = async <T,>(fn: (opts: never) => Promise<T>, body?: unknown): Promise<T> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");
    return fn({ data: body, headers: { Authorization: `Bearer ${session.access_token}` } } as never);
  };

  const load = async () => {
    try {
      const rows = await callFn<Template[]>(listTextTemplates);
      setItems(rows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  useEffect(() => { if (user) load(); /* eslint-disable-next-line */ }, [user]);

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.name?.trim() || !editing.content?.trim()) return;
    setBusy(true);
    try {
      await callFn(saveTextTemplate, {
        id: editing.id,
        name: editing.name.trim(),
        content: editing.content.trim(),
      });
      toast.success(t.saved);
      setEditing(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t.confirmDelete)) return;
    try {
      await callFn(deleteTextTemplate, { id });
      toast.success(t.deleted);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  if (loading) return null;

  return (
    <DashboardLayout title={t.title}>
      <div dir={dir} className="space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-2xl font-bold text-foreground">{t.title}</h2>
            <p className="text-sm text-muted-foreground mt-1">{t.subtitle}</p>
          </div>
          <button
            onClick={() => setEditing({ name: "", content: "" })}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90"
          >
            <Plus className="w-4 h-4" />
            {t.add}
          </button>
        </div>

        {editing && (
          <div className="rounded-2xl border border-border bg-card p-5 space-y-3 shadow-sm">
            <input
              value={editing.name ?? ""}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder={t.name}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <textarea
              value={editing.content ?? ""}
              onChange={(e) => setEditing({ ...editing, content: e.target.value })}
              placeholder={t.content}
              rows={6}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-accent">
                <X className="w-4 h-4 inline -mt-0.5" /> {t.cancel}
              </button>
              <button
                onClick={handleSave}
                disabled={busy || !editing.name?.trim() || !editing.content?.trim()}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-4 h-4 inline animate-spin" /> : <Save className="w-4 h-4 inline -mt-0.5" />} {t.save}
              </button>
            </div>
          </div>
        )}

        {items.length === 0 && !editing ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
            <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
            {t.empty}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((tpl) => (
              <div key={tpl.id} className="rounded-2xl border border-border bg-card p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="font-semibold text-foreground line-clamp-1">{tpl.name}</h3>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => setEditing(tpl)} className="p-1.5 rounded-md hover:bg-accent text-muted-foreground" title={t.edit}>
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => handleDelete(tpl.id)} className="p-1.5 rounded-md hover:bg-destructive/10 text-destructive" title={t.delete}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-4 whitespace-pre-wrap">{tpl.content}</p>
                <div className="mt-3 text-[10px] text-muted-foreground/70">{tpl.content.length} {t.chars}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
