import { getLocale, getTranslations } from "next-intl/server";
import { Sparkles } from "lucide-react";
import { governorateLabel } from "@/lib/tunisia";
import type { FoundingSeats } from "@/lib/pro/founding";

/**
 * « Agences fondatrices »: the launch offer and how many places are left — the
 * real count, from the periods the console has given (src/lib/pro/founding.ts).
 * Nothing is drawn once every place is taken: the offer is over, and a counter
 * at zero would only advertise that.
 */
export async function FoundingCounter({ seats, months, place }: { seats: FoundingSeats; months: number; place: string }) {
  if (seats.left <= 0 || seats.total <= 0) return null;
  const t = await getTranslations("pro.founding");
  const locale = await getLocale();
  // The place is typed in the console: a governorate is said in the reader's language, anything else as written.
  const where = governorateLabel(place.trim(), locale);
  // Up to twenty places read as a row of dots; more is a number, not a crowd.
  const dots = seats.total <= 20;

  return (
    <div className="mt-6 max-w-lg rounded-2xl bg-surface p-4 ring-1 ring-border shadow-[var(--shadow-card)]">
      <p className="flex items-center gap-1.5 text-[11.5px] font-extrabold uppercase tracking-[0.14em] text-muted">
        <Sparkles className="size-3.5" aria-hidden /> {t("eyebrow")}
      </p>
      <p className="mt-1.5 text-[14.5px] font-extrabold leading-snug text-foreground">
        {where ? t("headline", { months, total: seats.total, place: where }) : t("headlineAny", { months, total: seats.total })}
      </p>
      {dots && (
        <div className="mt-3 flex flex-wrap gap-1.5" aria-hidden>
          {Array.from({ length: seats.total }, (_, i) => (
            <span key={i} className={`size-3.5 rounded-full ${i < seats.taken ? "bg-foreground" : "bg-surface-3 ring-1 ring-border"}`} />
          ))}
        </div>
      )}
      <p className="mt-2 text-[12.5px] font-bold text-foreground">{t("left", { left: seats.left, total: seats.total })}</p>
      <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{t("how")}</p>
    </div>
  );
}
