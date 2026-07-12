import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  Plus, Trash2, Pencil, Save, X, FileText, Loader2, Image as ImageIcon,
  Film, Upload, Check,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import {
  listTextTemplates,
  saveTextTemplate,
  deleteTextTemplate,
  listMediaAssets,
  recordMediaAsset,
} from "@/lib/fb-campaigns.functions";
import { safeArray } from "@/lib/safe-data";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/dashboard/facebook/templates")({
  ssr: false,
  component: TemplatesPage,
  errorComponent: ({ error, reset }) => (
    <DashboardLayout title="القوالب النصية">
      <div className="mx-auto mt-12 max-w-xl rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center">
        <p className="text-lg font-semibold text-foreground">حدث خطأ في تحميل القوالب النصية</p>
        <pre className="mt-3 max-h-40 overflow-auto rounded-md bg-muted p-3 text-left font-mono text-xs text-destructive whitespace-pre-wrap break-words">{error?.message ?? "Unknown error"}</pre>
        <button onClick={reset} className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">إعادة المحاولة</button>
      </div>
    </DashboardLayout>
  ),
});

type Template = Tables<"fb_text_templates">;
type Media = Tables<"fb_media_assets">;
type EditingTemplate = Partial<Template> & { media_ids?: string[] };

function TemplatesPage() {
  const { user, loading } = useAuth();
  const { lang, dir } = useI18n();
  const navigate = useNavigate();
  const [items, setItems] = useState<Template[]>([]);
  const [media, setMedia] = useState<Media[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<EditingTemplate | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const t = lang === "ar"
    ? {
        title: "القوالب النصية",
        subtitle: "مكتبة منشورات قابلة لإعادة الاستخدام في حملاتك — نص + صور/فيديو",
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
        mediaLabel: "الوسائط المرفقة",
        mediaHint: "ارفع صورة/فيديو أو اختر من مكتبتك (حد أقصى 10 مرفقات)",
        upload: "رفع ملف",
        uploading: "جارٍ الرفع...",
        selectFromLibrary: "اختر من المكتبة",
        noMedia: "لا توجد وسائط في مكتبتك بعد",
        selected: "محدد",
        remove: "إزالة",
        tooLarge: "حجم الملف أكبر من 50MB",
        uploaded: "تم الرفع",
        maxReached: "الحد الأقصى 10 مرفقات",
      }
    : {
        title: "Text Templates",
        subtitle: "Reusable post library — text + photos/videos",
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
        mediaLabel: "Attached media",
        mediaHint: "Upload a photo/video or pick from your library (max 10)",
        upload: "Upload",
        uploading: "Uploading...",
        selectFromLibrary: "Pick from library",
        noMedia: "No media in your library yet",
        selected: "selected",
        remove: "Remove",
        tooLarge: "File exceeds 50MB",
        uploaded: "Uploaded",
        maxReached: "Max 10 attachments",
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
      const [tpls, mediaRows] = await Promise.all([
        callFn<unknown>(listTextTemplates as unknown as (opts: never) => Promise<unknown>),
        callFn<unknown>(listMediaAssets as unknown as (opts: never) => Promise<unknown>),
      ]);
      setItems(safeArray<Template>(tpls));
      setMedia(safeArray<Media>(mediaRows));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  useEffect(() => { if (user) load(); /* eslint-disable-next-line */ }, [user]);

  const currentMediaIds = new Set<string>(editing?.media_ids ?? []);

  const toggleMedia = (id: string) => {
    if (!editing) return;
    const next = new Set(currentMediaIds);
    if (next.has(id)) next.delete(id);
    else {
      if (next.size >= 10) { toast.error(t.maxReached); return; }
      next.add(id);
    }
    setEditing({ ...editing, media_ids: Array.from(next) });
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user || !editing) return;
    if (file.size > 50 * 1024 * 1024) { toast.error(t.tooLarge); return; }
    if (currentMediaIds.size >= 10) { toast.error(t.maxReached); return; }
    const kind: "image" | "video" = file.type.startsWith("video/") ? "video" : "image";
    setUploading(true);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
      const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
      const { error: upErr } = await supabase.storage.from("fb-media").upload(path, file, {
        contentType: file.type, upsert: false,
      });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("fb-media").getPublicUrl(path);
      const row = await callFn<Media>(recordMediaAsset, {
        kind, storagePath: path, publicUrl: pub.publicUrl,
        name: file.name, sizeBytes: file.size, mimeType: file.type,
      });
      setMedia((prev) => [row, ...prev]);
      setEditing({ ...editing, media_ids: [...(editing.media_ids ?? []), row.id] });
      toast.success(t.uploaded);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.name?.trim() || !editing.content?.trim()) return;
    setBusy(true);
    try {
      await callFn(saveTextTemplate, {
        id: editing.id,
        name: editing.name.trim(),
        content: editing.content.trim(),
        mediaIds: editing.media_ids ?? [],
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

  const openEditor = (tpl?: Template) => {
    if (tpl) {
      setEditing({ ...tpl, media_ids: (tpl.media_ids as string[] | null) ?? [] });
    } else {
      setEditing({ name: "", content: "", media_ids: [] });
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
            onClick={() => openEditor()}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90"
          >
            <Plus className="w-4 h-4" />
            {t.add}
          </button>
        </div>

        {editing && (
          <div className="rounded-2xl border border-border bg-card p-5 space-y-4 shadow-sm">
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

            {/* Media section */}
            <div className="rounded-xl border border-dashed border-border bg-background/50 p-4 space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                    <ImageIcon className="w-4 h-4" /> {t.mediaLabel}
                    <span className="ml-2 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[10px] font-bold">
                      {currentMediaIds.size}/10
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{t.mediaHint}</p>
                </div>
                <div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*,video/*"
                    onChange={handleUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading || currentMediaIds.size >= 10}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    {uploading ? t.uploading : t.upload}
                  </button>
                </div>
              </div>

              {/* Selected preview */}
              {currentMediaIds.size > 0 && (
                <div className="flex flex-wrap gap-2">
                  {media.filter((m) => currentMediaIds.has(m.id)).map((m) => (
                    <div key={m.id} className="relative group w-20 h-20 rounded-lg overflow-hidden border border-border bg-muted">
                      {m.kind === "video" ? (
                        <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground">
                          <Film className="w-6 h-6" />
                          <span className="text-[9px] mt-1 line-clamp-1 px-1">{m.name}</span>
                        </div>
                      ) : (
                        <img src={m.public_url} alt={m.name} className="w-full h-full object-cover" />
                      )}
                      <button
                        type="button"
                        onClick={() => toggleMedia(m.id)}
                        title={t.remove}
                        className="absolute top-1 right-1 rounded-full bg-black/70 text-white p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Library picker */}
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
                  {t.selectFromLibrary} ({media.length})
                </summary>
                <div className="mt-3">
                  {media.length === 0 ? (
                    <p className="text-muted-foreground text-center py-4">{t.noMedia}</p>
                  ) : (
                    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2 max-h-64 overflow-y-auto">
                      {media.map((m) => {
                        const on = currentMediaIds.has(m.id);
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => toggleMedia(m.id)}
                            className={`relative w-full aspect-square rounded-md overflow-hidden border-2 transition-all ${
                              on ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/50"
                            }`}
                          >
                            {m.kind === "video" ? (
                              <div className="w-full h-full flex items-center justify-center bg-muted text-muted-foreground">
                                <Film className="w-6 h-6" />
                              </div>
                            ) : (
                              <img src={m.public_url} alt={m.name} className="w-full h-full object-cover" />
                            )}
                            {on && (
                              <div className="absolute inset-0 bg-primary/40 flex items-center justify-center">
                                <Check className="w-5 h-5 text-white drop-shadow" />
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </details>
            </div>

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
            {items.map((tpl) => {
              const tplMediaIds = (tpl.media_ids as string[] | null) ?? [];
              const attached = media.filter((m) => tplMediaIds.includes(m.id));
              return (
                <div key={tpl.id} className="rounded-2xl border border-border bg-card p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="font-semibold text-foreground line-clamp-1">{tpl.name}</h3>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => openEditor(tpl)} className="p-1.5 rounded-md hover:bg-accent text-muted-foreground" title={t.edit}>
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDelete(tpl.id)} className="p-1.5 rounded-md hover:bg-destructive/10 text-destructive" title={t.delete}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-4 whitespace-pre-wrap">{tpl.content}</p>
                  {attached.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {attached.slice(0, 4).map((m) => (
                        <div key={m.id} className="w-10 h-10 rounded-md overflow-hidden border border-border bg-muted">
                          {m.kind === "video" ? (
                            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                              <Film className="w-4 h-4" />
                            </div>
                          ) : (
                            <img src={m.public_url} alt={m.name} className="w-full h-full object-cover" />
                          )}
                        </div>
                      ))}
                      {attached.length > 4 && (
                        <div className="w-10 h-10 rounded-md border border-border bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
                          +{attached.length - 4}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground/70">
                    <span>{tpl.content.length} {t.chars}</span>
                    {tplMediaIds.length > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <ImageIcon className="w-3 h-3" /> {tplMediaIds.length}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
