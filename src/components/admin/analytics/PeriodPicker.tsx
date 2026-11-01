"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { periodQuery, type PeriodKey } from "@/lib/analytics/period";

/**
 * The period: 7, 30 or 90 days as a segment, or two dates. Everything lives
 * in the URL (the server page reads it), so a view is a link one can send.
 */
export function PeriodPicker({ current, fromDay, toDay, tab }: { current: PeriodKey; fromDay: string; toDay: string; tab: string }) {
  const t = useTranslations("adminAnalytics.period");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [custom, setCustom] = useState(current === "custom");
  const [from, setFrom] = useState(fromDay);
  const [to, setTo] = useState(toDay);
  const extra = tab !== "overview" ? { tab } : {};

  const keys: { key: PeriodKey; label: string }[] = [
    { key: "7", label: t("d7") },
    { key: "30", label: t("d30") },
    { key: "90", label: t("d90") },
  ];

  function apply(e: React.FormEvent) {
    e.preventDefault();
    start(() => router.push(`/admin/analytics${periodQuery({ key: "custom", fromDay: from, toDay: to }, extra)}` as never));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="mazed-segment" role="group" aria-label={t("label")}>
        {keys.map((k) => (
          <Link
            key={k.key}
            href={`/admin/analytics${periodQuery({ key: k.key, fromDay, toDay }, extra)}` as never}
            aria-current={!custom && current === k.key ? "page" : undefined}
            onClick={() => setCustom(false)}
          >
            {k.label}
          </Link>
        ))}
        <button type="button" aria-pressed={custom} onClick={() => setCustom(true)}>
          {t("custom")}
        </button>
      </div>
      {custom && (
        <form onSubmit={apply} className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <label className="inline-flex items-center gap-1.5 text-subtle">
            {t("from")}
            <input type="date" value={from} max={toDay} onChange={(e) => setFrom(e.target.value)} className="h-9 rounded-lg border border-border bg-surface px-2 text-[13px] text-foreground" required />
          </label>
          <label className="inline-flex items-center gap-1.5 text-subtle">
            {t("to")}
            <input type="date" value={to} max={toDay} onChange={(e) => setTo(e.target.value)} className="h-9 rounded-lg border border-border bg-surface px-2 text-[13px] text-foreground" required />
          </label>
          <button type="submit" disabled={pending} className="mazed-btn-luxe inline-flex h-9 items-center gap-1.5 px-4 text-[12.5px]">
            {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {t("apply")}
          </button>
        </form>
      )}
    </div>
  );
}
