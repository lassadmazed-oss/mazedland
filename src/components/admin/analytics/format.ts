import { formatNumber, formatTND } from "@/lib/utils";

/** The page's formatters, bound to the locale once. */
export function formatters(locale: string, tnd: string) {
  const n = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? "—" : formatNumber(Number(v), locale));
  return {
    n,
    money: (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${formatTND(Number(v), locale)} ${tnd}`),
    pct: (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${formatNumber(Number(v), locale, { maxDecimals: 1 })} %`),
    hours: (v: number | null | undefined) => (v === null || v === undefined ? "—" : formatNumber(Number(v), locale, { maxDecimals: 1 })),
    /** Two decimals, for a cost in dollars. */
    dec2: (v: number | null | undefined) => (v === null || v === undefined ? "—" : formatNumber(Number(v), locale, { maxDecimals: 2 })),
    /** A change in percent, signed: « +12,5 % ». */
    delta: (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${formatNumber(Math.abs(v), locale, { maxDecimals: 1 })} %`,
    /** "DD/MM" from YYYY-MM-DD. */
    day: (iso: string) => (iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : iso),
  };
}
export type Formatters = ReturnType<typeof formatters>;
