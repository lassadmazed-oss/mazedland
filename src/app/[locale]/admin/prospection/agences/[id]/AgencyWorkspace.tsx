"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { AdminButton } from "@/components/admin/AdminButton";
import { StatusBadge, type BadgeTone } from "@/components/admin/StatusBadge";
import { Ltr } from "@/components/ui/Ltr";
import { formatDate } from "@/lib/utils";
import { TUNISIAN_GOVERNORATES, governorateLabel } from "@/lib/tunisia";
import { CHANNELS, type Channel } from "@/lib/prospection/model";
import { DECLINE_REASONS, splitDeclineNote, type AgencyResult, type AgencyStage, type DeclineReason } from "@/lib/prospection/agencies/model";
import { Copy, ExternalLink, MessageCircle, Phone } from "lucide-react";

export type AgencyEventView = { id: string; kind: string; channel: string | null; note: string | null; by: string | null; at: string };

type Agency = {
  id: string;
  name: string;
  phone: string | null;
  phone2: string | null;
  governorate: string | null;
  city: string | null;
  address: string | null;
  website: string | null;
  facebookUrl: string | null;
  email: string | null;
  legalId: string | null;
  licensed: boolean | null;
  source: string;
  sourceNote: string | null;
  status: "to_call" | "contacted" | "interested" | "declined";
  outcome: string | null;
  declineReason: string | null;
  assignedTo: string | null;
  assignedName: string | null;
  followUpAt: string | null;
  lastContactAt: string | null;
  contactCount: number;
  stage: AgencyStage;
};

type Notice = { tone: "ok" | "bad"; text: string };

const TONE: Record<AgencyStage, BadgeTone> = { to_call: "neutral", contacted: "info", interested: "ok", signed_up: "ok", posted: "ok", declined: "bad" };

// Made for a thumb as much as for a mouse: 44 px tall controls, text that does not make a phone zoom in.
const card = "rounded-2xl bg-surface p-4 ring-1 ring-border";
const field = "mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-[15px] outline-none focus:border-[var(--gold)] disabled:opacity-60";
const label = "block text-[12.5px] font-bold text-muted";
// Two classes that never fight over the background: ink on a light tile, the page colour on the ink one.
const tileBase = "inline-flex h-12 items-center justify-center gap-2 rounded-xl px-3 text-[13.5px] font-bold transition";
const tile = `${tileBase} border border-border bg-surface text-foreground hover:border-[var(--gold-soft)]`;
const tilePrimary = `${tileBase} border border-[var(--gold)] bg-[var(--gold)] text-[var(--background)]`;

const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

