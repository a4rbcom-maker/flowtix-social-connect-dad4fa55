import { useEffect, useRef, useState } from "react";

export function useInView(options?: IntersectionObserverInit) {
  const ref = useRef<HTMLDivElement>(null);
  const [isInView, setIsInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.unobserve(el);
        }
      },
      { threshold: 0.15, ...options }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, isInView };
}

/**
 * Mouse parallax — coalesced via rAF, disabled on touch / small screens
 * and respects prefers-reduced-motion. Returns {x,y} that updates at most
 * once per animation frame to prevent re-render storms.
 */
export function useMouseParallax(intensity = 0.02) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Skip on small screens / touch / reduced-motion
    const isTouch = window.matchMedia("(hover: none)").matches;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const small = window.innerWidth < 768;
    if (isTouch || reduced || small) return;

    let rafId = 0;
    let pendingX = 0;
    let pendingY = 0;
    let scheduled = false;

    const flush = () => {
      scheduled = false;
      setOffset({ x: pendingX, y: pendingY });
    };

    const handler = (e: MouseEvent) => {
      pendingX = (e.clientX - window.innerWidth / 2) * intensity;
      pendingY = (e.clientY - window.innerHeight / 2) * intensity;
      if (!scheduled) {
        scheduled = true;
        rafId = requestAnimationFrame(flush);
      }
    };
    window.addEventListener("mousemove", handler, { passive: true });
    return () => {
      window.removeEventListener("mousemove", handler);
      cancelAnimationFrame(rafId);
    };
  }, [intensity]);

  return offset;
}

/**
 * Scroll progress — coalesced via rAF, only updates when value actually changes.
 */
export function useScrollProgress() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let rafId = 0;
    let scheduled = false;
    let last = 0;

    const flush = () => {
      scheduled = false;
      const h = document.documentElement.scrollHeight - window.innerHeight;
      const p = h > 0 ? window.scrollY / h : 0;
      const rounded = Math.round(p * 1000) / 1000;
      if (rounded !== last) {
        last = rounded;
        setProgress(rounded);
      }
    };

    const handler = () => {
      if (!scheduled) {
        scheduled = true;
        rafId = requestAnimationFrame(flush);
      }
    };
    window.addEventListener("scroll", handler, { passive: true });
    return () => {
      window.removeEventListener("scroll", handler);
      cancelAnimationFrame(rafId);
    };
  }, []);

  return progress;
}

/**
 * Scroll-driven CSS variables. Only runs while element is near viewport
 * to avoid wasted RAF cycles on long pages.
 */
export function useScrollParallax() {
  const containerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (typeof window === "undefined") return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    let rafId = 0;
    let active = true;
    let currentY = 0;
    const lerp = 0.12;

    const tick = () => {
      if (!active) return;
      const targetY = window.scrollY;
      currentY += (targetY - currentY) * lerp;
      const y = Math.round(currentY * 100) / 100;
      const fade = Math.max(0, Math.round((1 - y / 600) * 1000) / 1000);
      const bob = Math.round(Math.sin(y * 0.008) * 3 * 100) / 100;
      el.style.setProperty("--scroll-y", `${y}`);
      el.style.setProperty("--scroll-fade", `${fade}`);
      el.style.setProperty("--scroll-bob", `${bob}px`);
      rafId = requestAnimationFrame(tick);
    };

    // Only run RAF while hero is on/near screen
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (!rafId) {
            active = true;
            rafId = requestAnimationFrame(tick);
          }
        } else {
          active = false;
          cancelAnimationFrame(rafId);
          rafId = 0;
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);

    return () => {
      active = false;
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, []);

  return containerRef;
}
