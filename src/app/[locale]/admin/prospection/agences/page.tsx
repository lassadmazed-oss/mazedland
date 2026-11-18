/* eslint-disable react-hooks/purity -- Server Component: the clock tells a follow-up
 * that is due from one that is not, and there is no client render to replay. */
import { requireAdmin } from "@/lib/admin/session";
import { Link } from "@/i18n/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { adminBtn } from "@/components/admin/AdminButton";
import { StatusBadge, type BadgeTone } from "@/components/admin/StatusBadge";
import { Ltr } from "@/components/ui/Ltr";
import { formatDate, formatNumber } from "@/lib/utils";
import { TUNISIAN_GOVERNORATES, governorateLabel } from "@/lib/tunisia";
import { ArrowLeft, FileUp, Phone, Plus } from "lucide-react";
import { teamNames } from "@/lib/prospection/report";
import { stageOf, type AgencyStage } from "@/lib/prospection/agencies/model";
import {
  AGENCY_PAGE_SIZE, agencyFunnel, agencyStockByMember, contactsTodayAgencies, listAgencies, syncAgencyShops, type AgencyRow,
} from "@/lib/prospection/agencies/server";
import { ShareForm } from "./ShareForm";

export const dynamic = "force-dynamic";

const STAGES: AgencyStage[] = ["to_call", "contacted", "interested", "signed_up", "posted", "declined"];
const TONE: Record<AgencyStage, BadgeTone> = { to_call: "neutral", contacted: "info", interested: "ok", signed_up: "ok", posted: "ok", declined: "bad" };

export async function generateMetadata() {
  const t = await getTranslations("adminProspection");
  return { title: t("agencies.title") };
}

