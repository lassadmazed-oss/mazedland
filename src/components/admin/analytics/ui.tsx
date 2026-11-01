import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Sparkline } from "@/components/charts/Charts";
import { ExportCsv } from "./ExportCsv";
import { csvFileName, toCsv, type CsvCell } from "@/lib/analytics/csv";

/**
 * The page's small furniture: a KPI tile with its delta and sparkline, a
 * section, a list of facts, a table with its CSV export. Server components.
 */

export function Section({ title, hint, action, children, className = "" }: { title: string; hint?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`mt-8 ${className}`}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 className="mazed-h2 text-[17px] text-foreground">{title}</h2>
          {hint && <p className="mt-0.5 text-[12px] text-muted">{hint}</p>}
        </div>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function Grid({ children, cols = 2 }: { children: React.ReactNode; cols?: 2 | 3 }) {
  return <div className={`grid gap-4 ${cols === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>{children}</div>;
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-surface p-4 ring-1 ring-border ${className}`}>{children}</div>;
}

export function Empty({ text }: { text: string }) {
  return <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-[12.5px] text-muted">{text}</p>;
}

/** A section whose figures could not be read: said in its place, the rest of the page intact. */
export function ErrorNote({ text }: { text: string }) {
  return (
    <p role="alert" className="mt-6 rounded-2xl bg-[var(--tone-bad-bg)] px-4 py-3 text-[12.5px] font-semibold text-[var(--tone-bad)] ring-1 ring-[var(--tone-bad-ring)]">
      {text}
    </p>
  );
}

/** What went wrong, in a sentence, for the note. */
export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** A figure, its label, its change against the previous period and its days. */
export function KpiTile({
  label,
  value,
  delta,
  deltaLabel,
  hint,
  spark,
  invert = false,
  formatDelta = (v) => `${v > 0 ? "+" : ""}${v} %`,
}: {
  label: string;
  value: string;
  /** Change in percent, null when there is nothing to compare with. */
  delta?: number | null;
  deltaLabel?: string;
  hint?: string;
  spark?: readonly number[];
  /** When a rise is bad (errors, delays). */
  invert?: boolean;
  /** The change as written in the reader's language. */
  formatDelta?: (v: number) => string;
}) {
  const up = delta !== null && delta !== undefined && delta > 0;
  const down = delta !== null && delta !== undefined && delta < 0;
  const good = (up && !invert) || (down && invert);
  const tone = delta === null || delta === undefined || delta === 0 ? "text-subtle" : good ? "text-[var(--tone-ok)]" : "text-[var(--tone-bad)]";
  return (
    <div className="rounded-2xl bg-surface p-4 shadow-[var(--shadow-card)] ring-1 ring-border" title={hint}>
      <p className="truncate text-[11.5px] font-semibold text-muted">{label}</p>
      <div className="mt-1 flex items-end justify-between gap-2">
        <p className="mazed-tabular text-[24px] font-extrabold leading-none text-foreground">{value}</p>
        {spark && spark.length > 1 && <Sparkline values={spark} width={88} height={26} label={label} />}
      </div>
      {delta !== undefined && (
        <p className={`mazed-tabular mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-semibold ${tone}`}>
          {up ? <ArrowUpRight className="size-3" aria-hidden /> : down ? <ArrowDownRight className="size-3" aria-hidden /> : <Minus className="size-3" aria-hidden />}
          {delta === null ? "—" : formatDelta(delta)}
          {deltaLabel && <span className="font-normal text-subtle"> · {deltaLabel}</span>}
        </p>
      )}
    </div>
  );
}

/** Facts in two columns: a label, a value. */
export function Facts({ items }: { items: readonly { label: string; value: React.ReactNode; tone?: "ok" | "warn" | "bad" }[] }) {
  const tone = { ok: "text-[var(--tone-ok)]", warn: "text-[var(--tone-warn)]", bad: "text-[var(--tone-bad)]" };
  return (
    <dl className="divide-y divide-border">
      {items.map((it) => (
        <div key={it.label} className="flex items-baseline justify-between gap-4 py-2">
          <dt className="text-[12.5px] text-muted">{it.label}</dt>
          <dd className={`mazed-tabular text-[13.5px] font-bold ${it.tone ? tone[it.tone] : "text-foreground"}`}>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export type Col = { key: string; label: string; num?: boolean; hideBelow?: "sm" | "md" };
export type TableRow = Record<string, React.ReactNode> & { _csv: CsvCell[]; _key: string };

/** A flat table and its CSV: the rows already rendered, their raw values beside them for the file. */
export function Table({ columns, rows, name, exportLabel, empty }: { columns: readonly Col[]; rows: readonly TableRow[]; name: string; exportLabel: string; empty: string }) {
  if (rows.length === 0) return <Empty text={empty} />;
  const csv = toCsv(columns.map((c) => c.label), rows.map((r) => r._csv));
  const hide = { sm: "hidden sm:table-cell", md: "hidden md:table-cell" };
  return (
    <div>
      <div className="overflow-x-auto rounded-2xl bg-surface ring-1 ring-border">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-border text-[10.5px] font-bold uppercase tracking-[0.12em] text-subtle">
              {columns.map((c) => (
                <th key={c.key} scope="col" className={`px-3 py-2.5 ${c.num ? "text-end" : "text-start"} ${c.hideBelow ? hide[c.hideBelow] : ""}`}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r._key} className="border-b border-border/70 last:border-0">
                {columns.map((c) => (
                  <td key={c.key} className={`px-3 py-2 align-middle ${c.num ? "mazed-tabular text-end font-semibold text-foreground" : "text-foreground"} ${c.hideBelow ? hide[c.hideBelow] : ""}`}>
                    {r[c.key] ?? <span className="text-subtle">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex justify-end">
        <ExportCsv csv={csv} filename={csvFileName(name)} label={exportLabel} />
      </div>
    </div>
  );
}
