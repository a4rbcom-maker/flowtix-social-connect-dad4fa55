import { cn } from "@/lib/utils";

/**
 * Premium shimmer skeleton — branded violet tint, respects reduced motion.
 */
export function Skeleton({
  className,
  rounded = "rounded-xl",
}: {
  className?: string;
  rounded?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden bg-primary/5",
        rounded,
        "before:absolute before:inset-0 before:-translate-x-full before:animate-[skeleton-shimmer_1.6s_ease-in-out_infinite]",
        "before:bg-gradient-to-r before:from-transparent before:via-primary/10 before:to-transparent",
        "motion-reduce:before:animate-none",
        className
      )}
      aria-hidden
    />
  );
}

/* ---------- Section-specific skeletons ---------- */

export function TrustedBySkeleton() {
  return (
    <section className="py-10">
      <div className="mx-auto max-w-7xl px-4">
        <Skeleton className="mx-auto mb-6 h-4 w-48" rounded="rounded-full" />
        <div className="flex flex-wrap items-center justify-center gap-x-12 gap-y-6 opacity-70">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-24" rounded="rounded-md" />
          ))}
        </div>
      </div>
    </section>
  );
}

export function StatsStripSkeleton() {
  return (
    <section className="py-12">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border/40 bg-card/50 p-6">
            <Skeleton className="mb-3 h-8 w-20" rounded="rounded-lg" />
            <Skeleton className="h-3 w-28" rounded="rounded-md" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function CardsGridSkeleton({ count = 6, title = true }: { count?: number; title?: boolean }) {
  return (
    <section className="py-20">
      <div className="mx-auto max-w-7xl px-4">
        {title && (
          <div className="mb-12 text-center">
            <Skeleton className="mx-auto mb-4 h-8 w-64" rounded="rounded-lg" />
            <Skeleton className="mx-auto h-4 w-96 max-w-full" rounded="rounded-md" />
          </div>
        )}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: count }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border/40 bg-card/50 p-6">
              <Skeleton className="mb-4 h-12 w-12" rounded="rounded-xl" />
              <Skeleton className="mb-3 h-5 w-3/4" rounded="rounded-md" />
              <Skeleton className="mb-2 h-3 w-full" rounded="rounded-md" />
              <Skeleton className="h-3 w-5/6" rounded="rounded-md" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function PricingSkeleton() {
  return (
    <section className="py-20">
      <div className="mx-auto max-w-7xl px-4">
        <div className="mb-12 text-center">
          <Skeleton className="mx-auto mb-4 h-8 w-56" rounded="rounded-lg" />
          <Skeleton className="mx-auto h-4 w-80 max-w-full" rounded="rounded-md" />
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border/40 bg-card/50 p-8">
              <Skeleton className="mb-3 h-5 w-24" rounded="rounded-md" />
              <Skeleton className="mb-6 h-10 w-32" rounded="rounded-lg" />
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, j) => (
                  <Skeleton key={j} className="h-3 w-full" rounded="rounded-md" />
                ))}
              </div>
              <Skeleton className="mt-8 h-10 w-full" rounded="rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function TestimonialsSkeleton() {
  return (
    <section className="py-20">
      <div className="mx-auto max-w-5xl px-4">
        <div className="mb-12 text-center">
          <Skeleton className="mx-auto mb-4 h-8 w-64" rounded="rounded-lg" />
          <Skeleton className="mx-auto h-4 w-72 max-w-full" rounded="rounded-md" />
        </div>
        <div className="rounded-2xl border border-border/40 bg-card/50 p-10">
          <Skeleton className="mb-4 h-4 w-32" rounded="rounded-md" />
          <Skeleton className="mb-3 h-5 w-full" rounded="rounded-md" />
          <Skeleton className="mb-3 h-5 w-11/12" rounded="rounded-md" />
          <Skeleton className="mb-8 h-5 w-2/3" rounded="rounded-md" />
          <div className="flex items-center gap-4">
            <Skeleton className="h-12 w-12" rounded="rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-32" rounded="rounded-md" />
              <Skeleton className="h-3 w-24" rounded="rounded-md" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function FAQSkeleton() {
  return (
    <section className="py-20">
      <div className="mx-auto max-w-3xl px-4">
        <div className="mb-10 text-center">
          <Skeleton className="mx-auto mb-3 h-8 w-48" rounded="rounded-lg" />
          <Skeleton className="mx-auto h-4 w-64" rounded="rounded-md" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" rounded="rounded-xl" />
          ))}
        </div>
      </div>
    </section>
  );
}

export function CTASkeleton() {
  return (
    <section className="py-20">
      <div className="mx-auto max-w-4xl px-4">
        <div className="rounded-3xl border border-border/40 bg-card/50 p-12 text-center">
          <Skeleton className="mx-auto mb-4 h-8 w-80 max-w-full" rounded="rounded-lg" />
          <Skeleton className="mx-auto mb-8 h-4 w-96 max-w-full" rounded="rounded-md" />
          <div className="flex justify-center gap-3">
            <Skeleton className="h-11 w-32" rounded="rounded-lg" />
            <Skeleton className="h-11 w-32" rounded="rounded-lg" />
          </div>
        </div>
      </div>
    </section>
  );
}

export function FooterSkeleton() {
  return (
    <footer className="border-t border-border/40 py-16">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-8 px-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-3">
            <Skeleton className="h-5 w-24" rounded="rounded-md" />
            <Skeleton className="h-3 w-full" rounded="rounded-md" />
            <Skeleton className="h-3 w-5/6" rounded="rounded-md" />
            <Skeleton className="h-3 w-4/6" rounded="rounded-md" />
          </div>
        ))}
      </div>
    </footer>
  );
}

export function DividerSkeleton() {
  return <Skeleton className="my-2 h-16 w-full" rounded="rounded-none" />;
}
