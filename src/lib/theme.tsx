import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "light" | "dark";
interface ThemeCtx {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
  mounted: boolean;
}
const Ctx = createContext<ThemeCtx>({
  theme: "light",
  toggleTheme: () => {},
  setTheme: () => {},
  mounted: false,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Always start "light" for SSR consistency
  const [theme, setThemeState] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);

  // On mount, read stored preference and apply
  useEffect(() => {
    const stored = localStorage.getItem("flowtix-theme") as Theme | null;
    const resolved = stored || "light";
    setThemeState(resolved);
    document.documentElement.classList.toggle("dark", resolved === "dark");
    setMounted(true);
  }, []);

  // Sync class + storage on subsequent changes
  useEffect(() => {
    if (!mounted) return;
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("flowtix-theme", theme);
  }, [theme, mounted]);

  const toggleTheme = () => setThemeState((t) => (t === "dark" ? "light" : "dark"));
  const setTheme = (t: Theme) => setThemeState(t);

  return <Ctx.Provider value={{ theme, toggleTheme, setTheme, mounted }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
