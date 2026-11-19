import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { getServiceSupabase } from "@/lib/supabase/admin";
import { formatDate, formatNumber } from "@/lib/utils";
import { teamNames } from "@/lib/prospection/report";
import { splitDeclineNote, type AgencyFigures } from "@/lib/prospection/agencies/model";
import { agencyDayReport, agencyFunnel, declineReasons } from "@/lib/prospection/agencies/server";

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

const FIGURES = ["contacted", "reached", "interested", "declined", "noAnswer", "signedUp", "posted"] as const;

/**
 * The agencies' part of the owner's day (0229): for each member of the team what
 * they did on the list — calls made, agencies reached, interested, declined, no
 * answer — and which of their agencies opened an agence or posted that day (found
 * by the site, not typed). Below, where the whole list stands and why the
 * agencies that said no said it.
 */
export async function AgencyDay({ admin, day, locale }: { admin: Admin; day: string; locale: "fr" | "ar" }) {
  const t = await getTranslations("adminProspection");
  const [{ figures, events }, team, funnel, reasons] = await Promise.all([
    agencyDayReport(admin, day),
    teamNames(admin),
    agencyFunnel(admin),
    declineReasons(admin),
  ]);

  const byActor = new Map<string, AgencyFigures>(figures.map((f) => [f.actorId, f]));
  const ids = new Set<string>([...team.keys(), ...figures.map((f) => f.actorId)]);
  const names = new Map(team);
  const unknown = [...ids].filter((id) => !names.has(id));
  if (unknown.length > 0) {
    const { data } = await admin.from("profiles").select("id, full_name").in("id", unknown);
    for (const p of data ?? []) names.set(p.id as string, (p.full_name as string | null)?.trim() || "—");
  }
  const rows = [...ids].map((id) => {
    const f = byActor.get(id);
    return { id, name: names.get(id) ?? "—", contacted: f?.contacted ?? 0, reached: f?.reached ?? 0, interested: f?.interested ?? 0, declined: f?.declined ?? 0, noAnswer: f?.noAnswer ?? 0, signedUp: f?.signedUp ?? 0, posted: f?.posted ?? 0 };
  });
  const worked = (r: (typeof rows)[number]) => FIGURES.reduce((n, k) => n + r[k], 0);
  rows.sort((a, b) => worked(b) - worked(a) || b.contacted - a.contacted || a.name.localeCompare(b.name));
  const total = Object.fromEntries(FIGURES.map((k) => [k, rows.reduce((n, r) => n + r[k], 0)])) as Record<(typeof FIGURES)[number], number>;

  const tile = (label: string, value: number) => (
    <div key={label} className="rounded-xl bg-[var(--background)] px-3 py-2 ring-1 ring-border">
      <div className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-muted">{label}</div>
      <div className="mazed-tabular mt-0.5 text-[19px] font-extrabold">{formatNumber(value, locale)}</div>
    </div>
  );
  const reasonEntries = Object.entries(reasons).sort((a, b) => b[1] - a[1]);

  return (
    <section className="mt-10" aria-label={t("agencies.report.title")}>
      <h2 className="text-[16px] font-extrabold">{t("agencies.report.title")}</h2>
      <p className="mt-1 text-[12.5px] text-muted">{t("agencies.report.description")}</p>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">{FIGURES.map((k) => tile(t(`agencies.report.${k}`), total[k]))}</div>

      {rows.length === 0 ? (
        <p className="mt-3 rounded-xl border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted">{t("agencies.report.none")}</p>
      ) : (
        <div className="mt-4 space-y-3">
          {rows.map((r) => {
            const mine = events.filter((e) => (e.kind === "signed_up" || e.kind === "posted" ? e.assignedTo : e.actorId) === r.id);
            return (
              <section key={r.id} className="rounded-2xl bg-surface p-4 ring-1 ring-border">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-[15px] font-extrabold">{r.name}</h3>
                  <span className="mazed-tabular text-[12px] text-muted">{t("report.dayActions", { n: formatNumber(mine.length, locale) })}</span>
                </div>
                {worked(r) === 0 ? (
                  <p className="mt-2 text-[13px] font-bold text-[var(--tone-warn)]">{t("agencies.report.idle")}</p>
                ) : (
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">{FIGURES.map((k) => tile(t(`agencies.report.${k}`), r[k]))}</div>
                )}
                {mine.length > 0 ? (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-[12.5px] font-bold text-muted">{t("report.detail", { n: formatNumber(mine.length, locale) })}</summary>
                    <ul className="mt-2 divide-y divide-border text-[13px]">
                      {mine.map((e) => {
                        const split = e.kind === "declined" ? splitDeclineNote(e.note) : { reason: null, text: e.note };
                        return (
                          <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5">
                            <span className="mazed-tabular w-12 shrink-0 text-[12px] text-muted">{formatDate(e.at, locale, "time")}</span>
                            <span className="font-bold">
                              {t(`agencies.event.${e.kind}`)}
                              {e.channel ? <span className="ms-1 font-normal text-muted">· {t(`work.channel.${e.channel}`)}</span> : null}
                              {split.reason ? <span className="ms-1 font-normal text-muted">· {t(`agencies.reason.${split.reason}`)}</span> : null}
                            </span>
                            <Link href={`/admin/prospection/agences/${e.agencyId}` as "/admin/prospection"} className="min-w-0 flex-1 truncate underline decoration-border underline-offset-2 hover:decoration-[var(--gold)]">
                              {e.name}
                            </Link>
                            {split.text && e.kind !== "assigned" ? <span className="basis-full ps-[3.75rem] text-[12px] text-muted line-clamp-2">{split.text}</span> : null}
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                ) : null}
              </section>
            );
          })}
        </div>
      )}

      <div className="mt-5 rounded-2xl bg-surface p-4 ring-1 ring-border">
        <h3 className="text-[13px] font-extrabold">{t("agencies.report.funnel")}</h3>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
          {tile(t("agencies.kpi.total"), funnel.total)}
          {(["to_call", "contacted", "interested", "signed_up", "posted", "declined"] as const).map((s) => tile(t(`agencies.stage.${s}`), funnel[s]))}
          {tile(t("agencies.due"), funnel.due)}
        </div>
        {reasonEntries.length > 0 ? (
          <>
            <h3 className="mt-4 text-[13px] font-extrabold">{t("agencies.report.reasons")}</h3>
            <ul className="mt-2 flex flex-wrap gap-2 text-[12.5px]">
              {reasonEntries.map(([k, n]) => (
                <li key={k} className="rounded-full bg-surface-2 px-3 py-1 font-bold ring-1 ring-border">
                  {t.has(`agencies.reason.${k}`) ? t(`agencies.reason.${k}`) : k} <span className="mazed-tabular text-muted">· {formatNumber(n, locale)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <p className="mt-3 text-[12px]"><Link href={"/admin/prospection/agences" as "/admin/prospection"} className="font-bold underline">{t("agencies.report.openList")}</Link></p>
      </div>
    </section>
  );
}