export function AgencyWorkspace(props: {
  agency: Agency;
  shop: { id: string; name: string; status: string; online: number } | null;
  events: AgencyEventView[];
  message: string;
  canAssign: boolean;
  members: { id: string; name: string }[];
}) {
  const { agency, shop, events } = props;
  const t = useTranslations("adminProspection");
  const locale = useLocale() as "fr" | "ar";
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const [channel, setChannel] = useState<Channel>("call");
  const [note, setNote] = useState("");
  const [followUp, setFollowUp] = useState(tomorrow());
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState<DeclineReason | "">("");
  const [dnc, setDnc] = useState(false);
  const [assignTo, setAssignTo] = useState(agency.assignedTo ?? "");

  // details
  const [name, setName] = useState(agency.name);
  const [phone, setPhone] = useState(agency.phone ?? "");
  const [phone2, setPhone2] = useState(agency.phone2 ?? "");
  const [governorate, setGovernorate] = useState(agency.governorate ?? "");
  const [city, setCity] = useState(agency.city ?? "");
  const [address, setAddress] = useState(agency.address ?? "");
  const [website, setWebsite] = useState(agency.website ?? "");
  const [facebook, setFacebook] = useState(agency.facebookUrl ?? "");
  const [email, setEmail] = useState(agency.email ?? "");
  const [legalId, setLegalId] = useState(agency.legalId ?? "");
  const [licensed, setLicensed] = useState<"" | "yes" | "no">(agency.licensed === true ? "yes" : agency.licensed === false ? "no" : "");

  const base = `/api/admin/prospection/agences/${agency.id}`;
  const errorText = (code: unknown) => (typeof code === "string" && t.has(`agencies.errors.${code}`) ? t(`agencies.errors.${code}`) : t("agencies.errors.failed"));

  async function call(body: unknown) {
    const res = await fetch(base, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, json };
  }
  async function run(key: string, fn: () => Promise<Notice | null>) {
    if (busy) return;
    setBusy(key);
    setNotice(null);
    try {
      const out = await fn();
      if (out) setNotice(out);
    } catch {
      setNotice({ tone: "bad", text: t("agencies.errors.failed") });
    } finally {
      setBusy(null);
    }
  }

  const result = (kind: AgencyResult) =>
    run(kind, async () => {
      if (kind === "declined" && !declining) {
        setDeclining(true);
        return null;
      }
      if (kind === "declined" && !reason) return { tone: "bad", text: t("agencies.errors.no_reason") };
      if (kind === "callback" && !followUp) return { tone: "bad", text: t("agencies.errors.no_follow_up") };
      const r = await call({
        action: "result", kind,
        // Sending the details is done by a message; the others are calls unless the member says otherwise.
        channel: kind === "info_sent" && channel === "call" ? "whatsapp" : channel,
        reason: kind === "declined" ? reason : undefined,
        note, follow_up_at: kind === "no_answer" || kind === "callback" || kind === "info_sent" || kind === "interested" ? followUp : null,
        do_not_contact: kind === "declined" ? dnc : undefined,
      });
      if (!r.ok) {
        const blockers = Array.isArray(r.json.blockers) ? (r.json.blockers as string[]) : [];
        return { tone: "bad", text: blockers.length ? blockers.map((b) => t(`agencies.errors.${b}`)).join(" · ") : errorText(r.json.error) };
      }
      setNote("");
      setDeclining(false);
      setReason("");
      router.refresh();
      return { tone: "ok", text: t("agencies.work.recorded") };
    });

  const simple = (key: string, body: unknown, done: string) =>
    run(key, async () => {
      const r = await call(body);
      if (!r.ok) return { tone: "bad", text: errorText(r.json.error) };
      router.refresh();
      return { tone: "ok", text: done };
    });

  const saveDetails = () =>
    simple("save", {
      action: "update", name, phone, phone2, governorate: governorate || null, city, address, website, facebook_url: facebook, email, legal_id: legalId,
      licensed: licensed === "yes" ? true : licensed === "no" ? false : null,
    }, t("agencies.work.saved"));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.message);
      setNotice({ tone: "ok", text: t("agencies.work.copied") });
    } catch {
      setNotice({ tone: "bad", text: t("agencies.errors.failed") });
    }
  };

  const digits = agency.phone ? agency.phone.replace(/\D/g, "") : "";
  const waUrl = digits ? `https://wa.me/${digits}?text=${encodeURIComponent(props.message)}` : null;
  const smsUrl = agency.phone ? `sms:${agency.phone}?body=${encodeURIComponent(props.message)}` : null;
  const declined = agency.status === "declined";
  const eventLabel = (e: AgencyEventView) => {
    const split = e.kind === "declined" ? splitDeclineNote(e.note) : null;
    return { text: split ? split.text : e.note, reason: split?.reason ?? null };
  };

  return (
    <div className="mx-auto mt-5 w-full max-w-2xl space-y-4 pb-10">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={TONE[agency.stage]}>{t(`agencies.stage.${agency.stage}`)}</StatusBadge>
        {agency.status === "contacted" && agency.outcome && !shop ? <StatusBadge tone="neutral">{t(`agencies.outcome.${agency.outcome}`)}</StatusBadge> : null}
        {declined && agency.declineReason ? <StatusBadge tone="bad">{t(`agencies.reason.${agency.declineReason}`)}</StatusBadge> : null}
        {agency.licensed === true ? <StatusBadge tone="ok">{t("agencies.work.licensed")}</StatusBadge> : null}
        <span className="text-[12px] text-muted">{agency.assignedName ? t("agencies.work.inChargeOf", { name: agency.assignedName }) : t("agencies.unassigned")}</span>
      </div>

      {notice ? (
        <p role="status" className={`rounded-xl px-4 py-3 text-[13.5px] font-bold ${notice.tone === "ok" ? "bg-[var(--tone-ok-bg)] text-[var(--tone-ok)]" : "bg-[var(--tone-bad-bg)] text-[var(--tone-bad)]"}`}>{notice.text}</p>
      ) : null}

      {shop ? (
        <section className="rounded-2xl bg-[var(--tone-ok-bg)] px-4 py-3 text-[13.5px] text-[var(--tone-ok)]">
          <div className="font-extrabold">{agency.stage === "posted" ? t("agencies.work.posted", { name: shop.name, n: shop.online }) : t("agencies.work.signedUp", { name: shop.name })}</div>
          <div className="mt-0.5 text-[12.5px]">{t("agencies.work.shopStatus", { status: t(`agencies.shopStatus.${shop.status}`) })}</div>
        </section>
      ) : null}

      <section className={card}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[14px] font-extrabold">{t("agencies.work.callTitle")}</h2>
          {agency.contactCount > 0 ? <span className="text-[12px] text-muted">{t("agencies.work.contactCount", { n: agency.contactCount })}</span> : null}
        </div>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {agency.phone ? <Ltr className="text-[20px] font-extrabold">{agency.phone}</Ltr> : <span className="text-[13px] font-bold text-[var(--tone-bad)]">{t("agencies.noPhone")}</span>}
          {agency.phone2 ? <Ltr className="text-[14px] text-muted">{agency.phone2}</Ltr> : null}
        </div>
        {agency.phone && !declined ? (
          <a href={`tel:${agency.phone}`} className={`${tilePrimary} mt-3 w-full`}><Phone className="size-4" /> {t("agencies.work.callNow")}</a>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
          {agency.facebookUrl ? <a href={agency.facebookUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-bold underline"><ExternalLink className="size-3" /> {t("agencies.work.facebook")}</a> : null}
          {agency.website ? <a href={agency.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-bold underline"><ExternalLink className="size-3" /> {t("agencies.work.website")}</a> : null}
        </div>
      </section>

      {declined ? (
        <section className={card}>
          <p className="text-[13px] text-muted">{t("agencies.work.declinedHint")}</p>
          <div className="mt-3">
            <AdminButton size="md" className="!h-11 !px-5" pending={busy === "reopen"} onClick={() => void simple("reopen", { action: "reopen" }, t("agencies.work.reopened"))}>{t("agencies.work.reopen")}</AdminButton>
          </div>
        </section>
      ) : (
        <section className={card}>
          <h2 className="mb-1 text-[14px] font-extrabold">{t("agencies.work.resultTitle")}</h2>
          <p className="text-[12.5px] text-muted">{t("agencies.work.resultHint")}</p>
          <label className={`${label} mt-3`}>{t("agencies.work.channel")}
            <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)} className={field}>
              {CHANNELS.map((c) => <option key={c} value={c}>{t(`work.channel.${c}`)}</option>)}
            </select>
          </label>
          <label className={`${label} mt-3`}>{t("agencies.work.note")}
            <input value={note} onChange={(e) => setNote(e.target.value)} className={field} maxLength={300} />
          </label>
          <label className={`${label} mt-3`}>{t("agencies.work.followUp")}
            <input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} dir="ltr" className={field} />
          </label>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <AdminButton variant="primary" size="md" className="!h-11 !text-[13.5px] col-span-2" pending={busy === "interested"} onClick={() => void result("interested")}>{t("agencies.result.interested")}</AdminButton>
            {(["no_answer", "callback", "info_sent"] as const).map((k) => (
              <AdminButton key={k} size="md" className="!h-11 !text-[13.5px]" pending={busy === k} onClick={() => void result(k)}>{t(`agencies.result.${k}`)}</AdminButton>
            ))}
            <AdminButton variant="danger" size="md" className="!h-11 !text-[13.5px]" pending={busy === "declined"} onClick={() => void result("declined")}>
              {declining ? t("agencies.result.declinedConfirm") : t("agencies.result.declined")}
            </AdminButton>
          </div>
          {declining ? (
            <div className="mt-3 rounded-xl bg-surface-2 p-3">
              <label className={label}>{t("agencies.work.reason")}
                <select value={reason} onChange={(e) => setReason(e.target.value as DeclineReason | "")} className={field}>
                  <option value="">—</option>
                  {DECLINE_REASONS.map((r) => <option key={r} value={r}>{t(`agencies.reason.${r}`)}</option>)}
                </select>
              </label>
              <label className="mt-3 flex items-start gap-2 text-[13px]"><input type="checkbox" className="mt-0.5 size-4" checked={dnc} onChange={(e) => setDnc(e.target.checked)} />{t("agencies.work.dnc")}</label>
            </div>
          ) : null}
        </section>
      )}

      {agency.phone && !declined ? (
        <section className={card}>
          <h2 className="mb-1 text-[14px] font-extrabold">{t("agencies.work.messageTitle")}</h2>
          <p className="text-[12.5px] text-muted">{t("agencies.work.messageHint")}</p>
          <textarea readOnly value={props.message} rows={7} className={`${field} mt-3`} />
          <div className="mt-3 grid grid-cols-2 gap-2">
            {waUrl ? <a href={waUrl} target="_blank" rel="noopener noreferrer" className={`${tile} col-span-2`}><MessageCircle className="size-4" /> {t("work.openWhatsapp")}</a> : null}
            {smsUrl ? <a href={smsUrl} className={tile}>{t("work.openSms")}</a> : null}
            <button type="button" onClick={() => void copy()} className={tile}><Copy className="size-4" /> {t("work.copy")}</button>
          </div>
        </section>
      ) : null}

      {props.canAssign ? (
        <section className={card}>
          <h2 className="mb-1 text-[14px] font-extrabold">{t("agencies.work.assignTitle")}</h2>
          <div className="flex gap-2">
            <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} className={`${field} mt-0`}>
              <option value="">{t("agencies.unassigned")}</option>
              {/* The whole-console owner may hold an agency himself, and he is not on the team list. */}
              {[...props.members, ...(agency.assignedTo && !props.members.some((m) => m.id === agency.assignedTo) ? [{ id: agency.assignedTo, name: agency.assignedName ?? "—" }] : [])].map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <AdminButton size="md" className="!h-11" pending={busy === "assign"} disabled={assignTo === (agency.assignedTo ?? "")} onClick={() => void simple("assign", { action: "assign", assigned_to: assignTo || null }, t("agencies.work.assigned"))}>{t("agencies.work.assign")}</AdminButton>
          </div>
        </section>
      ) : null}

      <details className={card}>
        <summary className="cursor-pointer text-[14px] font-extrabold">{t("agencies.work.detailsTitle")}</summary>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className={`${label} sm:col-span-2`}>{t("agencies.work.name")}<input value={name} onChange={(e) => setName(e.target.value)} className={field} maxLength={160} /></label>
          <label className={label}>{t("agencies.col.phone")}<input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" inputMode="tel" className={field} /></label>
          <label className={label}>{t("agencies.work.phone2")}<input value={phone2} onChange={(e) => setPhone2(e.target.value)} dir="ltr" inputMode="tel" className={field} /></label>
          <label className={label}>{t("agencies.filter.governorate")}
            <select value={governorate} onChange={(e) => setGovernorate(e.target.value)} className={field}>
              <option value="">—</option>
              {TUNISIAN_GOVERNORATES.map((g) => <option key={g} value={g}>{governorateLabel(g, locale)}</option>)}
            </select>
          </label>
          <label className={label}>{t("agencies.work.city")}<input value={city} onChange={(e) => setCity(e.target.value)} className={field} maxLength={120} /></label>
          <label className={`${label} sm:col-span-2`}>{t("agencies.work.address")}<input value={address} onChange={(e) => setAddress(e.target.value)} className={field} maxLength={300} /></label>
          <label className={label}>{t("agencies.work.website")}<input value={website} onChange={(e) => setWebsite(e.target.value)} dir="ltr" className={field} /></label>
          <label className={label}>{t("agencies.work.facebook")}<input value={facebook} onChange={(e) => setFacebook(e.target.value)} dir="ltr" className={field} /></label>
          <label className={label}>{t("agencies.work.email")}<input value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" className={field} /></label>
          <label className={label}>{t("agencies.work.legalId")}<input value={legalId} onChange={(e) => setLegalId(e.target.value)} dir="ltr" className={field} maxLength={60} /></label>
          <label className={label}>{t("agencies.work.licensedLabel")}
            <select value={licensed} onChange={(e) => setLicensed(e.target.value as "" | "yes" | "no")} className={field}>
              <option value="">{t("agencies.work.unknown")}</option>
              <option value="yes">{t("agencies.work.yes")}</option>
              <option value="no">{t("agencies.work.no")}</option>
            </select>
          </label>
        </div>
        {agency.sourceNote || agency.source ? <p className="mt-3 text-[12px] text-muted">{t("agencies.work.source", { source: t(`agencies.source.${agency.source}`), note: agency.sourceNote ?? "—" })}</p> : null}
        <div className="mt-3"><AdminButton variant="primary" size="md" className="!h-11 !px-5" pending={busy === "save"} onClick={() => void saveDetails()}>{t("agencies.work.save")}</AdminButton></div>
      </details>

      <details className={card}>
        <summary className="cursor-pointer text-[14px] font-extrabold">{t("agencies.work.historyCount", { n: events.length })}</summary>
        <ul className="mt-3 divide-y divide-border text-[13px]">
          {events.map((e) => {
            const l = eventLabel(e);
            return (
              <li key={e.id} className="py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold">
                    {t(`agencies.event.${e.kind}`)}
                    {e.channel ? <span className="ms-1 font-normal text-muted">· {t(`work.channel.${e.channel}`)}</span> : null}
                    {l.reason ? <span className="ms-1 font-normal text-muted">· {t(`agencies.reason.${l.reason}`)}</span> : null}
                  </span>
                  <span className="mazed-tabular text-[11px] text-muted">{formatDate(e.at, locale, "dateTime")}{e.by ? ` · ${e.by}` : ""}</span>
                </div>
                {l.text && e.kind !== "assigned" ? <div className="mt-0.5 break-words text-muted">{l.text}</div> : null}
              </li>
            );
          })}
        </ul>
      </details>
    </div>
  );
}
