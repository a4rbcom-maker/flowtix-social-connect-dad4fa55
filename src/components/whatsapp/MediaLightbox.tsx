import * as React from "react";
import { createPortal } from "react-dom";
import { X, Download, ZoomIn, ZoomOut, RotateCw, ChevronLeft, ChevronRight } from "lucide-react";

export type MediaItem = {
  url: string;
  type: "image" | "video" | "audio" | "document" | "sticker";
  name?: string;
  mime?: string;
};

const EVT = "wa-media-open";

export function openMedia(item: MediaItem, list?: MediaItem[], index?: number) {
  window.dispatchEvent(
    new CustomEvent(EVT, { detail: { item, list: list ?? [item], index: index ?? 0 } }),
  );
}

export function MediaLightbox() {
  const [state, setState] = React.useState<{
    list: MediaItem[];
    index: number;
  } | null>(null);
  const [zoom, setZoom] = React.useState(1);
  const [rot, setRot] = React.useState(0);

  React.useEffect(() => {
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail as { list: MediaItem[]; index: number };
      setState({ list: d.list, index: d.index });
      setZoom(1);
      setRot(0);
    };
    window.addEventListener(EVT, handler);
    return () => window.removeEventListener(EVT, handler);
  }, []);

  React.useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setState(null);
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "+") setZoom((z) => Math.min(z + 0.25, 4));
      if (e.key === "-") setZoom((z) => Math.max(z - 0.25, 0.25));
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (!state) return null;
  const item = state.list[state.index];
  if (!item) return null;

  const next = () => {
    setState((s) => (s ? { ...s, index: Math.min(s.index + 1, s.list.length - 1) } : s));
    setZoom(1);
    setRot(0);
  };
  const prev = () => {
    setState((s) => (s ? { ...s, index: Math.max(s.index - 1, 0) } : s));
    setZoom(1);
    setRot(0);
  };

  const close = () => setState(null);
  const filename = item.name || item.url.split("/").pop()?.split("?")[0] || "download";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex flex-col bg-black/90 backdrop-blur-md"
      onClick={close}
    >
      {/* Toolbar */}
      <div
        className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0 flex-1 truncate text-sm font-medium text-white/90">
          {filename}
          {state.list.length > 1 && (
            <span className="ms-2 text-xs text-white/60">
              {state.index + 1} / {state.list.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {item.type === "image" && (
            <>
              <ToolBtn label="Zoom out" onClick={() => setZoom((z) => Math.max(z - 0.25, 0.25))}>
                <ZoomOut className="h-4 w-4" />
              </ToolBtn>
              <ToolBtn label="Zoom in" onClick={() => setZoom((z) => Math.min(z + 0.25, 4))}>
                <ZoomIn className="h-4 w-4" />
              </ToolBtn>
              <ToolBtn label="Rotate" onClick={() => setRot((r) => (r + 90) % 360)}>
                <RotateCw className="h-4 w-4" />
              </ToolBtn>
            </>
          )}
          <ToolBtn label="Download" asChild>
            <a href={item.url} download={filename} target="_blank" rel="noreferrer">
              <Download className="h-4 w-4" />
            </a>
          </ToolBtn>
          <ToolBtn label="Close" onClick={close}>
            <X className="h-5 w-5" />
          </ToolBtn>
        </div>
      </div>

      {/* Body */}
      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden p-4"
        onClick={close}
      >
        {state.list.length > 1 && state.index > 0 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              prev();
            }}
            className="absolute start-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
            aria-label="Previous"
          >
            <ChevronLeft className="h-5 w-5 rtl:rotate-180" />
          </button>
        )}
        {state.list.length > 1 && state.index < state.list.length - 1 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              next();
            }}
            className="absolute end-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
            aria-label="Next"
          >
            <ChevronRight className="h-5 w-5 rtl:rotate-180" />
          </button>
        )}

        <div
          className="flex max-h-full max-w-full items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          {item.type === "image" || item.type === "sticker" ? (
            <img
              src={item.url}
              alt={filename}
              style={{ transform: `scale(${zoom}) rotate(${rot}deg)`, transition: "transform .2s" }}
              className="max-h-[85vh] max-w-[90vw] select-none object-contain"
              draggable={false}
            />
          ) : item.type === "video" ? (
            <video
              src={item.url}
              controls
              autoPlay
              className="max-h-[85vh] max-w-[90vw] rounded-lg bg-black"
            />
          ) : item.type === "audio" ? (
            <div className="w-full max-w-md rounded-2xl bg-white/5 p-6">
              <p className="mb-3 truncate text-sm text-white/80">{filename}</p>
              <audio src={item.url} controls autoPlay className="w-full" />
            </div>
          ) : (
            <DocumentPreview url={item.url} mime={item.mime} name={filename} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ToolBtn({
  children,
  onClick,
  label,
  asChild,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  label: string;
  asChild?: boolean;
}) {
  const cls =
    "inline-flex h-9 w-9 items-center justify-center rounded-full text-white/90 transition hover:bg-white/15";
  if (asChild) {
    return (
      <span className={cls} title={label} aria-label={label}>
        {children}
      </span>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls} title={label} aria-label={label}>
      {children}
    </button>
  );
}

function DocumentPreview({ url, mime, name }: { url: string; mime?: string; name: string }) {
  const isPdf = mime?.includes("pdf") || /\.pdf($|\?)/i.test(url);
  if (isPdf) {
    return (
      <iframe
        src={url}
        title={name}
        className="h-[85vh] w-[90vw] rounded-lg border border-white/10 bg-white"
      />
    );
  }
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl bg-white/5 p-8 text-center text-white">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10">
        <Download className="h-8 w-8" />
      </div>
      <p className="break-all text-sm text-white/90">{name}</p>
      <a
        href={url}
        download={name}
        target="_blank"
        rel="noreferrer"
        className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
      >
        تحميل / Download
      </a>
    </div>
  );
}
