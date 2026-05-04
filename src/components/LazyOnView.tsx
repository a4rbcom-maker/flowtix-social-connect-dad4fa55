import { useEffect, useRef, useState, Suspense, type ReactNode } from "react";

interface LazyOnViewProps {
  children: ReactNode;
  /** How far before entering viewport to start mounting (px) */
  rootMargin?: string;
  /** Reserved height to prevent layout shift before mount */
  minHeight?: number | string;
  fallback?: ReactNode;
}

/**
 * Mounts children only when the placeholder enters (or nears) the viewport.
 * Combined with React.lazy this triggers chunk download + render on demand.
 */
export function LazyOnView({
  children,
  rootMargin = "400px",
  minHeight = 200,
  fallback = null,
}: LazyOnViewProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || show) return;

    if (typeof IntersectionObserver === "undefined") {
      setShow(true);
      return;
    }

    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShow(true);
          obs.disconnect();
        }
      },
      { rootMargin }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [rootMargin, show]);

  return (
    <div ref={ref} className="cv-auto" style={!show ? { minHeight } : { contentVisibility: "auto" }}>
      {show ? <Suspense fallback={fallback}>{children}</Suspense> : fallback}
    </div>
  );
}
