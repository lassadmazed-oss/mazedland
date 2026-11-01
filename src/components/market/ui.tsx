import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { formatNumber, formatTND } from "@/lib/utils";
import type { Figure, Trend } from "@/lib/market/stats";

/**
 * The furniture of « Le marché en chiffres »: a figure tile, a count tile, a
 * section, the note that says there is not enough data yet, and the
 * formatters bound to the reader's language. Server components, in the
 * redesign's vocabulary (white cards with a hairline on the page, the warm
 * band for what frames it, ink for the one figure that matters on a tile).
 */

export type MarketFormat = ReturnType<typeof marketFormatters>;

/** The page's formatters, bound to the locale once. */
export function marketFormatters(locale: string, words: { tnd: string; perMonth: string; sqm: string }) {
  return {
    n: (v: number) => formatNumber(v, locale),
    /** « 230 000 TND » */
    money: (v: number) => `${formatTND(v, locale)} ${words.tnd}`,
    /** « 800 TND/mois » */
    rent: (v: number) => `${formatTND(v, locale)} ${words.tnd}${words.perMonth}`,
    /** « 1 250 TND/m² » */
    sqm: (v: number) => `${formatTND(v, locale)} ${words.tnd}/${words.sqm}`,
    /** « 12 TND/m²/mois » */
    sqmRent: (v: number) => `${formatTND(v, locale)} ${words.tnd}/${words.sqm}${words.perMonth}`,
    /** A change in percent, signed: « +12 % ». */
    delta: (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${formatNumber(Math.abs(v), locale)} %`,
  };
}

export function Section({ id, title, hint, children, className = "" }: { id: string; title: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={`mt-10 scroll-mt-24 lg:mt-14 ${className}`} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="mazed-h2 text-[22px] text-foreground lg:text-[28px]">{title}</h2>
      {hint && <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-muted">{hint}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function Card({ title, hint, children, className = "" }: { title?: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl bg-surface p-4 ring-1 ring-border lg:p-5 ${className}`}>
      {title && <p className="text-[13px] font-extrabold text-foreground">{title}</p>}
      {hint && <p className="mt-0.5 text-[12px] text-muted">{hint}</p>}
      {(title || hint) ? <div className="mt-3">{children}</div> : children}
    </div>
  );
}

/** « Pas encore assez de données » — said in the figure's place, never a number in its place. */
export function NotEnough({ text, hint }: { text: string; hint?: string }) {
  return (
    <p className="rounded-2xl border border-dashed border-border px-4 py-5 text-center text-[13px] text-muted">
      {text}
      {hint && <span className="mt-0.5 block text-[11.5px] text-subtle">{hint}</span>}
    </p>
  );
}

/** The change line under a figure: ink green up, red down, grey flat. */
function DeltaLine({ delta, label }: { delta: number | null; label: string }) {
  if (delta === null) return null;
  const up = delta > 0;
  const down = delta < 0;
  return (
    <p className={`mt-2 inline-flex items-center gap-1 text-[12px] font-bold ${up ? "text-[var(--tone-ok)]" : down ? "text-[var(--tone-bad)]" : "text-muted"}`}>
      {up ? <ArrowUpRight className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden /> : down ? <ArrowDownRight className="size-3.5 shrink-0" strokeWidth={2.5} aria-hidden /> : null}
      {label}
    </p>
  );
}

/**
 * A figure with its label, what stands behind it (« sur 12 annonces »), and
 * its change against the window before when both sides have the sample.
 * Under the sample it says so, in words, where the number would be.
 */
export function FigureTile({
  label,
  figure,
  format,
  basis,
  trend,
  trendLabel,
  notEnough,
  notEnoughHint,
  big = false,
}: {
  label: string;
  figure: Figure;
  format: (v: number) => string;
  /** « sur 12 annonces » */
  basis?: string;
  trend?: Trend;
  /** « +40 % vs les 30 jours d'avant », built by the caller from `trend.delta`. */
  trendLabel?: string;
  notEnough: string;
  notEnoughHint?: string;
  big?: boolean;
}) {
  return (
    <div className="rounded-2xl bg-surface p-4 ring-1 ring-border lg:p-5">
      <p className="text-[12px] font-semibold text-muted">{label}</p>
      {figure.value === null ? (
        <>
          <p className={`mt-1.5 font-extrabold leading-none text-subtle ${big ? "text-[28px] lg:text-[34px]" : "text-[22px]"}`} aria-hidden>
            —
          </p>
          <p className="mt-2 text-[12px] text-muted">
            {notEnough}
            {notEnoughHint && <span className="block text-[11px] text-subtle">{notEnoughHint}</span>}
          </p>
        </>
      ) : (
        <>
          <p className={`mt-1.5 font-extrabold leading-none tracking-tight text-foreground ${big ? "text-[28px] lg:text-[34px]" : "text-[22px] lg:text-[26px]"}`}>
            {format(figure.value)}
          </p>
          {basis && <p className="mt-2 text-[12px] text-muted">{basis}</p>}
          {trend && trendLabel && <DeltaLine delta={trend.delta} label={trendLabel} />}
        </>
      )}
    </div>
  );
}

/** A plain count — the headline numbers, which need no sample to be true. */
export function CountTile({ label, value, sub, delta, deltaLabel, f }: { label: string; value: number; sub?: string; delta?: number | null; deltaLabel?: string; f: MarketFormat }) {
  return (
    <div className="rounded-2xl bg-surface p-4 ring-1 ring-border lg:p-5">
      <p className="text-[12px] font-semibold text-muted">{label}</p>
      <p className="mt-1.5 text-[30px] font-extrabold leading-none tracking-tight text-foreground lg:text-[38px]">{f.n(value)}</p>
      {sub && <p className="mt-2 text-[12px] text-muted">{sub}</p>}
      {delta !== undefined && deltaLabel && <DeltaLine delta={delta} label={deltaLabel} />}
    </div>
  );
}