export default async function AgenciesBoard({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; gov?: string; who?: string; q?: string; due?: string; page?: string }>;
}) {
  const { user, scopes } = await requireAdmin("prospection");
  const sp = await searchParams;
  const everyone = scopes === null;
  const t = await getTranslations("adminProspection");
  const locale = (await getLocale()) as "fr" | "ar";
  const admin = getServiceSupabase();
  if (!admin) return null;

  // The site finds who signed up and who posted by itself: the list is matched on every visit (a few hundred rows).
  await syncAgencyShops(admin).catch(() => undefined);

  const stage = STAGES.find((s) => s === sp.stage) ?? null;
  const gov = (TUNISIAN_GOVERNORATES as readonly string[]).includes(sp.gov ?? "") ? sp.gov! : null;
  const page = Math.max(0, Number.parseInt(sp.page ?? "0", 10) || 0);
  const due = sp.due === "1";
  // A member sees the agencies in their charge, always; the owner may narrow to one member or to the unassigned.
  const team = await teamNames(admin);
  const who = everyone ? (sp.who === "none" ? "none" : team.has(sp.who ?? "") ? sp.who! : sp.who === "mine" ? user.id : null) : user.id;

  const filter = {
    assignedTo: who && who !== "none" ? who : null,
    unassigned: who === "none",
    stage, governorate: gov, q: sp.q ?? null, due, page,
  };
  const [{ rows, total }, funnel, callsToday, stock] = await Promise.all([
    listAgencies(admin, filter),
    agencyFunnel(admin, everyone ? undefined : user.id),
    contactsTodayAgencies(admin, user.id),
    everyone ? agencyStockByMember(admin) : Promise.resolve([]),
  ]);

  const names = new Map(team);
  const missing = [...new Set(rows.map((r) => r.assigned_to).filter((x): x is string => !!x && !names.has(x)))];
  if (missing.length > 0) {
    const { data } = await admin.from("profiles").select("id, full_name").in("id", missing);
    for (const p of data ?? []) names.set(p.id as string, (p.full_name as string | null) || "—");
  }
  for (const s of stock) if (s.assignedTo && !names.has(s.assignedTo)) {
    const { data } = await admin.from("profiles").select("full_name").eq("id", s.assignedTo).maybeSingle();
    names.set(s.assignedTo, (data?.full_name as string | null) || "—");
  }
  const unassignedCount = stock.find((s) => s.assignedTo === null)?.total ?? 0;
  const now = Date.now();

  const href = (over: Record<string, string | null>): "/admin/prospection" => {
    const base: Record<string, string | null> = {
      stage, gov, who: everyone ? (who === user.id ? "mine" : who) : null, q: sp.q ?? null, due: due ? "1" : null, page: page ? String(page) : null,
    };
    const merged = { ...base, ...over };
    const qs = Object.entries(merged).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join("&");
    return (qs ? `/admin/prospection/agences?${qs}` : "/admin/prospection/agences") as "/admin/prospection";
  };

  const row = (a: AgencyRow) => {
    const st = stageOf(a);
    const dueNow = a.follow_up_at && Date.parse(a.follow_up_at) <= now && a.status !== "declined";
    return (
      <tr key={a.id} className="hover:bg-surface-2/60">
        <td className="px-3 py-2.5">
          <Link href={`/admin/prospection/agences/${a.id}` as "/admin/prospection"} className="font-bold underline decoration-border underline-offset-2 hover:decoration-[var(--gold)]">{a.name}</Link>
          <div className="text-[11.5px] text-muted">{[a.city, a.governorate ? governorateLabel(a.governorate, locale) : null].filter(Boolean).join(" · ") || "—"}</div>
          <div className="mt-0.5 text-[12px] sm:hidden">{a.phone ? <Ltr>{a.phone}</Ltr> : <span className="text-muted">{t("agencies.noPhone")}</span>}</div>
        </td>
        <td className="hidden px-3 py-2.5 sm:table-cell">{a.phone ? <Ltr className="text-[13px]">{a.phone}</Ltr> : <span className="text-muted">{t("agencies.noPhone")}</span>}</td>
        <td className="px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-1">
            <StatusBadge tone={TONE[st]}>{t(`agencies.stage.${st}`)}</StatusBadge>
            {a.status === "contacted" && a.outcome && !a.shop_id ? <StatusBadge tone="neutral">{t(`agencies.outcome.${a.outcome}`)}</StatusBadge> : null}
            {dueNow ? <StatusBadge tone="warn">{t("agencies.due")}</StatusBadge> : null}
          </div>
        </td>
        <td className="hidden px-3 py-2.5 text-[12.5px] sm:table-cell">{a.assigned_to ? names.get(a.assigned_to) ?? "—" : <span className="text-muted">{t("agencies.unassigned")}</span>}</td>
        <td className="mazed-tabular hidden px-3 py-2.5 text-[12px] text-muted md:table-cell">
          {a.last_contact_at ? formatDate(a.last_contact_at, locale, "short") : "—"}
          {a.follow_up_at && a.status !== "declined" ? <div>{t("agencies.followUpOn", { date: formatDate(a.follow_up_at, locale, "short") })}</div> : null}
        </td>
      </tr>
    );
  };

  const pages = Math.max(1, Math.ceil(total / AGENCY_PAGE_SIZE));

  return (
    <div>
      <Link href="/admin/prospection" className="mb-3 inline-flex items-center gap-1 text-[12px] font-bold text-muted hover:text-foreground">
        <ArrowLeft className="size-3.5 rtl:rotate-180" /> {t("agencies.back")}
      </Link>
      <AdminPageHeader eyebrow={t("eyebrow")} title={t("agencies.title")} description={t("agencies.description")} />
      {/* Under the header, not beside it: beside it the title and the text were squeezed into a column on a phone. */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {everyone ? (
          <Link href={"/admin/prospection/agences/import" as "/admin/prospection"} className={adminBtn("default", "md")}>
            <FileUp className="size-3.5" /> {t("agencies.importLink")}
          </Link>
        ) : null}
        <Link href={"/admin/prospection/agences/nouvelle" as "/admin/prospection"} className={adminBtn("primary", "md")}>
          <Plus className="size-3.5" /> {t("agencies.newLink")}
        </Link>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        {[
          { label: t("agencies.kpi.total"), value: funnel.total },
          { label: t("agencies.stage.to_call"), value: funnel.to_call },
          { label: t("agencies.stage.contacted"), value: funnel.contacted },
          { label: t("agencies.stage.interested"), value: funnel.interested },
          { label: t("agencies.stage.signed_up"), value: funnel.signed_up },
          { label: t("agencies.stage.posted"), value: funnel.posted },
          { label: t("agencies.stage.declined"), value: funnel.declined },
          { label: t("agencies.kpi.callsToday"), value: callsToday },
        ].map((k) => (
          <div key={k.label} className="rounded-xl bg-surface px-3 py-3 ring-1 ring-border">
            <div className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-muted">{k.label}</div>
            <div className="mazed-tabular mt-1 text-[22px] font-extrabold">{formatNumber(k.value, locale)}</div>
          </div>
        ))}
      </div>
      {funnel.due > 0 ? (
        <p className="mt-3 rounded-xl bg-[var(--tone-warn-bg)] px-4 py-2.5 text-[13px] font-bold text-[var(--tone-warn)]">
          {t("agencies.dueBanner", { n: formatNumber(funnel.due, locale) })}{" "}
          <Link href={href({ due: "1", page: null })} className="underline">{t("agencies.showDue")}</Link>
        </p>
      ) : null}

      {everyone ? (
        <section className="mt-6">
          <h2 className="mb-2 text-[12px] font-extrabold uppercase tracking-[0.1em] text-muted">{t("agencies.teamTitle")}</h2>
          <div className="overflow-x-auto rounded-2xl bg-surface ring-1 ring-border">
            <table className="w-full min-w-[560px] text-[13px]">
              <thead>
                <tr className="border-b border-border text-start text-[10px] font-extrabold uppercase tracking-[0.12em] text-muted">
                  <th className="px-4 py-3">{t("team.member")}</th>
                  <th className="px-3 py-3">{t("agencies.kpi.total")}</th>
                  <th className="px-3 py-3">{t("agencies.stage.to_call")}</th>
                  <th className="px-3 py-3">{t("agencies.stage.contacted")}</th>
                  <th className="px-3 py-3">{t("agencies.stage.interested")}</th>
                  <th className="px-3 py-3">{t("agencies.stage.signed_up")}</th>
                  <th className="px-3 py-3">{t("agencies.stage.posted")}</th>
                  <th className="px-3 py-3">{t("agencies.stage.declined")}</th>
                  <th className="px-3 py-3">{t("agencies.due")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {stock.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-6 text-center text-[12px] text-muted">{t("agencies.empty")}</td></tr>
                ) : stock.map((s) => (
                  <tr key={s.assignedTo ?? "none"}>
                    <td className="px-4 py-2.5 font-bold">
                      <Link href={href({ who: s.assignedTo ?? "none", page: null })}>{s.assignedTo ? names.get(s.assignedTo) ?? "—" : t("agencies.unassigned")}</Link>
                    </td>
                    {[s.total, s.to_call, s.contacted, s.interested, s.signed_up, s.posted, s.declined, s.due].map((n, i) => (
                      <td key={i} className="mazed-tabular px-3 py-2.5">{formatNumber(n, locale)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ShareForm unassigned={unassignedCount} members={[...team.entries()].map(([id, name]) => ({ id, name }))} />
        </section>
      ) : null}

      <form method="get" className="mt-6 flex flex-wrap items-end gap-2">
        {everyone && who ? <input type="hidden" name="who" value={who === user.id ? "mine" : who} /> : null}
        <label className="text-[11.5px] font-bold text-muted">{t("agencies.filter.stage")}
          <select name="stage" defaultValue={stage ?? ""} className="mt-1 block h-10 rounded-xl border border-border bg-surface px-3 text-[13px] text-foreground">
            <option value="">{t("agencies.filter.all")}</option>
            {STAGES.map((s) => <option key={s} value={s}>{t(`agencies.stage.${s}`)}</option>)}
          </select>
        </label>
        <label className="text-[11.5px] font-bold text-muted">{t("agencies.filter.governorate")}
          <select name="gov" defaultValue={gov ?? ""} className="mt-1 block h-10 rounded-xl border border-border bg-surface px-3 text-[13px] text-foreground">
            <option value="">{t("agencies.filter.all")}</option>
            {TUNISIAN_GOVERNORATES.map((g) => <option key={g} value={g}>{governorateLabel(g, locale)}</option>)}
          </select>
        </label>
        <label className="text-[11.5px] font-bold text-muted">{t("agencies.filter.search")}
          <input name="q" defaultValue={sp.q ?? ""} className="mt-1 block h-10 w-44 rounded-xl border border-border bg-surface px-3 text-[13px] text-foreground" />
        </label>
        <label className="flex h-10 items-center gap-2 text-[12.5px] font-bold text-muted">
          <input type="checkbox" name="due" value="1" defaultChecked={due} className="size-4" /> {t("agencies.filter.due")}
        </label>
        <button type="submit" className={adminBtn("default", "md")}>{t("agencies.filter.apply")}</button>
        {stage || gov || sp.q || due || (everyone && who) ? <Link href="/admin/prospection/agences" className="h-10 content-center text-[12.5px] font-bold underline">{t("agencies.filter.reset")}</Link> : null}
      </form>

      <p className="mt-4 text-[12.5px] text-muted">{t("agencies.count", { n: formatNumber(total, locale) })}</p>
      <div className="mt-2 overflow-x-auto rounded-2xl bg-surface ring-1 ring-border">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border text-start text-[10px] font-extrabold uppercase tracking-[0.12em] text-muted">
              <th className="px-3 py-3">{t("agencies.col.agency")}</th>
              <th className="hidden px-3 py-3 sm:table-cell"><Phone className="inline size-3" /> {t("agencies.col.phone")}</th>
              <th className="px-3 py-3">{t("agencies.col.stage")}</th>
              <th className="hidden px-3 py-3 sm:table-cell">{t("agencies.col.member")}</th>
              <th className="hidden px-3 py-3 md:table-cell">{t("agencies.col.last")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 ? <tr><td colSpan={5} className="px-4 py-8 text-center text-[12.5px] text-muted">{t("agencies.empty")}</td></tr> : rows.map(row)}
          </tbody>
        </table>
      </div>

      {pages > 1 ? (
        <nav className="mt-4 flex items-center justify-between text-[12.5px]" aria-label={t("agencies.pages")}>
          {page > 0 ? <Link href={href({ page: page > 1 ? String(page - 1) : null })} className={adminBtn("default", "sm")}>{t("agencies.prev")}</Link> : <span />}
          <span className="mazed-tabular text-muted">{formatNumber(page + 1, locale)} / {formatNumber(pages, locale)}</span>
          {page + 1 < pages ? <Link href={href({ page: String(page + 1) })} className={adminBtn("default", "sm")}>{t("agencies.next")}</Link> : <span />}
        </nav>
      ) : null}
    </div>
  );
}
