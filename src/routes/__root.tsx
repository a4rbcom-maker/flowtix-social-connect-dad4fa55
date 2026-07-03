import { Outlet, Link, createRootRoute, HeadContent, Scripts, useRouter } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Toaster } from "sonner";
import { I18nProvider } from "@/lib/i18n";
import { ThemeProvider } from "@/lib/theme";
import { AuthProvider } from "@/lib/auth";
import { NotificationsProvider } from "@/hooks/useSendNotifications";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GlobalAnnouncements } from "@/components/dashboard/GlobalAnnouncements";
import { UserPreferencesSync } from "@/components/shared/UserPreferencesSync";
import { installStaleChunkReload, staleChunkReloadInlineScript } from "@/lib/stale-chunk-reload";
import { useTrackVisit } from "@/hooks/useTrackVisit";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function RootErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  const isArabic = typeof document !== "undefined" && document.documentElement.dir === "rtl";

  console.error(error);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4" dir={isArabic ? "rtl" : "ltr"}>
      <div className="max-w-md text-center">
        <h1 className="text-3xl font-bold text-foreground">{isArabic ? "حدث خطأ مؤقت" : "Something went wrong"}</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {isArabic ? "أعد تحميل الصفحة أو ارجع للوحة التحكم." : "Refresh the page or go back to the dashboard."}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {isArabic ? "إعادة المحاولة" : "Try again"}
          </button>
          <Link
            to="/dashboard"
            className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {isArabic ? "لوحة التحكم" : "Dashboard"}
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Flowtix Tools — أقوى منصة للتجارة الاجتماعية" },
      { name: "description", content: "أدر أعمالك على فيسبوك وواتساب بذكاء — إرسال جماعي، بوت واتساب، ذكاء اصطناعي من مكان واحد" },
      { name: "author", content: "Flowtix Tools" },
      { property: "og:title", content: "Flowtix Tools — Social Commerce Platform" },
      { property: "og:description", content: "Manage Facebook Groups & WhatsApp Bot from one powerful platform" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },

      // DNS + TLS warmup for third-party origins
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "dns-prefetch", href: "https://fonts.googleapis.com" },
      { rel: "dns-prefetch", href: "https://fonts.gstatic.com" },

      // Critical fonts — preload as style for instant text rendering
      { rel: "preload", as: "style", href: "https://fonts.googleapis.com/css2?family=Cairo:wght@500;700;800&family=Inter:wght@500;700;800&display=swap" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Cairo:wght@500;700;800&family=Inter:wght@500;700;800&display=swap" },

      // LCP image — preload above-the-fold logo with high priority
      { rel: "preload", as: "image", href: "/flowtix-logo.webp", type: "image/webp", fetchPriority: "high" } as any,

      // Favicon
      { rel: "icon", type: "image/webp", href: "/flowtix-logo.webp" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  errorComponent: RootErrorComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar">
      <head>
        <HeadContent />
      </head>
      <body style={{ fontFamily: "'Cairo', 'Inter', sans-serif" }}>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('flowtix-theme');if(t==='dark')document.documentElement.classList.add('dark')}catch(e){}})()`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: staleChunkReloadInlineScript,
          }}
        />
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
        },
      }),
  );
  useEffect(() => {
    installStaleChunkReload();
  }, []);
  // Track viewport to tune toast stacking on small screens (avoid covering key UI).
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 640px)");
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  useTrackVisit(typeof window !== "undefined" ? window.location.pathname : "/");
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <I18nProvider>
          <AuthProvider>
            <NotificationsProvider>
              <TooltipProvider delayDuration={200}>
                <UserPreferencesSync />
                <Outlet />
                <GlobalAnnouncements />
                <Toaster
                  position={isMobile ? "top-center" : "top-center"}
                  richColors
                  closeButton
                  expand={!isMobile}
                  visibleToasts={isMobile ? 2 : 4}
                  gap={isMobile ? 6 : 10}
                  offset={isMobile ? 8 : 20}
                  mobileOffset={8}
                  duration={isMobile ? 3500 : 4500}
                  toastOptions={{
                    className: "flowtix-toast",
                    style: {
                      fontFamily: "'Cairo', 'Inter', sans-serif",
                      fontSize: "0.95rem",
                      fontWeight: 500,
                      letterSpacing: "0.01em",
                    },
                    classNames: {
                      toast: "flowtix-toast-root",
                      title: "flowtix-toast-title",
                      description: "flowtix-toast-desc",
                      actionButton: "flowtix-toast-action",
                      cancelButton: "flowtix-toast-cancel",
                      closeButton: "flowtix-toast-close",
                    },
                  }}
                />
              </TooltipProvider>
            </NotificationsProvider>
          </AuthProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
