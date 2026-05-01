import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "light" | "dark";
interface ThemeCtx { theme: Theme; toggleTheme: () => void; mounted: boolean }
const Ctx = createContext<ThemeCtx>({ theme: "light", toggleTheme: () => {}, mounted: false });

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Always start "light" for SSR consistency
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  // On mount, read stored preference and apply
  useEffect(() => {
    const stored = localStorage.getItem("flowtix-theme") as Theme | null;
    const resolved = stored || "light";
    setTheme(resolved);
    document.documentElement.classList.toggle("dark", resolved === "dark");
    setMounted(true);
  }, []);

  // Sync class + storage on subsequent changes
  useEffect(() => {
    if (!mounted) return;
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("flowtix-theme", theme);
  }, [theme, mounted]);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  return <Ctx.Provider value={{ theme, toggleTheme, mounted }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
