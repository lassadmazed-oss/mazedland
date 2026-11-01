/**
 * Home loading skeleton — mirrors LandingPage's rhythm (2026-10-31) so the
 * swap is invisible: the photographic hero with the floating search card,
 * the intent row, then two rails of 4:3 cards.
 *
 * Lives under (home) route group so it ONLY fires on `/` and never
 * leaks into other top-level routes (the prior `[locale]/loading.tsx`
 * still acts as the global fallback for any segment that doesn't
 * ship its own).
 */
import { DesktopLoadingSpinner } from "@/components/ui/DesktopLoadingSpinner";
import { LoadingText } from "@/components/ui/LoadingText";

export default function HomeLoading() {
  return (
    <div role="status" aria-live="polite" className="mx-auto max-w-[var(--max-w-wide)]">
      <DesktopLoadingSpinner />

      {/* Hero — the photo band, then the search card over its edge. */}
      <div className="lg:hidden">
        <div className="mazed-skeleton h-[300px] w-full rounded-none" />
        <div className="relative z-10 -mt-9 px-4">
          <div className="mazed-float h-[232px] w-full" />
        </div>
        <div className="mt-4 flex gap-2 px-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="mazed-skeleton h-10 w-28 rounded-full" />
          ))}
        </div>
      </div>
      <div className="hidden px-8 lg:block">
        <div className="mazed-skeleton mt-5 h-[420px] w-full rounded-[var(--radius-3xl)]" />
        <div className="relative z-10 -mt-12 px-8 xl:px-12">
          <div className="mazed-float h-[124px] w-full" />
        </div>
      </div>

      {/* Two rails of cards. */}
      {Array.from({ length: 2 }).map((_, r) => (
        <section key={r} className="mt-10 px-4 lg:mt-16 lg:px-8">
          <div className="flex items-end justify-between gap-3">
            <div className="space-y-2">
              <div className="mazed-skeleton h-2.5 w-20 rounded" />
              <div className="mazed-skeleton h-6 w-44 rounded" />
            </div>
            <div className="mazed-skeleton h-6 w-20 rounded-full" />
          </div>
          <div className="hide-scrollbar mt-5 flex gap-3 overflow-x-hidden lg:gap-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <RailCardSkeleton key={i} />
            ))}
          </div>
        </section>
      ))}

      <LoadingText className="sr-only" />
    </div>
  );
}

function RailCardSkeleton() {
  return (
    <div className="w-[264px] shrink-0 lg:w-[300px]">
      <div className="mazed-skeleton aspect-[4/3] w-full rounded-2xl" />
      <div className="mt-3 space-y-2">
        <div className="mazed-skeleton h-4 w-1/2 rounded" />
        <div className="mazed-skeleton h-3.5 w-3/4 rounded" />
        <div className="mazed-skeleton h-3 w-2/3 rounded" />
      </div>
    </div>
  );
}
