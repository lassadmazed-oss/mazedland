import { requireAdmin } from "@/lib/admin/session";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { formatDate, formatNumber } from "@/lib/utils";
import { ChevronLeft } from "lucide-react";
import { asDay, dayBounds, dayLabel, FIGURE_KINDS, lastDays, tunisiaDay } from "@/lib/prospection/model";
import { dayReport } from "@/lib/prospection/report";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("adminProspection");
  return { title: t("report.title") };
}

/** The events whose note says something worth reading beside them (never an id, never the assistant's log). */
const NOTE_KINDS = new Set(["note", "thinking", "interested", "refused", "wrong_number", "no_answer", "confirmed"]);

const FIGURES = [
  ["created", "created"],
  ["contacted", "contacted"],
  ["yes", "yes"],
  ["online", "online"],
  ["refused", "refused"],
  ["noAnswer", "noAnswer"],
] as const;

export default async function TeamReportPage({ searchParams }: { searchParams: Promise<{ day?: string }> }) {
  const { scopes } = await requireAdmin("prospection");
  // The team's day belongs to the owner: a member reads their own figures on the board.
  if (scopes !== null) notFound();
  const { day: dayParam } = await searchParams;
  const day = asDay(dayParam);
  const t = await getTranslations("adminProspection");
  const locale = await getLocale();
  const admin = getServiceSupabase();
  if (!admin) return null;

  const strip = lastDays(new Date(), 14);
  const [report, { data: stripEvents }] = await Promise.all([
    dayReport(admin, day),
    admin
      .from("prospect_events")
      .select("created_at")
      .in("kind", [...FIGURE_KINDS])
      .gte("created_at", dayBounds(strip[strip.length - 1]).start)
      .not("actor_id", "is", null)
      .limit(20_000),
  ]);
  const perDay = new Map<string, number>();
  for (const e of stripEvents ?? []) {
    const d = tunisiaDay(new Date(e.created_at as string));
    perDay.set(d, (perDay.get(d) ?? 0) + 1);
  }

  const total = report.rows.reduce(
    (a, r) => ({ created: a.created + r.created, contacted: a.contacted + r.contacted, yes: a.yes + r.yes, online: a.online + r.online, refused: a.refused + r.refused, noAnswer: a.noAnswer + r.noAnswer }),
    { created: 0, contacted: 0, yes: 0, online: 0, refused: 0, noAnswer: 0 },
  );
  const noon = new Date(`${day}T12:00:00Z`);

  const tile = (label: string, value: number) => (
    <div key={label} className="rounded-xl bg-[var(--background)] px-3 py-2 ring-1 ring-border">
      <div className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted">{label}</div>
      <div className="mazed-tabular mt-0.5 text-[19px] font-extrabold">{formatNumber(value, locale)}</div>
    </div>
  );

  return (
    <div>
      <Link href="/admin/prospection" className="mb-3 inline-flex items-center gap-1 text-[12px] font-bold text-muted hover:text-foreground">
        <ChevronLeft className="size-3.5 rtl:rotate-180" /> {t("report.back")}
      </Link>
      <AdminPageHeader eyebrow={t("eyebrow")} title={t("report.title")} description={t("report.description")} />

      <section className="mt-5" aria-label={t("report.days")}>
        <h2 className="mb-2 text-[12px] font-extrabold uppercase tracking-[0.1em] text-muted">{t("report.days")}</h2>
        <div className="flex flex-wrap gap-1.5">
          {strip.map((d) => {
            const n = perDay.get(d) ?? 0;
            const active = d === day;
            return (
              <Link
                key={d}
                href={`/admin/prospection/rapport?day=${d}` as "/admin/prospection/rapport"}
                aria-current={active ? "date" : undefined}
                className={`inline-flex min-w-[4.5rem] flex-col items-center rounded-xl border px-3 py-1.5 text-center text-xs font-bold transition-colors ${
                  active ? "border-[var(--gold)] bg-[var(--gold)] text-[var(--background)]" : "border-border bg-surface text-muted hover:border-gold-soft"
                }`}
              >
                <span>{formatDate(new Date(`${d}T12:00:00Z`), locale, "dayMonth")}</span>
                <span className="mazed-tabular text-[11px] font-semibold opacity-80">{n === 0 ? "—" : formatNumber(n, locale)}</span>
              </Link>
            );
          })}
        </div>
      </section>

      <h2 className="mt-7 text-[16px] font-extrabold">{formatDate(noon, locale, "weekday")} <span className="mazed-tabular text-muted">· {dayLabel(day)}</span></h2>

      {report.rows.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted">{t("report.noTeam")}</p>
      ) : (
        <>
          <div className="mt-3">
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-muted">{t("report.total")}</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">{FIGURES.map(([k, label]) => tile(t(`stats.${label}`), total[k]))}</div>
          </div>

          <div className="mt-5 space-y-3">
            {report.rows.map((r) => {
              const mine = report.events.filter((e) => e.actorId === r.actorId);
              const worked = r.created + r.contacted + r.yes + r.online + r.refused + r.noAnswer;
              return (
                <section key={r.actorId} className="rounded-2xl bg-surface p-4 ring-1 ring-border">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-[15px] font-extrabold">{r.name}</h3>
                    <span className="mazed-tabular text-[12px] text-muted">{t("report.dayActions", { n: formatNumber(worked, locale) })}</span>
                  </div>
                  {worked === 0 && mine.length === 0 ? (
                    <p className="mt-2 text-[13px] font-bold text-[var(--tone-warn)]">{t("report.idle")}</p>
                  ) : (
                    <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">{FIGURES.map(([k, label]) => tile(t(`stats.${label}`), r[k]))}</div>
                  )}
                  {mine.length > 0 ? (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-[12.5px] font-bold text-muted">{t("report.detail", { n: formatNumber(mine.length, locale) })}</summary>
                      <ul className="mt-2 divide-y divide-border text-[13px]">
                        {mine.map((e) => (
                          <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5">
                            <span className="mazed-tabular w-12 shrink-0 text-[12px] text-muted">{formatDate(e.at, locale, "time")}</span>
                            <span className="font-bold">{t(`work.event.${e.kind}`)}</span>
                            <Link href={`/admin/prospection/${e.leadId}` as "/admin/prospection"} className="min-w-0 flex-1 truncate underline decoration-border underline-offset-2 hover:decoration-[var(--gold)]">
                              {e.title}
                            </Link>
                            {e.note && NOTE_KINDS.has(e.kind) ? <span className="basis-full ps-[3.75rem] text-[12px] text-muted line-clamp-2">{e.note}</span> : null}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </section>
              );
            })}
          </div>
        </>
      )}

      <p className="mt-6 text-[12px] text-muted">
        {t("report.notice")} <Link href="/admin/settings" className="font-bold underline">{t("report.settingsLink")}</Link>
      </p>
    </div>
  );
}
