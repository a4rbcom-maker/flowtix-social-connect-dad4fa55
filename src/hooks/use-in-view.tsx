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

export function useMouseParallax(intensity = 0.02) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const x = (e.clientX - window.innerWidth / 2) * intensity;
      const y = (e.clientY - window.innerHeight / 2) * intensity;
      setOffset({ x, y });
    };
    window.addEventListener("mousemove", handler, { passive: true });
    return () => window.removeEventListener("mousemove", handler);
  }, [intensity]);

  return offset;
}

export function useScrollProgress() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const handler = () => {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(h > 0 ? window.scrollY / h : 0);
    };
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return progress;
}

/**
 * Smooth scroll-driven values applied via CSS custom properties
 * on a container ref — zero React re-renders on scroll.
 */
export function useScrollParallax() {
  const containerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let rafId = 0;
    let currentY = 0;
    let targetY = 0;

    // Lerp factor: lower = smoother (0.08 is buttery)
    const lerp = 0.08;

    const tick = () => {
      targetY = window.scrollY;
      currentY += (targetY - currentY) * lerp;

      // Round to 2 decimals to reduce style recalcs
      const y = Math.round(currentY * 100) / 100;
      const fade = Math.max(0, Math.round((1 - y / 600) * 1000) / 1000);
      const bob = Math.round(Math.sin(y * 0.008) * 3 * 100) / 100;

      el.style.setProperty("--scroll-y", `${y}`);
      el.style.setProperty("--scroll-fade", `${fade}`);
      el.style.setProperty("--scroll-bob", `${bob}px`);

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return containerRef;
}
