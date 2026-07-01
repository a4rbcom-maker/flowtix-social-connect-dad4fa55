import { useEffect, useRef, useState } from "react";

/**
 * SmartAudio
 * ----------
 * WhatsApp voice notes arrive as OGG/Opus. Chrome/Firefox/Edge play them
 * natively, but Safari (desktop + iOS) refuses `audio/ogg; codecs=opus`.
 *
 * Server-side transcoding on Cloudflare Workers is not possible (no ffmpeg /
 * no native binaries), so we decode Opus in the browser using `opus-decoder`
 * (WASM) and wrap the PCM samples in a WAV container. The transcoded blob is
 * fed back into a plain <audio> element, guaranteeing playback everywhere.
 *
 * The heavy lifting only happens on browsers that can't play Opus. Chrome et
 * al. keep the direct stream (no decoding cost).
 */

type Props = {
  src: string;
  className?: string;
};

function browserCanPlayOpus(): boolean {
  if (typeof document === "undefined") return true;
  const el = document.createElement("audio");
  const a = el.canPlayType('audio/ogg; codecs="opus"');
  const b = el.canPlayType("audio/ogg");
  return Boolean(a || b);
}

function encodeWav(channels: Float32Array[], sampleRate: number): Blob {
  const numChannels = channels.length;
  const length = channels[0]?.length ?? 0;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, channels[c][i] ?? 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

async function transcodeOpusToWav(src: string): Promise<string> {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const { OggOpusDecoderWebWorker } = await import("opus-decoder");
  const decoder = new OggOpusDecoderWebWorker();
  await decoder.ready;
  try {
    const decoded = await decoder.decode(bytes);
    const channels = decoded.channelData as Float32Array[];
    const sampleRate = decoded.sampleRate;
    const blob = encodeWav(channels, sampleRate);
    return URL.createObjectURL(blob);
  } finally {
    decoder.free();
  }
}

export function SmartAudio({ src, className }: Props) {
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "converting" | "ready" | "error">("idle");
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResolvedSrc(null);
    setStatus("idle");

    if (browserCanPlayOpus()) {
      setResolvedSrc(src);
      setStatus("ready");
      return;
    }

    setStatus("converting");
    transcodeOpusToWav(src)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrlRef.current = url;
        setResolvedSrc(url);
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        // Fall back to the raw URL so the browser can at least try /
        // the user can still download it.
        setResolvedSrc(src);
        setStatus("error");
      });

    return () => {
      cancelled = true;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [src]);

  return (
    <div className="flex flex-col gap-1">
      {status === "converting" && (
        <span className="text-[10px] text-muted-foreground">
          جارٍ تحويل المقطع الصوتي لصيغة متوافقة…
        </span>
      )}
      <audio
        key={resolvedSrc ?? "loading"}
        controls
        preload="metadata"
        className={className}
        controlsList="nodownload noplaybackrate"
        src={resolvedSrc ?? undefined}
      >
        {resolvedSrc && (
          <>
            <source src={resolvedSrc} type="audio/wav" />
            <source src={resolvedSrc} type="audio/ogg; codecs=opus" />
            <source src={resolvedSrc} type="audio/ogg" />
            <source src={resolvedSrc} type="audio/mpeg" />
          </>
        )}
      </audio>
      {status === "error" && (
        <span className="text-[10px] text-destructive">
          تعذّر تحويل المقطع. جرّب التنزيل.
        </span>
      )}
    </div>
  );
}

export default SmartAudio;
