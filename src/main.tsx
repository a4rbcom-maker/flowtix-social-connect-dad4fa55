import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { ThemeProvider } from "@/lib/theme";
import { AuthProvider } from "@/lib/authProvider";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { ToastContainer } from "@/components/ui/toast";
import "@/i18n";
import "@/index.css";
import { AppRouter } from "@/routes";

// Force RTL direction BEFORE React renders, so Tailwind RTL utilities
// are active from the first paint. This prevents the "Arabic content
// but LTR sidebar" flash that requires a language toggle to fix.
const storedLang = localStorage.getItem("flowtix_lang") || "ar";
const dir = storedLang === "en" ? "ltr" : "rtl";
document.documentElement.dir = dir;
document.documentElement.lang = storedLang === "en" ? "en" : "ar";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HelmetProvider>
      <ErrorBoundary>
        <ThemeProvider>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <AppRouter />
              <ToastContainer />
            </AuthProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </ErrorBoundary>
    </HelmetProvider>
  </StrictMode>,
);
