import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Upload, Trash2, Image as ImageIcon, Video, Loader2, Clock } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { listMediaAssets, recordMediaAsset, deleteMediaAsset } from "@/lib/fb-campaigns.functions";
import { safeArray } from "@/lib/safe-data";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/dashboard/facebook/media")({
  ssr: false,
  component: MediaPage,
  errorComponent: ({ error, reset }) => (
    <DashboardLayout title="مكتبة الوسائط">
      <div className="mx-auto mt-12 max-w-xl rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center">
        <p className="text-lg font-semibold text-foreground">حدث خطأ في تحميل مكتبة الوسائط</p>
        <pre className="mt-3 max-h-40 overflow-auto rounded-md bg-muted p-3 text-left font-mono text-xs text-destructive whitespace-pre-wrap break-words">{error?.message ?? "Unknown error"}</pre>
        <button onClick={reset} className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">إعادة المحاولة</button>
      </div>
    </DashboardLayout>
  ),
});

type Asset = Tables<"fb_media_assets">;

function MediaPage() {
  const { user, loading } = useAuth();
  const { lang, dir } = useI18n();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Asset[]>([]);
  const [uploading, setUploading] = useState(false);

  const RETENTION_DAYS = 15;
  const daysLeft = (createdAt: string) => {
    const ageMs = Date.now() - new Date(createdAt).getTime();
    return Math.max(0, RETENTION_DAYS - Math.floor(ageMs / (24 * 60 * 60 * 1000)));
  };

  const t = lang === "ar"
    ? {
        title: "مكتبة الوسائط",
        subtitle: "صور وفيديوهات تُستخدم في حملات النشر",
        upload: "رفع ملف",
        empty: "لا توجد وسائط بعد",
        delete: "حذف",
        confirmDelete: "حذف هذا الملف؟",
        uploaded: "تم الرفع",
        deleted: "تم الحذف",
        tooBig: "الملف كبير جداً (الحد الأقصى 50 ميجا)",
        retentionNotice: `تنبيه: يتم حذف جميع ملفات الوسائط تلقائيًا من الخادم بعد ${RETENTION_DAYS} يومًا من تاريخ الرفع لتوفير المساحة. احفظ نسخة محليًا إذا كنت بحاجة لها.`,
        daysLeft: (n: number) => (n === 0 ? "سيُحذف قريبًا" : `${n} يوم متبقي`),
      }
    : {
        title: "Media Library",
        subtitle: "Images and videos used in your campaigns",
        upload: "Upload file",
        empty: "No media yet",
        delete: "Delete",
        confirmDelete: "Delete this file?",
        uploaded: "Uploaded",
        deleted: "Deleted",
        tooBig: "File too large (max 50 MB)",
        retentionNotice: `Notice: all media is automatically deleted from the server ${RETENTION_DAYS} days after upload to save space. Keep a local copy if needed.`,
        daysLeft: (n: number) => (n === 0 ? "deleting soon" : `${n} day${n === 1 ? "" : "s"} left`),
      };

  useEffect(() => { if (!loading && !user) navigate({ to: "/login" }); }, [user, loading, navigate]);

  const callFn = async <T,>(fn: (opts: never) => Promise<T>, body?: unknown): Promise<T> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Not authenticated");
    return fn({ data: body, headers: { Authorization: `Bearer ${session.access_token}` } } as never);
  };

  const load = async () => {
    try { setItems(safeArray<Asset>(await callFn<unknown>(listMediaAssets as unknown as (opts: never) => Promise<unknown>))); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
  };

  useEffect(() => { if (user) load(); /* eslint-disable-next-line */ }, [user]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (file.size > 50 * 1024 * 1024) { toast.error(t.tooBig); return; }
    const kind: "image" | "video" = file.type.startsWith("video/") ? "video" : "image";
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || (kind === "video" ? "mp4" : "jpg");
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
      const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
      const { error: upErr } = await supabase.storage.from("fb-media").upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("fb-media").getPublicUrl(path);
      await callFn(recordMediaAsset, {
        kind,
        storagePath: path,
        publicUrl: pub.publicUrl,
        name: file.name,
        sizeBytes: file.size,
        mimeType: file.type,
      });
      toast.success(t.uploaded);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleDelete = async (a: Asset) => {
    if (!confirm(t.confirmDelete)) return;
    try {
      await callFn(deleteMediaAsset, { id: a.id });
      toast.success(t.deleted);
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
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
          <label className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90 cursor-pointer">
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {t.upload}
            <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleUpload} disabled={uploading} />
          </label>
        </div>

        <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
          <Clock className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{t.retentionNotice}</span>
        </div>

        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
            <ImageIcon className="w-10 h-10 mx-auto mb-3 opacity-40" />
            {t.empty}
          </div>
        ) : (
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((a) => {
              const left = daysLeft(a.created_at);
              return (
              <div key={a.id} className="group relative rounded-xl border border-border bg-card overflow-hidden hover:shadow-md transition-shadow">
                <div className="aspect-square bg-muted flex items-center justify-center overflow-hidden">
                  {a.kind === "image" ? (
                    <img src={a.public_url} alt={a.name} className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex flex-col items-center text-muted-foreground">
                      <Video className="w-10 h-10" />
                      <span className="text-xs mt-1">Video</span>
                    </div>
                  )}
                </div>
                <div className="p-2">
                  <p className="text-xs text-foreground line-clamp-1">{a.name}</p>
                  <div className="flex items-center justify-between gap-1 mt-0.5">
                    <p className="text-[10px] text-muted-foreground">{(a.size_bytes / 1024).toFixed(0)} KB</p>
                    <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${left <= 3 ? "text-destructive" : "text-muted-foreground"}`}>
                      <Clock className="w-3 h-3" /> {t.daysLeft(left)}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(a)}
                  className="absolute top-1.5 end-1.5 p-1.5 rounded-md bg-background/90 border border-border opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:bg-destructive/10"
                  title={t.delete}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
