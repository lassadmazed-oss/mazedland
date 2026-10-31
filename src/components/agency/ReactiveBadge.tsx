import { getTranslations } from "next-intl/server";
import { Zap } from "lucide-react";
import type { Reactivity } from "@/lib/pro/reactivity";

/**
 * « Agence réactive »: earned by answering visit requests fast, read from what
 * the agence did (src/lib/pro/reactivity.ts). Nothing is drawn for an agence
 * that has not earned it. The sentence under the pill — or in its tooltip —
 * says what it rests on, with the numbers, so it is not a claim to take on
 * trust.
 *
 *  - `pill`: the badge, for a header or a card;
 *  - `line`: the badge and what it rests on, for the agence's own page.
 */
export async function ReactiveBadge({ reactivity, variant = "pill" }: { reactivity: Reactivity | null | undefined; variant?: "pill" | "line" }) {
  if (!reactivity?.reactive) return null;
  const t = await getTranslations("shops");
  const proof = t("reactiveProof", { fast: reactivity.fast, total: reactivity.total, hours: reactivity.rules.hours, days: reactivity.rules.days });
  const pill = (
    <span
      title={proof}
      className="mazed-tone-ok inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-bold leading-tight"
    >
      <Zap className="size-3" strokeWidth={2.4} aria-hidden /> {t("reactiveBadge")}
    </span>
  );
  if (variant === "pill") return pill;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {pill}
      <span className="text-[12px] text-muted">{proof}</span>
    </div>
  );
}
