import { useState, useEffect } from "react";
import { ArrowUp } from "lucide-react";

export function ScrollToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function onScroll() {
      setVisible(window.scrollY > 300);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className="fixed bottom-6 end-6 z-50 flex size-11 items-center justify-center rounded-full gradient-brand text-white shadow-[var(--shadow-lg)] transition-all duration-300 hover:scale-110 hover:shadow-[var(--shadow-xl)] animate-[fade-in_0.3s_ease-out]"
      aria-label="Scroll to top"
    >
      <ArrowUp className="size-5" />
    </button>
  );
}
