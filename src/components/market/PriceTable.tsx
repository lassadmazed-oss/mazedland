import { Link } from "@/i18n/navigation";
import type { CategoryStats, Figure } from "@/lib/market/stats";
import type { MarketFormat } from "./ui";

/**
 * The asking prices by type of property: the median for sale and its price
 * per m², the median rent and its rent per m², each with the number of
 * annonces behind it — or a dash where the sample is not reached yet. A
 * table, because numbers with a count behind each are what a table is for;
 * on a phone the two per-m² columns fold under their medians.
 */
export function PriceTable({
  rows,
  f,
  words,
  gov,
  compact = false,
}: {
  rows: readonly CategoryStats[];
  f: MarketFormat;
  words: { category: string; count: string; sale: string; rent: string; sqm: string; basedOn: (n: number) => string; legend: string; catalogue: string };
  /** The governorate the rows belong to, for the catalogue links. */
  gov?: string;
  compact?: boolean;
}) {
  const cell = (fig: Figure, format: (v: number) => string, sub?: { fig: Figure; format: (v: number) => string }) => (
    <>
      {fig.value === null ? (
        <span className="text-subtle" aria-label={words.legend}>—</span>
      ) : (
        <span className="font-bold text-foreground">{format(fig.value)}</span>
      )}
      {fig.n > 0 && <span className="block text-[11px] text-subtle">{words.basedOn(fig.n)}</span>}
      {sub && sub.fig.value !== null && (
        <span className="mt-0.5 block text-[11.5px] text-muted sm:hidden">{sub.format(sub.fig.value)} · {words.sqm}</span>
      )}
    </>
  );
  const sqm = (fig: Figure, format: (v: number) => string) =>
    fig.value === null ? <span className="text-subtle">—</span> : <span className="font-semibold text-foreground">{format(fig.value)}</span>;
  const href = (slug: string) => {
    const q = new URLSearchParams({ cat: slug });
    if (gov) q.set("gov", gov);
    return `/annonces?${q.toString()}`;
  };

  // Tight cells on a phone, where four columns share 360 px; the box scrolls
  // sideways rather than clip a figure should a label still not fit.
  const pad = compact ? "px-2 py-2.5 sm:px-3" : "px-2.5 py-3 sm:px-4";
  return (
    <div className="overflow-x-auto rounded-2xl bg-surface ring-1 ring-border">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="text-start text-[10px] font-extrabold uppercase tracking-[0.08em] text-subtle sm:text-[11px] sm:tracking-[0.1em]">
            <th scope="col" className={`text-start font-extrabold ${pad}`}>{words.category}</th>
            <th scope="col" className={`text-end font-extrabold ${pad}`}>{words.count}</th>
            <th scope="col" className={`text-end font-extrabold ${pad}`}>{words.sale}</th>
            <th scope="col" className={`hidden text-end font-extrabold sm:table-cell ${pad}`}>{words.sqm}</th>
            <th scope="col" className={`text-end font-extrabold ${pad}`}>{words.rent}</th>
            <th scope="col" className={`hidden text-end font-extrabold sm:table-cell ${pad}`}>{words.sqm}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.slug} className="border-t border-border align-top">
              <th scope="row" className={`text-start font-bold text-foreground ${pad}`}>
                {c.online > 0 ? (
                  <Link href={href(c.slug) as never} className="underline-offset-2 hover:underline" title={words.catalogue}>
                    {c.label}
                  </Link>
                ) : (
                  <span className="text-muted">{c.label}</span>
                )}
              </th>
              <td className={`mazed-tabular text-end ${pad} ${c.online > 0 ? "font-bold text-foreground" : "text-subtle"}`}>{f.n(c.online)}</td>
              <td className={`mazed-tabular text-end ${pad}`}>{cell(c.sale.median, f.money, { fig: c.sale.sqm, format: f.sqm })}</td>
              <td className={`mazed-tabular hidden text-end sm:table-cell ${pad}`}>{sqm(c.sale.sqm, f.sqm)}</td>
              <td className={`mazed-tabular text-end ${pad}`}>{cell(c.rent.median, f.rent, { fig: c.rent.sqm, format: f.sqmRent })}</td>
              <td className={`mazed-tabular hidden text-end sm:table-cell ${pad}`}>{sqm(c.rent.sqm, f.sqmRent)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-border px-3 py-2.5 text-[11.5px] text-subtle sm:px-4">{words.legend}</p>
    </div>
  );
}
