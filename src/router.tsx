import { createRouter, useRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { normalizeServerFnError } from "@/lib/server-fn-error";

function DefaultErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  const router = useRouter();

  // A raw `Response` (from server-fn auth middleware / redirects) or an
  // unusual object would otherwise stringify to "[object Response]" and the
  // page appears blank. Normalize into title/message before rendering.
  const normalized = normalizeServerFnError(error);
  // Log the original cause for developers without leaking it to the UI.
  if (typeof console !== "undefined") {
    // eslint-disable-next-line no-console
    console.error("[router:error]", normalized.code, normalized.status, error);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-8 w-8 text-destructive"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{normalized.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{normalized.message}</p>
        {normalized.status ? (
          <p className="mt-1 text-xs text-muted-foreground/70">HTTP {normalized.status}</p>
        ) : null}
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            إعادة المحاولة
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            الصفحة الرئيسية
          </a>
        </div>
      </div>
    </div>
  );
}

export const getRouter = () => {
  const router = createRouter({
    routeTree,
    context: {},
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: DefaultErrorComponent,
  });

  return router;
};
