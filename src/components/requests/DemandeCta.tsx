import { BellRing, ChevronRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { DemandeVia } from "@/lib/requests/prefill";

/**
 * « Enregistrer une demande », where people look (the owner, 2026-11-10: the
 * only offer sat under the last result, fifteen phone screens down the
 * catalogue). Server-rendered links: the tap is counted by FirstPartyEvents
 * through `data-track` (`demande_cta`, `via`), and the form counts the demande
 * saved with the same `via`, so the console shows which place brings them.
 */

/** One line across the page: a bell, what you get, a chevron. */
export function DemandeLine({
  href,
  via,
  title,
  body,
  className = "",
}: {
  href: string;
  via: DemandeVia;
  title: string;
  body: string;
  className?: string;
}) {
  return (
    <Link
      href={href as never}
      data-track="demande_cta"
      data-track-via={via}
      className={`group flex items-center gap-3 rounded-2xl bg-surface px-3.5 py-3 ring-1 ring-border transition hover:ring-foreground/40 ${className}`}
    >
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-foreground text-[var(--background)]">
        <BellRing className="size-4" strokeWidth={2.2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-extrabold leading-snug text-foreground">{title}</span>
        <span className="mt-0.5 block text-[12px] leading-snug text-muted">{body}</span>
      </span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted transition group-hover:text-foreground rtl:-scale-x-100" />
    </Link>
  );
}

/** A card among the annonces, the size of one: the same 4:3 frame, then the words. */
export function DemandeCard({
  href,
  title,
  body,
  cta,
}: {
  href: string;
  title: string;
  body: string;
  cta: string;
}) {
  return (
    <Link href={href as never} data-track="demande_cta" data-track-via="card" className="group block">
      <div className="mazed-photo-frame aspect-[4/3]">
        <div className="mazed-band-warm absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <span aria-hidden className="grid size-14 place-items-center rounded-full bg-foreground text-[var(--background)] transition group-hover:scale-105">
            <BellRing className="size-6" strokeWidth={2} />
          </span>
          <span className="text-[16px] font-extrabold leading-snug text-foreground">{title}</span>
        </div>
      </div>
      <div className="pt-3">
        <p className="text-[12.5px] leading-relaxed text-muted">{body}</p>
        <span className="mt-1.5 inline-flex items-center gap-1 text-[13px] font-bold text-foreground underline-offset-4 group-hover:underline">
          {cta}
          <ChevronRight aria-hidden className="size-3.5 rtl:-scale-x-100" strokeWidth={2.4} />
        </span>
      </div>
    </Link>
  );
}
