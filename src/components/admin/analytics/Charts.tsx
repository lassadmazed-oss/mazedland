/**
 * The console's charts: inline SVG, no library. A sparkline for a tile, a
 * line chart for a period against the one before, bars for a day series, a
 * stacked bar for parts of a whole, a funnel for the steps of a form.
 *
 * One ink for the figures of the period, a dashed grey for the previous
 * one, and the tone colours only where a value means good or bad. Every
 * chart reads left to right whatever the page's direction (`dir="ltr"`):
 * time runs that way in Arabic charts too. Server components, so a page
 * draws them without shipping a byte of JavaScript.
 */

const INK = "var(--foreground)";
const MUTED = "var(--foreground-subtle)";
const RULE = "var(--border)";

function pathOf(values: readonly number[], w: number, h: number, max: number, pad = 2): string {
  if (values.length === 0) return "";
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  const y = (v: number) => h - pad - (max > 0 ? (v / max) * (h - pad * 2) : 0);
  return values.map((v, i) => `${i === 0 ? "M" : "L"}${(pad + i * step).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
}

/** A tile's trend: the period's days as one thin line and a faint area. */
export function Sparkline({ values, width = 120, height = 32, label }: { values: readonly number[]; width?: number; height?: number; label?: string }) {
  const max = Math.max(1, ...values);
  const line = pathOf(values, width, height, max);
  if (!line) return null;
  const area = `${line} L${(width - 2).toFixed(1)},${height - 2} L2,${height - 2} Z`;
  return (
    <svg style={{ direction: "ltr" }} viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="block overflow-visible" role="img" aria-label={label}>
      <path d={area} fill={INK} fillOpacity={0.07} />
      <path d={line} fill="none" stroke={INK} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export type Series = { name: string; values: readonly number[]; muted?: boolean };

/**
 * Two lines on the same scale — this period in ink, the previous one dashed —
 * with four horizontal rules and the first, middle and last day named.
 */
export function LineChart({
  labels,
  series,
  height = 180,
  format = (n) => String(n),
}: {
  labels: readonly string[];
  series: readonly Series[];
  height?: number;
  format?: (n: number) => string;
}) {
  const width = 640;
  const left = 44;
  const bottom = 22;
  const top = 8;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const w = width - left - 8;
  const h = height - top - bottom;
  const step = labels.length > 1 ? w / (labels.length - 1) : 0;
  const yOf = (v: number) => top + h - (v / max) * h;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  const named = [0, Math.floor((labels.length - 1) / 2), labels.length - 1].filter((i, k, a) => a.indexOf(i) === k);
  return (
    <svg style={{ direction: "ltr" }} viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full" role="img">
      {ticks.map((v) => (
        <g key={v}>
          <line x1={left} x2={width - 8} y1={yOf(v)} y2={yOf(v)} stroke={RULE} strokeWidth={1} />
          <text x={left - 6} y={yOf(v) + 3.5} textAnchor="end" fontSize={10} fill={MUTED} className="mazed-tabular">{format(v)}</text>
        </g>
      ))}
      {series.map((s) => {
        const d = s.values.map((v, i) => `${i === 0 ? "M" : "L"}${(left + i * step).toFixed(1)},${yOf(v).toFixed(1)}`).join(" ");
        return (
          <path
            key={s.name}
            d={d}
            fill="none"
            stroke={s.muted ? MUTED : INK}
            strokeWidth={s.muted ? 1.25 : 2}
            strokeDasharray={s.muted ? "4 4" : undefined}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        );
      })}
      {series[0] && series[0].values.length <= 31 && series[0].values.map((v, i) => (
        <circle key={i} cx={left + i * step} cy={yOf(v)} r={2} fill={INK} />
      ))}
      {named.map((i) => (
        <text key={i} x={left + i * step} y={height - 6} textAnchor={i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle"} fontSize={10} fill={MUTED}>
          {labels[i]}
        </text>
      ))}
    </svg>
  );
}

/** Vertical bars, one per day; the tallest names its value. */
export function Bars({ labels, values, height = 140, format = (n) => String(n) }: { labels: readonly string[]; values: readonly number[]; height?: number; format?: (n: number) => string }) {
  const width = 640;
  const left = 8;
  const bottom = 20;
  const top = 14;
  const max = Math.max(1, ...values);
  const w = width - left * 2;
  const h = height - top - bottom;
  const slot = values.length > 0 ? w / values.length : w;
  const bar = Math.max(2, Math.min(28, slot * 0.7));
  const peak = values.indexOf(max);
  const named = [0, Math.floor((labels.length - 1) / 2), labels.length - 1].filter((i, k, a) => a.indexOf(i) === k);
  return (
    <svg style={{ direction: "ltr" }} viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full" role="img">
      <line x1={left} x2={width - left} y1={top + h} y2={top + h} stroke={RULE} />
      {values.map((v, i) => {
        const bh = (v / max) * h;
        const x = left + i * slot + (slot - bar) / 2;
        return <rect key={i} x={x} y={top + h - bh} width={bar} height={bh} rx={2} fill={INK} fillOpacity={i === peak ? 1 : 0.55} />;
      })}
      {peak >= 0 && max > 0 && (
        <text x={left + peak * slot + slot / 2} y={top - 3} textAnchor="middle" fontSize={10} fill={INK} className="mazed-tabular">{format(max)}</text>
      )}
      {named.map((i) => (
        <text key={i} x={left + i * slot + slot / 2} y={height - 5} textAnchor="middle" fontSize={10} fill={MUTED}>{labels[i]}</text>
      ))}
    </svg>
  );
}

export type Stack = { name: string; values: readonly number[]; opacity?: number };

/** Parts of a whole, day by day: each stack a shade of the same ink. */
export function StackedBars({ labels, stacks, height = 150, format = (n) => String(n) }: { labels: readonly string[]; stacks: readonly Stack[]; height?: number; format?: (n: number) => string }) {
  const width = 640;
  const left = 8;
  const bottom = 20;
  const top = 14;
  const totals = labels.map((_, i) => stacks.reduce((a, s) => a + (s.values[i] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const w = width - left * 2;
  const h = height - top - bottom;
  const slot = labels.length > 0 ? w / labels.length : w;
  const bar = Math.max(2, Math.min(28, slot * 0.7));
  const shades = [1, 0.55, 0.3, 0.18];
  const named = [0, Math.floor((labels.length - 1) / 2), labels.length - 1].filter((i, k, a) => a.indexOf(i) === k);
  return (
    <div>
      <svg style={{ direction: "ltr" }} viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full" role="img">
        <line x1={left} x2={width - left} y1={top + h} y2={top + h} stroke={RULE} />
        {labels.map((_, i) => {
          let acc = 0;
          const x = left + i * slot + (slot - bar) / 2;
          return (
            <g key={i}>
              {stacks.map((s, k) => {
                const v = s.values[i] ?? 0;
                const bh = (v / max) * h;
                acc += bh;
                return <rect key={s.name} x={x} y={top + h - acc} width={bar} height={bh} fill={INK} fillOpacity={s.opacity ?? shades[k % shades.length]} />;
              })}
              {totals[i] === max && max > 0 && (
                <text x={x + bar / 2} y={top - 3} textAnchor="middle" fontSize={10} fill={INK} className="mazed-tabular">{format(max)}</text>
              )}
            </g>
          );
        })}
        {named.map((i) => (
          <text key={i} x={left + i * slot + slot / 2} y={height - 5} textAnchor="middle" fontSize={10} fill={MUTED}>{labels[i]}</text>
        ))}
      </svg>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted">
        {stacks.map((s, k) => (
          <li key={s.name} className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-sm bg-foreground" style={{ opacity: s.opacity ?? shades[k % shades.length] }} aria-hidden />
            {s.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

export type FunnelStepView = { label: string; value: string; share: number; drop: string | null };

/** The steps of a form as bars that narrow, each with what the step before lost. */
export function Funnel({ steps }: { steps: readonly FunnelStepView[] }) {
  const rowH = 34;
  const width = 640;
  const labelW = 170;
  const valueW = 70;
  const barW = width - labelW - valueW - 70;
  const height = steps.length * rowH;
  return (
    <svg style={{ direction: "ltr" }} viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full" role="img">
      {steps.map((s, i) => {
        const y = i * rowH;
        const bw = Math.max(2, (s.share / 100) * barW);
        return (
          <g key={s.label}>
            <text x={0} y={y + rowH / 2 + 4} fontSize={12} fill={INK} fontWeight={600}>{s.label}</text>
            <rect x={labelW} y={y + 7} width={barW} height={rowH - 14} rx={4} fill={INK} fillOpacity={0.06} />
            <rect x={labelW} y={y + 7} width={bw} height={rowH - 14} rx={4} fill={INK} fillOpacity={i === 0 ? 1 : 0.75} />
            <text x={labelW + barW + 10} y={y + rowH / 2 + 4} fontSize={12} fill={INK} className="mazed-tabular" fontWeight={700}>{s.value}</text>
            <text x={labelW + barW + valueW + 10} y={y + rowH / 2 + 4} fontSize={11} fill={s.drop && s.drop !== "−0 %" ? "var(--tone-bad)" : MUTED} className="mazed-tabular">
              {s.drop ?? `${s.share} %`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** A ranking: a label, a bar as a share of the largest, and the value. HTML, so a label can be a link. */
export function BarList({ items, format = (n) => String(n) }: { items: readonly { label: React.ReactNode; value: number; sub?: React.ReactNode }[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ol className="space-y-2">
      {items.map((it, i) => (
        <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5">
          <span className="min-w-0 truncate text-[13px] text-foreground">{it.label}</span>
          <span className="mazed-tabular text-[13px] font-bold text-foreground">{format(it.value)}</span>
          <span className="col-span-2 block h-1.5 overflow-hidden rounded-full bg-surface-2">
            <span className="block h-full rounded-full bg-foreground" style={{ width: `${Math.max(1, (it.value / max) * 100)}%`, opacity: i === 0 ? 1 : 0.6 }} />
          </span>
          {it.sub && <span className="col-span-2 text-[11px] text-subtle">{it.sub}</span>}
        </li>
      ))}
    </ol>
  );
}
