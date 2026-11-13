/* eslint-disable react-hooks/purity -- Server Component: the clock tells a follow-up
 * that is due from one that is not, and there is no client render to replay. */
import { requireAdmin } from "@/lib/admin/session";
import { Link } from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings/server";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { adminBtn } from "@/components/admin/AdminButton";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { Ltr } from "@/components/ui/Ltr";
import { formatDate, formatNumber } from "@/lib/utils";
import { governorateLabel } from "@/lib/tunisia";
import { Plus, Puzzle } from "lucide-react";
import { contactsLeft, propertyLine, readDraft, startOfTunisiaDay, type LeadStatus } from "@/lib/prospection/model";
import { contactsToday, teamFigures, LEAD_COLUMNS, type LeadRow } from "@/lib/prospection/server";

export const dynamic = "force-dynamic";

const COLUMNS = ["to_contact", "contacted", "confirmed", "online"] as const satisfies readonly LeadStatus[];
const PER_COLUMN = 60;

export async function generateMetadata() {
  const t = await getTranslations("adminProspection");
  return { title: t("title") };
}

export default async function ProspectionBoard({
  searchParams,
}: {
  searchParams: Promise<{ mine?: string }>;
}) {
  const { user, scopes } = await requireAdmin("prospection");
  const { mine } = await searchParams;
  const onlyMine = mine === "1";
  const t = await getTranslations("adminProspection");
  const locale = await getLocale();
  const admin = getServiceSupabase();
  if (!admin) return null;

  const settings = await getSettings();
  const now = Date.now();
  const dayStart = startOfTunisiaDay();

  const fetchColumn = async (status: LeadStatus, limit: number) => {
    let q = admin.from("prospect_leads").select(LEAD_COLUMNS).eq("status", status);
    if (onlyMine) q = q.eq("assigned_to", user.id);
    // Waiting work oldest first (the follow-ups come due), what is done newest first.
    return q.order("created_at", { ascending: status === "to_contact" || status === "contacted" }).limit(limit);
  };
  const [cols, declined, doneToday, myContacts, figures] = await Promise.all([
    Promise.all(COLUMNS.map((s) => fetchColumn(s, PER_COLUMN))),
    fetchColumn("declined", 20),
    admin.from("prospect_events").select("kind").in("kind", ["confirmed", "published"]).gte("created_at", dayStart).eq("actor_id", user.id),
    contactsToday(admin, user.id),
    // The team's figures are the owner's: a member sees their own day, not the others'.
    scopes === null ? teamFigures(admin, new Date(now - 7 * 86_400_000).toISOString()) : Promise.resolve([]),
  ]);

  const byStatus = new Map<LeadStatus, LeadRow[]>();
  COLUMNS.forEach((s, i) => byStatus.set(s, (cols[i].data ?? []) as LeadRow[]));
  const declinedRows = (declined.data ?? []) as LeadRow[];

  const memberIds = new Set<string>();
  for (const rows of [...byStatus.values(), declinedRows]) for (const r of rows) if (r.assigned_to) memberIds.add(r.assigned_to);
  for (const f of figures) memberIds.add(f.actorId);
  const names = new Map<string, string>();
  if (memberIds.size > 0) {
    const { data: profiles } = await admin.from("profiles").select("id, full_name").in("id", [...memberIds]);
    for (const p of profiles ?? []) names.set(p.id as string, (p.full_name as string | null) || "—");
  }

  const yesToday = (doneToday.data ?? []).filter((e) => e.kind === "confirmed").length;
  const onlineToday = (doneToday.data ?? []).filter((e) => e.kind === "published").length;
  const left = contactsLeft(settings.prospect_daily_cap, myContacts);

  const card = (l: LeadRow) => {
    const d = readDraft(l.draft);
    const due = l.follow_up_at && Date.parse(l.follow_up_at) <= now;
    const where = d.delegation ?? (d.governorate ? governorateLabel(d.governorate, locale as "fr" | "ar") : null);
    return (
      <Link
        key={l.id}
        href={`/admin/prospection/${l.id}`}
        className="block rounded-xl bg-surface p-3 text-[12.5px] ring-1 ring-border transition hover:ring-[var(--gold-soft)]"
      >
        <div className="line-clamp-2 font-bold text-foreground">{propertyLine(d) || t("untitled")}</div>
        <div className="mt-0.5 text-muted">
          {[d.price != null ? `${formatNumber(d.price, locale)} DT` : null, where].filter(Boolean).join(" · ") || "—"}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {!l.phone ? <StatusBadge tone="bad">{t("tag.noPhone")}</StatusBadge> : null}
          {l.status === "to_contact" && d.questions.length > 0 ? <StatusBadge tone="warn">{t("tag.questions", { n: d.questions.length })}</StatusBadge> : null}
          {due ? <StatusBadge tone="warn">{t("tag.followUp")}</StatusBadge> : null}
          {l.is_broker ? <StatusBadge tone="info">{t("tag.broker")}</StatusBadge> : null}
          {l.status === "confirmed" ? <StatusBadge tone="ok">{t("tag.yes")}</StatusBadge> : null}
          {l.status === "online" && !l.sms_sent_at ? <StatusBadge tone="warn">{t("tag.noSms")}</StatusBadge> : null}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted">
          <span>{l.assigned_to ? names.get(l.assigned_to) ?? "—" : t("unassigned")}</span>
          <span className="mazed-tabular">{formatDate(l.created_at, locale, "short")}</span>
        </div>
      </Link>
    );
  };

  return (
    <div>
      <AdminPageHeader
        eyebrow={t("eyebrow")}
        title={t("title")}
        description={t("description")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/admin/prospection/extension" className={adminBtn("default", "md")}>
              <Puzzle className="size-3.5" /> {t("extensionLink")}
            </Link>
            <Link href="/admin/prospection/nouveau" className={adminBtn("primary", "md")}>
              <Plus className="size-3.5" /> {t("newLead")}
            </Link>
          </div>
        }
      />

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: t("kpi.contacts"), value: `${formatNumber(myContacts, locale)} / ${formatNumber(settings.prospect_daily_cap, locale)}`, hint: left === 0 ? t("kpi.capReached") : t("kpi.left", { n: left }) },
          { label: t("kpi.yes"), value: formatNumber(yesToday, locale) },
          { label: t("kpi.online"), value: formatNumber(onlineToday, locale) },
          { label: t("kpi.waiting"), value: formatNumber((byStatus.get("to_contact")?.length ?? 0) + (byStatus.get("contacted")?.length ?? 0), locale) },
        ].map((k) => (
          <div key={k.label} className="rounded-xl bg-surface px-4 py-3 ring-1 ring-border">
            <div className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted">{k.label}</div>
            <div className="mazed-tabular mt-1 text-[22px] font-extrabold">{k.value}</div>
            {k.hint ? <div className="mt-0.5 text-[11px] text-muted">{k.hint}</div> : null}
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {[{ key: "all", href: "/admin/prospection" as const }, { key: "mine", href: "/admin/prospection?mine=1" as const }].map((f) => {
          const active = (f.key === "mine") === onlyMine;
          return (
            <Link
              key={f.key}
              href={f.href}
              className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-bold transition-colors ${
                active ? "border-[var(--gold)] bg-[var(--gold)] text-[var(--background)]" : "border-border bg-surface text-muted hover:border-gold-soft"
              }`}
            >
              {t(f.key === "mine" ? "mine" : "all")}
            </Link>
          );
        })}
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((s) => {
          const rows = byStatus.get(s) ?? [];
          return (
            <section key={s} aria-label={t(`col.${s}`)}>
              <h2 className="mb-2 flex items-center justify-between text-[12px] font-extrabold uppercase tracking-[0.1em] text-muted">
                <span>{t(`col.${s}`)}</span>
                <span className="mazed-tabular">{formatNumber(rows.length, locale)}</span>
              </h2>
              <div className="space-y-2">
                {rows.length === 0 ? <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-[12px] text-muted">{t(`empty.${s}`)}</p> : rows.map(card)}
              </div>
            </section>
          );
        })}
      </div>

      {declinedRows.length > 0 ? (
        <details className="mt-6 rounded-xl bg-surface px-4 py-3 ring-1 ring-border">
          <summary className="cursor-pointer text-[12.5px] font-bold text-muted">{t("declined", { n: declinedRows.length })}</summary>
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">{declinedRows.map(card)}</div>
        </details>
      ) : null}

      {scopes === null ? (
        <section className="mt-8">
          <h2 className="mb-2 text-[12px] font-extrabold uppercase tracking-[0.1em] text-muted">{t("team.title")}</h2>
          {figures.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-[12px] text-muted">{t("team.empty")}</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl bg-surface ring-1 ring-border">
              <table className="w-full min-w-[420px] text-[13px]">
                <thead>
                  <tr className="border-b border-border text-start text-[10px] font-extrabold uppercase tracking-[0.12em] text-muted">
                    <th className="px-4 py-3">{t("team.member")}</th>
                    <th className="px-4 py-3">{t("team.contacted")}</th>
                    <th className="px-4 py-3">{t("team.yes")}</th>
                    <th className="px-4 py-3">{t("team.online")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {figures.map((f) => (
                    <tr key={f.actorId}>
                      <td className="px-4 py-2.5 font-bold">{names.get(f.actorId) ?? "—"}</td>
                      <td className="mazed-tabular px-4 py-2.5">{formatNumber(f.contacted, locale)}</td>
                      <td className="mazed-tabular px-4 py-2.5">{formatNumber(f.yes, locale)}</td>
                      <td className="mazed-tabular px-4 py-2.5">{formatNumber(f.online, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-[12px] text-muted">
            {t("team.settings")} <Ltr>·</Ltr>{" "}
            <Link href="/admin/settings" className="font-bold underline">{t("team.settingsLink")}</Link>
          </p>
        </section>
      ) : null}
    </div>
  );
}
