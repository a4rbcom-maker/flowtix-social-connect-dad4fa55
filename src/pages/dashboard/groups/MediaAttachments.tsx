import { useCallback, useRef, useState } from "react";
import { Paperclip, X, ImageIcon, Video, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";

/** Facebook's own ceiling for a composer attachment. */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;   // 10MB
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;  // 200MB
const MAX_FILES = 10;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];

export interface AttachedMedia {
  id: string;
  file: File;
  /** Object URL for the thumbnail; revoked on remove. */
  previewUrl: string;
  kind: "image" | "video";
}

interface Props {
  media: AttachedMedia[];
  onChange: (next: AttachedMedia[]) => void;
  disabled?: boolean;
}

function kindOf(file: File): "image" | "video" | null {
  if (IMAGE_TYPES.includes(file.type)) return "image";
  if (VIDEO_TYPES.includes(file.type)) return "video";
  return null;
}

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} ك.ب`;
  return `${(n / 1024 / 1024).toFixed(1)} م.ب`;
}

/**
 * Upload the job's attachments to the `publish-media` bucket.
 *
 * Uploads happen at submit time rather than on pick so an abandoned draft never
 * leaves orphaned files in storage. Files live under `<user_id>/<uuid>.<ext>`,
 * which is exactly what the bucket's RLS policy checks.
 */
export async function uploadPublishMedia(media: AttachedMedia[]): Promise<string[]> {
  if (media.length === 0) return [];

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId) throw new Error("يجب تسجيل الدخول لرفع المرفقات");

  const urls: string[] = [];
  for (const item of media) {
    const ext = (item.file.name.split(".").pop() || (item.kind === "video" ? "mp4" : "jpg")).toLowerCase();
    const objectPath = `${userId}/${crypto.randomUUID()}.${ext}`;

    const { error } = await supabase.storage
      .from("publish-media")
      .upload(objectPath, item.file, { contentType: item.file.type, upsert: false });
    if (error) throw new Error(`فشل رفع "${item.file.name}": ${error.message}`);

    // The bucket is private — the worker needs a URL it can fetch without a
    // user session, so hand it a long-lived signed URL.
    const { data: signed, error: signErr } = await supabase.storage
      .from("publish-media")
      .createSignedUrl(objectPath, 60 * 60 * 24 * 7);
    if (signErr || !signed?.signedUrl) {
      throw new Error(`تعذّر تجهيز رابط "${item.file.name}": ${signErr?.message ?? "unknown"}`);
    }
    urls.push(signed.signedUrl);
  }
  return urls;
}

export function MediaAttachments({ media, onChange, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      setError("");
      const incoming = Array.from(files);
      const accepted: AttachedMedia[] = [];
      const problems: string[] = [];

      const currentKind = media[0]?.kind;
      const kinds = new Set(media.map((m) => m.kind));

      for (const file of incoming) {
        const kind = kindOf(file);
        if (!kind) {
          problems.push(`"${file.name}": صيغة غير مدعومة (صور: JPG/PNG/GIF/WebP · فيديو: MP4/MOV/WebM)`);
          continue;
        }
        // Facebook cannot mix photos and videos in one post.
        if (kinds.size > 0 && !kinds.has(kind)) {
          problems.push(
            currentKind === "image"
              ? "لا يمكن خلط صور وفيديو في نفس المنشور — احذف الصور أولاً"
              : "لا يمكن خلط فيديو وصور في نفس المنشور — احذف الفيديو أولاً",
          );
          continue;
        }
        const limit = kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
        if (file.size > limit) {
          problems.push(`"${file.name}": الحجم ${formatBytes(file.size)} أكبر من الحد (${formatBytes(limit)})`);
          continue;
        }
        kinds.add(kind);
        accepted.push({
          id: crypto.randomUUID(),
          file,
          previewUrl: URL.createObjectURL(file),
          kind,
        });
      }

      const room = MAX_FILES - media.length;
      let next = [...media, ...accepted];
      if (next.length > MAX_FILES) {
        problems.push(`الحد الأقصى ${MAX_FILES} مرفقات — تم تجاهل ${next.length - MAX_FILES}`);
        next.slice(MAX_FILES).forEach((m) => URL.revokeObjectURL(m.previewUrl));
        next = next.slice(0, MAX_FILES);
      }
      void room;

      if (problems.length > 0) setError(problems.join(" · "));
      if (accepted.length > 0 || problems.length > 0) onChange(next);
    },
    [media, onChange],
  );

  const remove = (id: string) => {
    setError("");
    const target = media.find((m) => m.id === id);
    if (target) URL.revokeObjectURL(target.previewUrl);
    onChange(media.filter((m) => m.id !== id));
  };

  const clearAll = () => {
    setError("");
    media.forEach((m) => URL.revokeObjectURL(m.previewUrl));
    onChange([]);
  };

  const total = media.reduce((sum, m) => sum + m.file.size, 0);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--color-fg-muted)] uppercase tracking-wider">
          مرفقات المنشور
        </span>
        {media.length > 0 && (
          <button type="button" onClick={clearAll} disabled={disabled}
            className="text-[11px] text-[var(--color-fg-muted)] hover:text-[var(--color-error)] transition-colors">
            حذف الكل
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={[...IMAGE_TYPES, ...VIDEO_TYPES].join(",")}
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) addFiles(e.target.files);
          // Reset so re-picking the same file fires change again.
          e.target.value = "";
        }}
      />

      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled && e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
        }}
        className={cn(
          "w-full flex items-center justify-center gap-2.5 rounded-xl border-2 border-dashed px-4 py-4 text-sm transition-colors",
          dragging
            ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5 text-[var(--color-primary)]"
            : "border-[var(--color-border)] text-[var(--color-fg-muted)] hover:border-[var(--color-primary)]/50 hover:bg-[var(--color-surface-2)]",
          disabled && "opacity-50 cursor-not-allowed",
        )}
      >
        <Paperclip className="size-4" />
        <span>إرفاق صور أو فيديو</span>
        <span className="text-[11px] opacity-70">أو اسحب الملفات هنا</span>
      </button>

      <p className="text-[11px] text-[var(--color-fg-muted)] leading-relaxed">
        صور: JPG · PNG · GIF · WebP حتى 10 م.ب &nbsp;|&nbsp; فيديو: MP4 · MOV · WebM حتى 200 م.ب &nbsp;|&nbsp; حتى 10 ملفات
      </p>

      {media.length > 0 && (
        <>
          <div className="flex items-center gap-2 text-[11px] text-[var(--color-fg-muted)]">
            {media[0].kind === "image"
              ? <><ImageIcon className="size-3.5" /><span>{media.length} صورة</span></>
              : <><Video className="size-3.5" /><span>{media.length} فيديو</span></>}
            <span className="opacity-60">· {formatBytes(total)}</span>
          </div>

          <div className="grid grid-cols-4 gap-2">
            {media.map((m) => (
              <div key={m.id} className="relative group aspect-square rounded-lg overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface-2)]">
                {m.kind === "image" ? (
                  <img src={m.previewUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <video src={m.previewUrl} className="w-full h-full object-cover" muted playsInline />
                )}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors" />
                <button
                  type="button"
                  onClick={() => remove(m.id)}
                  disabled={disabled}
                  className="absolute top-1 right-1 size-5 rounded-full bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[var(--color-error)]"
                  aria-label={`حذف ${m.file.name}`}
                >
                  <X className="size-3" />
                </button>
                {m.kind === "video" && (
                  <div className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded bg-black/70 text-white text-[9px] flex items-center gap-1">
                    <Video className="size-2.5" /> فيديو
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {error && (
        <div className="flex items-start gap-2 text-[11px] text-[var(--color-error)] bg-[var(--color-error)]/5 px-3 py-2 rounded-lg border border-[var(--color-error)]/20">
          <AlertCircle className="size-3.5 shrink-0 mt-px" />
          <span className="leading-relaxed">{error}</span>
        </div>
      )}
    </div>
  );
}

/** Submit-time upload indicator, shown on the publish button while files upload. */
export function UploadingHint() {
  return (
    <span className="inline-flex items-center gap-2">
      <Loader2 className="size-4 animate-spin" /> جارٍ رفع المرفقات...
    </span>
  );
}