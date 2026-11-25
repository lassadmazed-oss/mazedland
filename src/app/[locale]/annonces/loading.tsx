/**
 * The catalogue's own loading shape (2026-11-25, the speed plan): the search
 * row, the buy / rent tabs, the filters and a grid of cards, where the page
 * will be — instead of the site-wide spinner, which blanked the whole screen
 * on every tap of « Explorer », a chip or a page number.
 */
import { DesktopLoadingSpinner } from "@/components/ui/DesktopLoadingSpinner";
import { LoadingText } from "@/components/ui/LoadingText";

export default function CatalogueLoading() {
  return (
    <main role="status" aria-live="polite" className="mx-auto max-w-[var(--max-w-wide)] px-4 pb-6 pt-4 lg:px-8 lg:pb-12 lg:pt-6">
      <DesktopLoadingSpinner />

      {/* Phone: search, tabs, the filter row. */}
      <div className="space-y-3 lg:hidden">
        <div className="mazed-skeleton h-12 w-full rounded-full" />
        <div className="mazed-skeleton h-11 w-full rounded-full" />
        <div className="flex gap-2">
          <div className="mazed-skeleton h-10 flex-1 rounded-full" />
          <div className="mazed-skeleton h-10 w-36 rounded-full" />
        </div>
      </div>

      {/* Desktop: the toolbar of chips and menus. */}
      <div className="hidden space-y-3 lg:block">
        <div className="flex gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="mazed-skeleton h-9 w-24 rounded-full" />
          ))}
        </div>
        <div className="flex gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="mazed-skeleton h-9 w-28 rounded-full" />
          ))}
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between">
        <div className="mazed-skeleton h-4 w-24 rounded" />
        <div className="mazed-skeleton h-4 w-32 rounded" />
      </div>

      <ul className="mt-4 grid grid-cols-1 gap-x-3 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 lg:gap-x-5 lg:gap-y-9 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <li key={i}>
            <div className="mazed-skeleton aspect-[4/3] w-full rounded-2xl" />
            <div className="mt-3 space-y-2">
              <div className="mazed-skeleton h-4 w-1/2 rounded" />
              <div className="mazed-skeleton h-3.5 w-3/4 rounded" />
              <div className="mazed-skeleton h-3 w-2/3 rounded" />
            </div>
          </li>
        ))}
      </ul>

      <LoadingText className="sr-only" />
    </main>
  );
}
