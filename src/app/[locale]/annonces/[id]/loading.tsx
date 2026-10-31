/**
 * The listing page is the most-clicked destination in the product and had no
 * loading state at all — tapping a card left the catalogue on screen, frozen,
 * for the whole server render.
 *
 * The shape matches the real page (2026-10-31): the carousel on a phone, the
 * mosaic on a desktop, then the title column and the floating price card.
 */
export default function Loading() {
  return (
    <main className="mx-auto max-w-[var(--max-w-wide)] pb-16 lg:px-8">
      {/* Breadcrumb */}
      <div className="skel mt-6 hidden h-3 w-56 rounded-full lg:block" />

      {/* Gallery — carousel on a phone, mosaic on a desktop */}
      <div className="skel aspect-[4/3] max-h-[50svh] w-full rounded-none lg:hidden" />
      <div className="mt-4 hidden h-[480px] grid-cols-4 grid-rows-2 gap-2 overflow-hidden rounded-[var(--radius-3xl)] lg:grid">
        <div className="skel col-span-2 row-span-2 rounded-none" />
        <div className="skel rounded-none" />
        <div className="skel rounded-none" />
        <div className="skel rounded-none" />
        <div className="skel rounded-none" />
      </div>

      <div className="mt-5 px-4 lg:mt-8 lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-12 lg:px-0">
        <div className="min-w-0">
          <div className="flex gap-2">
            <div className="skel h-6 w-20 rounded-full" />
            <div className="skel h-6 w-24 rounded-full" />
          </div>
          <div className="skel mt-4 h-7 w-3/4 rounded-full" />
          <div className="skel mt-2 h-4 w-1/2 rounded-full" />
          <div className="mt-4 flex gap-5 border-y border-border py-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="skel h-4 w-16 rounded-full" />
            ))}
          </div>

          {/* Price + seller — phones only */}
          <div className="skel mt-5 h-8 w-40 rounded-full lg:hidden" />
          <div className="mt-5 rounded-2xl border border-border p-4 lg:hidden">
            <div className="flex items-center gap-3">
              <div className="skel size-12 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <div className="skel h-3 w-28 rounded-full" />
                <div className="skel h-2.5 w-20 rounded-full" />
              </div>
            </div>
            <div className="skel mt-4 h-12 w-full rounded-lg" />
          </div>

          {/* Fact tiles */}
          <div className="mt-8 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-2xl border border-border p-3">
                <div className="skel size-9 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <div className="skel h-2.5 w-14 rounded-full" />
                  <div className="skel h-3.5 w-20 rounded-full" />
                </div>
              </div>
            ))}
          </div>

          {/* Description */}
          <div className="mt-8 space-y-2">
            <div className="skel h-3 w-full rounded-full" />
            <div className="skel h-3 w-11/12 rounded-full" />
            <div className="skel h-3 w-4/5 rounded-full" />
          </div>
        </div>

        {/* The floating card — desktop only */}
        <aside className="hidden lg:block">
          <div className="mazed-float p-5">
            <div className="skel h-9 w-44 rounded-full" />
            <div className="skel mt-2 h-3 w-24 rounded-full" />
            <div className="mt-5 flex items-center gap-3 border-t border-border pt-5">
              <div className="skel size-12 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <div className="skel h-3 w-28 rounded-full" />
                <div className="skel h-2.5 w-20 rounded-full" />
              </div>
            </div>
            <div className="skel mt-4 h-12 w-full rounded-lg" />
            <div className="skel mt-2 h-11 w-full rounded-lg" />
          </div>
        </aside>
      </div>
    </main>
  );
}
