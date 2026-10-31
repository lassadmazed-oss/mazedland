"use client";

import { useId, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Calculator, ChevronDown } from "lucide-react";
import { rateChoices, simulateCredit } from "@/lib/credit";
import { formatTND } from "@/lib/utils";
import { track } from "@/lib/analytics/ga";

const DOWN_CHOICES = [10, 20, 30, 40, 50];
const YEARS_CHOICES = [10, 15, 20, 25];

const withDefault = (list: number[], value: number) => (list.includes(value) ? list : [...list, value].sort((a, b) => a - b));

/**
 * « Simulez votre crédit » on an annonce for sale: the monthly payment of a
 * loan for this price, from the down payment, the length and the rate the
 * buyer picks. It opens on the figure for the defaults the admin set
 * (credit_* settings), so the monthly payment is read without a tap. Indicative
 * only: the bank's rate, insurance and fees are not in it (src/lib/credit.ts).
 */
export function CreditSimulator({
  price,
  defaults,
}: {
  price: number;
  defaults: { ratePercent: number; years: number; downPercent: number };
}) {
  const t = useTranslations("listing.credit");
  const locale = useLocale();
  const id = useId();
  const [down, setDown] = useState(defaults.downPercent);
  const [years, setYears] = useState(defaults.years);
  const [rate, setRate] = useState(defaults.ratePercent);
  const result = useMemo(
    () => simulateCredit({ price, downPercent: down, years, ratePercent: rate }),
    [price, down, years, rate],
  );
  const money = (n: number) => `${formatTND(n, locale)} ${t("tnd")}`;
  const fields: { key: string; label: string; value: number; set: (n: number) => void; options: { value: number; label: string }[] }[] = [
    { key: "down", label: t("down"), value: down, set: setDown, options: withDefault(DOWN_CHOICES, defaults.downPercent).map((v) => ({ value: v, label: `${v} %` })) },
    { key: "years", label: t("years"), value: years, set: setYears, options: withDefault(YEARS_CHOICES, defaults.years).map((v) => ({ value: v, label: t("yearsValue", { count: v }) })) },
    { key: "rate", label: t("rate"), value: rate, set: setRate, options: rateChoices(defaults.ratePercent).map((v) => ({ value: v, label: `${String(v).replace(".", locale === "ar" ? "٫" : ",")} %` })) },
  ];

  return (
    <details
      className="group mt-6 rounded-2xl border border-border bg-surface"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) track("credit_simulator_open");
      }}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4 [&::-webkit-details-marker]:hidden">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gold-faint text-[var(--gold)]">
          <Calculator className="size-4.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-extrabold text-foreground">{t("title")}</span>
          <span className="block text-[12px] text-muted">{t("summary", { amount: money(result.monthly) })}</span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted transition group-open:rotate-180" />
      </summary>

      <div className="border-t border-border p-4">
        <div className="grid grid-cols-3 gap-2">
          {fields.map((f) => (
            <label key={f.key} htmlFor={`${id}-${f.key}`} className="block min-w-0">
              <span className="block truncate text-[11px] font-semibold text-muted">{f.label}</span>
              <select
                id={`${id}-${f.key}`}
                value={f.value}
                onChange={(e) => f.set(Number(e.target.value))}
                className="mt-1 h-10 w-full rounded-lg border border-border bg-surface-2 px-2 text-[13px] font-semibold text-foreground focus:border-gold focus:outline-none"
              >
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          ))}
        </div>

        <p className="mazed-tabular mt-4 text-[26px] font-extrabold leading-none text-foreground">
          {money(result.monthly)} <span className="text-[12px] font-bold text-muted">{t("perMonth")}</span>
        </p>
        <dl className="mt-3 divide-y divide-border rounded-xl bg-surface-2/60 px-3 ring-1 ring-border">
          {[
            [t("borrowed"), money(result.borrowed)],
            [t("downPayment"), money(result.downPayment)],
            [t("interest"), money(result.interest)],
            [t("total"), money(result.total)],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-3 py-2 text-[12.5px]">
              <dt className="text-muted">{label}</dt>
              <dd className="mazed-tabular text-end font-bold text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[11.5px] leading-snug text-muted">{t("disclaimer")}</p>
      </div>
    </details>
  );
}
