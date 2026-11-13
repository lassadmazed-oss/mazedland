"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { AdminButton } from "@/components/admin/AdminButton";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { PhotoUploader, type UploadedPhoto } from "@/components/listing/PhotoUploader";
import { Ltr } from "@/components/ui/Ltr";
import { formatDate } from "@/lib/utils";
import { annoncePhotoUrl } from "@/lib/imageUrl";
import type { PhotoCheckResult } from "@/lib/prospection/photoCheck.server";
import type { ListingDraft } from "@/lib/ai/listing";
import {
  CHANNELS, confirmBlockers, publishBlockers, type Channel, type LeadStatus,
} from "@/lib/prospection/model";
import type { Warnings } from "@/lib/prospection/server";
import { Check, CircleAlert, Copy, ExternalLink, MessageCircle, Phone, Search, Star } from "lucide-react";

export type WorkspaceEvent = { id: string; kind: string; channel: string | null; note: string | null; by: string | null; at: string };

type Lead = {
  id: string;
  status: LeadStatus;
  phone: string | null;
  name: string | null;
  url: string | null;
  sourceText: string;
  language: "ar" | "fr";
  isBroker: boolean;
  assignedTo: string | null;
  followUpAt: string | null;
  outcome: string | null;
  confirmationText: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  listingId: string | null;
  listingStatus: string | null;
  smsSentAt: string | null;
  smsError: string | null;
  createdAt: string;
};

type Notice = { tone: "ok" | "bad"; text: string };

const STATUS_TONE: Record<LeadStatus, "neutral" | "info" | "ok" | "warn" | "bad"> = {
  to_contact: "neutral", contacted: "info", confirmed: "ok", online: "ok", declined: "bad",
};

// Made for a thumb as much as for a mouse: 44 px tall controls, text that does not make a phone zoom in.
const card = "rounded-2xl bg-surface p-4 ring-1 ring-border";
const field = "mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-[15px] outline-none focus:border-[var(--gold)] disabled:opacity-60";
const label = "block text-[12.5px] font-bold text-muted";
const big = "!h-11 !px-5 !text-[14px] w-full sm:w-auto";
// Two classes that never fight over the background (one utility each): ink on a light tile, the page colour on the ink one.
const tileBase = "inline-flex h-12 items-center justify-center gap-2 rounded-xl px-3 text-[13.5px] font-bold transition";
const tile = `${tileBase} border border-border bg-surface text-foreground hover:border-[var(--gold-soft)]`;
const tilePrimary = `${tileBase} border border-[var(--gold)] bg-[var(--gold)] text-[var(--background)]`;

const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

type Step = 1 | 2 | 3 | 4;
const STEPS = ["draft", "write", "yes", "publish"] as const;

export function LeadWorkspace(props: {
  lead: Lead;
  draft: ListingDraft;
  photos: UploadedPhoto[];
  events: WorkspaceEvent[];
  warnings: Warnings;
  ask: string;
  members: { id: string; name: string }[];
  categories: { slug: string; label: string }[];
  governorates: { value: string; label: string }[];
  minPhotos: number;
  contactsLeft: number;
  meId: string;
}) {
  const { lead, draft, events, warnings, ask, members, categories, governorates, minPhotos } = props;
  const t = useTranslations("adminProspection");
  const locale = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  // ── the draft, as typed ──
  const [phone, setPhone] = useState(lead.phone ?? "");
  const [name, setName] = useState(lead.name ?? "");
  const url = lead.url ?? "";
  const [broker, setBroker] = useState(lead.isBroker);
  const [deal, setDeal] = useState(draft.deal);
  const [category, setCategory] = useState(draft.categorySlug ?? "");
  const [governorate, setGovernorate] = useState(draft.governorate ?? "");
  const [delegation, setDelegation] = useState(draft.delegation ?? "");
  const [price, setPrice] = useState(draft.price != null ? String(draft.price) : "");
  const [area, setArea] = useState(draft.areaSqm != null ? String(draft.areaSqm) : "");
  const [rooms, setRooms] = useState(draft.rooms != null ? String(draft.rooms) : "");
  const [bathrooms, setBathrooms] = useState(draft.bathrooms != null ? String(draft.bathrooms) : "");
  const [title, setTitle] = useState(draft.title ?? "");
  const [description, setDescription] = useState(draft.description ?? "");

  // ── the conversation ──
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [note, setNote] = useState("");
  const [followUp, setFollowUp] = useState(tomorrow());
  const [reply, setReply] = useState("");
  const [replyChannel, setReplyChannel] = useState<Channel | "">("whatsapp");
  const [armed, setArmed] = useState<string | null>(null);

  // ── photos ──
  const [photos, setPhotos] = useState<UploadedPhoto[]>(props.photos);
  const [pending, setPending] = useState(0);
  const [checkedNoPhone, setCheckedNoPhone] = useState(false);
  const [checkedNoMark, setCheckedNoMark] = useState(false);
  const [check, setCheck] = useState<PhotoCheckResult | null>(null);
  const editable = lead.status !== "online";
  const locked = lead.status === "online" || lead.status === "declined";

  // ── the four steps: where the lead stands decides where the member lands ──
  const [step, setStep] = useState<Step>(
    lead.status === "confirmed" || lead.status === "online" ? 4 : lead.status === "contacted" || lead.status === "declined" ? 2 : 1,
  );
  const draftReady = !!(category && governorate && title.trim());
  const done: Record<Step, boolean> = {
    1: draftReady,
    2: lead.status === "contacted" || lead.status === "confirmed" || lead.status === "online",
    3: lead.status === "confirmed" || lead.status === "online",
    4: lead.status === "online",
  };
  const go = (s: Step) => {
    setStep(s);
    setNotice(null);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const call = async (path: string, method: string, body?: unknown) => {
    const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, json };
  };
  const base = `/api/admin/prospection/leads/${lead.id}`;

  async function run(key: string, fn: () => Promise<Notice | null>) {
    if (busy) return;
    setBusy(key);
    setNotice(null);
    try {
      const out = await fn();
      if (out) setNotice(out);
    } catch {
      setNotice({ tone: "bad", text: t("work.errors.failed") });
    } finally {
      setBusy(null);
    }
  }
  const errorText = (code: unknown) => (typeof code === "string" && t.has(`work.errors.${code}`) ? t(`work.errors.${code}`) : t("work.errors.failed"));

  const draftBody = () => {
    const n = (v: string) => (v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v));
    return {
      deal, categorySlug: category || null, governorate: governorate || null, delegation: delegation.trim() || null,
      price: n(price), areaSqm: n(area), rooms: n(rooms), bathrooms: n(bathrooms),
      title: title.trim() || null, description: description.trim() || null,
    };
  };

  /** Saves the draft; with `then`, moves on once it is saved. */
  const save = (then?: Step) =>
    run("save", async () => {
      const r = await call(base, "PATCH", { action: "update", phone, name, url, is_broker: broker, draft: draftBody() });
      if (!r.ok) return { tone: "bad", text: errorText(r.json.error) };
      router.refresh();
      if (then) go(then);
      return then ? null : { tone: "ok", text: t("work.saved") };
    });

  const contacted = () =>
    run("contacted", async () => {
      // What was typed is saved first: the message and the number must be the ones written to.
      const s = await call(base, "PATCH", { action: "update", phone, name, url, is_broker: broker, draft: draftBody() });
      if (!s.ok) return { tone: "bad", text: errorText(s.json.error) };
      const r = await call(base, "PATCH", { action: "contacted", channel });
      if (!r.ok) return { tone: "bad", text: errorText(r.json.error) };
      router.refresh();
      return { tone: "ok", text: t("work.contactedDone", { n: Number(r.json.left ?? 0) }) };
    });

  const result = (kind: "no_answer" | "thinking" | "refused" | "wrong_number") =>
    run(kind, async () => {
      if ((kind === "refused" || kind === "wrong_number") && armed !== kind) {
        setArmed(kind);
        return { tone: "bad", text: t("work.sureDnc") };
      }
      setArmed(null);
      const r = await call(base, "PATCH", { action: "result", kind, note, follow_up_at: kind === "no_answer" || kind === "thinking" ? followUp : null });
      if (!r.ok) return { tone: "bad", text: errorText(r.json.error) };
      setNote("");
      router.refresh();
      return { tone: "ok", text: t("work.recorded") };
    });

  const confirm = () =>
    run("confirm", async () => {
      const s = await call(base, "PATCH", { action: "update", phone, name, url, is_broker: broker, draft: draftBody() });
      if (!s.ok) return { tone: "bad", text: errorText(s.json.error) };
      const r = await call(`${base}/confirm`, "POST", { reply, channel: replyChannel || null });
      if (!r.ok) {
        const blockers = Array.isArray(r.json.blockers) ? (r.json.blockers as string[]) : [];
        return { tone: "bad", text: blockers.length ? blockers.map((b) => t(`work.confirmBlockers.${b}`)).join(" · ") : errorText(r.json.error) };
      }
      router.refresh();
      go(4);
      return { tone: "ok", text: t("work.confirmedDone") };
    });

  const publish = () =>
    run("publish", async () => {
      const r = await call(`${base}/publish`, "POST", { photosChecked: checkedNoPhone && checkedNoMark });
      if (!r.ok) {
        const blockers = Array.isArray(r.json.blockers) ? (r.json.blockers as string[]) : [];
        if (blockers.length) return { tone: "bad", text: blockers.map((b) => t(`work.publishBlockers.${b}`, { min: minPhotos })).join(" · ") };
        return { tone: "bad", text: errorText(r.json.error) };
      }
      router.refresh();
      const sms = r.json.sms as { sent?: boolean; error?: string } | null;
      if (r.json.outcome === "pending_review") return { tone: "ok", text: t("work.publishedPending") };
      return { tone: "ok", text: sms?.sent ? t("work.publishedSms") : t("work.publishedNoSms", { error: sms?.error ?? "—" }) };
    });

  const resendSms = () =>
    run("sms", async () => {
      const r = await call(`${base}/sms`, "POST");
      router.refresh();
      return r.ok ? { tone: "ok", text: t("work.smsSent") } : { tone: "bad", text: errorText((r.json.sms as { error?: string } | undefined)?.error ?? r.json.error) };
    });

  const reopen = () =>
    run("reopen", async () => {
      const r = await call(base, "PATCH", { action: "reopen" });
      if (!r.ok) return { tone: "bad", text: errorText(r.json.error) };
      router.refresh();
      return null;
    });

  const addNote = () =>
    run("note", async () => {
      const r = await call(base, "PATCH", { action: "note", note });
      if (!r.ok) return { tone: "bad", text: errorText(r.json.error) };
      setNote("");
      router.refresh();
      return null;
    });

  const assign = (to: string) =>
    run("assign", async () => {
      const r = await call(base, "PATCH", { action: "update", assigned_to: to || null });
      if (!r.ok) return { tone: "bad", text: errorText(r.json.error) };
      router.refresh();
      return null;
    });

  // « Vérifier les photos »: what each photo shows, what a person would object to, which are already on the site.
  const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");
  const checkNow = check && sameSet(check.photos.map((p) => p.path), photos.map((p) => p.path)) ? check : null;
  const runCheck = () =>
    run("check", async () => {
      const r = await call(`${base}/photo-check`, "POST");
      if (!r.ok) return { tone: "bad", text: errorText(r.json.error) };
      setCheck(r.json as unknown as PhotoCheckResult);
      return null;
    });
  const applyOrder = () => {
    if (checkNow) setPhotos(checkNow.order.map((path) => ({ path })));
  };

  // The gallery is saved as soon as every upload has landed.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (pending > 0 || lead.status !== "confirmed") return;
    const timer = window.setTimeout(() => {
      void call(`/api/admin/prospection/leads/${lead.id}/photos`, "PUT", { paths: photos.map((p) => p.path) });
    }, 400);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos, pending]);

  const draftNow = useMemo(() => ({ ...draft, deal, categorySlug: category || null, governorate: governorate || null, title: title.trim() || null, price: price.trim() === "" ? null : Number(price) }), [draft, deal, category, governorate, title, price]);
  const confirmHints = confirmBlockers({ status: lead.status, phone: phone ? phone : null, doNotContact: warnings.doNotContact, draft: draftNow, reply, channel: replyChannel || null });
  const publishHints = publishBlockers({
    status: lead.status, hasListing: !!lead.listingId, photoCount: photos.length, minPhotos, photosChecked: checkedNoPhone && checkedNoMark, draft: draftNow,
  });
  const waUrl = lead.phone ? `https://wa.me/${lead.phone.replace(/\D/g, "")}?text=${encodeURIComponent(ask)}` : null;
  const smsUrl = lead.phone ? `sms:${lead.phone}?body=${encodeURIComponent(ask)}` : null;
  const telUrl = lead.phone ? `tel:${lead.phone}` : null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ask);
      setNotice({ tone: "ok", text: t("work.copied") });
    } catch {
      setNotice({ tone: "bad", text: t("work.errors.failed") });
    }
  };

  const panel = (n: Step) => (step === n ? "space-y-4" : "hidden");
  const back = (to: Step) => (
    <AdminButton variant="quiet" size="md" onClick={() => go(to)}>{t("work.prev")}</AdminButton>
  );

  return (
    <div className="mx-auto mt-5 w-full max-w-2xl pb-10">
      {/* ── the four steps ── */}
      <nav aria-label={t("work.stepsLabel")} className="-mx-1 overflow-x-auto px-1 pb-1">
        <ol className="flex min-w-max gap-2">
          {STEPS.map((key, i) => {
            const n = (i + 1) as Step;
            const current = step === n;
            return (
              <li key={key}>
                <button
                  type="button"
                  aria-current={current ? "step" : undefined}
                  onClick={() => go(n)}
                  className={`flex h-11 items-center gap-2 rounded-full border px-3.5 text-[13px] font-bold transition ${
                    current
                      ? "border-[var(--gold)] bg-[var(--gold)] text-[var(--background)]"
                      : done[n]
                        ? "border-[var(--tone-ok-ring)] bg-[var(--tone-ok-bg)] text-[var(--tone-ok)]"
                        : "border-border bg-surface text-muted hover:border-[var(--gold-soft)]"
                  }`}
                >
                  <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] ${current ? "bg-[var(--background)] text-foreground" : "bg-surface-2"}`}>
                    {done[n] && !current ? <Check className="size-3.5" aria-hidden /> : n}
                  </span>
                  {/* On a phone only the current step keeps its name: the four fit without scrolling. */}
                  <span className={current ? "" : "hidden sm:inline"}>{t(`work.steps.${key}`)}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StatusBadge tone={STATUS_TONE[lead.status]}>{t(`col.${lead.status}`)}</StatusBadge>
        {lead.status === "declined" ? <StatusBadge tone="bad">{lead.outcome ? t(`work.outcome.${lead.outcome}`) : t("col.declined")}</StatusBadge> : null}
        {broker ? <StatusBadge tone="info">{t("tag.broker")}</StatusBadge> : null}
        {lead.url ? (
          <a href={lead.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12.5px] font-bold text-muted underline">
            {t("work.openPost")} <ExternalLink className="size-3" />
          </a>
        ) : null}
      </div>
      <p className="mt-2 text-[13px] text-muted">{t(`work.stepHint.${STEPS[step - 1]}`)}</p>

      {lead.status === "declined" ? (
        <div className={`${card} mt-3`}>
          <p className="text-[13px] text-muted">{t("work.declinedHint")}</p>
          <div className="mt-2"><AdminButton pending={busy === "reopen"} onClick={() => void reopen()}>{t("work.reopen")}</AdminButton></div>
        </div>
      ) : null}

      {notice ? (
        <p role="status" className={`mt-3 rounded-xl px-4 py-3 text-[13.5px] font-bold ${notice.tone === "ok" ? "bg-[var(--tone-ok-bg)] text-[var(--tone-ok)]" : "bg-[var(--tone-bad-bg)] text-[var(--tone-bad)]"}`}>
          {notice.text}
        </p>
      ) : null}

      <div className="mt-4">
        {/* ── 1 · the annonce, as the post describes it ── */}
        <div role="tabpanel" className={panel(1)}>
          {warnings.doNotContact ? <p role="alert" className="rounded-xl bg-[var(--tone-bad-bg)] px-3 py-2.5 text-[13px] font-bold text-[var(--tone-bad)]">{t("work.warn.dnc")}</p> : null}
          {warnings.member ? <p className="rounded-xl bg-[var(--tone-warn-bg)] px-3 py-2.5 text-[13px] text-[var(--tone-warn)]">{t("work.warn.member", { name: warnings.member.name ?? "—" })}</p> : null}
          {warnings.others.length > 0 ? <p className="rounded-xl bg-[var(--tone-warn-bg)] px-3 py-2.5 text-[13px] text-[var(--tone-warn)]">{t("work.warn.others", { n: warnings.others.length })}</p> : null}
          {draft.questions.length > 0 && editable ? (
            <div className="rounded-2xl bg-surface-2 px-4 py-3 text-[13px]">
              <div className="font-bold">{t("work.questions")}</div>
              <ul className="mt-1 list-disc ps-5 text-muted">{draft.questions.map((q) => <li key={q}>{q}</li>)}</ul>
            </div>
          ) : null}

          <section className={card}>
            <h2 className="mb-3 text-[14px] font-extrabold">{t("work.whoTitle")}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className={label}>{t("work.phone")}
                <input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" inputMode="tel" disabled={locked || !!lead.listingId} className={`${field} text-[17px] font-bold`} />
              </label>
              <label className={label}>{t("work.name")}
                <input value={name} onChange={(e) => setName(e.target.value)} disabled={locked} className={field} maxLength={120} />
              </label>
            </div>
            <label className="mt-3 flex items-center gap-2 text-[13px] text-muted">
              <input type="checkbox" checked={broker} onChange={(e) => setBroker(e.target.checked)} disabled={locked} className="size-4" />
              {t("work.broker")}
            </label>
            {broker ? <p className="mt-1 text-[12.5px] text-muted">{t("work.brokerHint")}</p> : null}
            <label className={`${label} mt-3`}>{t("work.assignedTo")}
              <select value={lead.assignedTo ?? ""} onChange={(e) => void assign(e.target.value)} className={field}>
                <option value="">{t("unassigned")}</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
          </section>

          <section className={card}>
            <h2 className="mb-3 text-[14px] font-extrabold">{t("work.draft")}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className={label}>{t("work.deal")}
                <select value={deal} onChange={(e) => setDeal(e.target.value as "sale" | "rent")} disabled={locked} className={field}>
                  <option value="sale">{t("work.sale")}</option>
                  <option value="rent">{t("work.rent")}</option>
                </select>
              </label>
              <label className={label}>{t("work.category")}
                <select value={category} onChange={(e) => setCategory(e.target.value)} disabled={locked} className={field}>
                  <option value="">—</option>
                  {categories.map((c) => <option key={c.slug} value={c.slug}>{c.label}</option>)}
                </select>
              </label>
              <label className={label}>{t("work.governorate")}
                <select value={governorate} onChange={(e) => setGovernorate(e.target.value)} disabled={locked} className={field}>
                  <option value="">—</option>
                  {governorates.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                </select>
              </label>
              <label className={label}>{t("work.price")}
                <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" dir="ltr" disabled={locked} className={field} />
              </label>
              <label className={label}>{t("work.area")}
                <input value={area} onChange={(e) => setArea(e.target.value)} inputMode="decimal" dir="ltr" disabled={locked} className={field} />
              </label>
            </div>
            <label className={`${label} mt-3`}>{t("work.titleField")}
              <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={locked} className={field} maxLength={140} />
            </label>

            <details className="mt-3 rounded-xl bg-surface-2 px-3 py-2">
              <summary className="cursor-pointer text-[13px] font-bold">{t("work.moreDetails")}</summary>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className={label}>{t("work.delegation")}
                  <input value={delegation} onChange={(e) => setDelegation(e.target.value)} disabled={locked} className={field} maxLength={80} />
                </label>
                <label className={label}>{t("work.rooms")}
                  <input value={rooms} onChange={(e) => setRooms(e.target.value)} inputMode="numeric" dir="ltr" disabled={locked} className={field} />
                </label>
                <label className={label}>{t("work.bathrooms")}
                  <input value={bathrooms} onChange={(e) => setBathrooms(e.target.value)} inputMode="numeric" dir="ltr" disabled={locked} className={field} />
                </label>
              </div>
              <label className={`${label} mt-3`}>{t("work.description")}
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} disabled={locked} className={field} maxLength={4000} />
              </label>
            </details>
          </section>

          <details className={card}>
            <summary className="cursor-pointer text-[14px] font-extrabold">{t("work.sourceText")}</summary>
            <p className="mt-3 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-muted">{lead.sourceText}</p>
          </details>

          <div className="flex flex-col gap-2 sm:flex-row">
            {editable ? <AdminButton variant="primary" size="md" className={big} pending={busy === "save"} onClick={() => void save(2)}>{t("work.saveNext")}</AdminButton> : <AdminButton variant="primary" size="md" className={big} onClick={() => go(2)}>{t("work.next")}</AdminButton>}
            {editable ? <AdminButton variant="default" size="md" className={big} pending={busy === "save"} onClick={() => void save()}>{t("work.save")}</AdminButton> : null}
          </div>
        </div>

        {/* ── 2 · write to the owner, and what he answers ── */}
        <div role="tabpanel" className={panel(2)}>
          <section className={card}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[14px] font-extrabold">{t("work.contactTitle")}</h2>
              {lead.phone ? <Ltr className="text-[15px] font-bold">{lead.phone}</Ltr> : null}
            </div>
            <p className="mt-1 text-[12.5px] text-muted">{t("work.contactHint")}</p>
            <textarea readOnly value={ask} rows={7} className={`${field} mt-3`} />
            <div className="mt-3 grid grid-cols-2 gap-2">
              {waUrl ? (
                <a href={waUrl} target="_blank" rel="noopener noreferrer" className={`${tilePrimary} col-span-2`}>
                  <MessageCircle className="size-4" /> {t("work.openWhatsapp")}
                </a>
              ) : null}
              {smsUrl ? <a href={smsUrl} className={tile}>{t("work.openSms")}</a> : null}
              {telUrl ? <a href={telUrl} className={tile}><Phone className="size-4" /> {t("work.call")}</a> : null}
              <button type="button" onClick={() => void copy()} className={`${tile} ${waUrl ? "col-span-2" : ""}`}><Copy className="size-4" /> {t("work.copy")}</button>
            </div>
            {!lead.phone ? <p className="mt-2 text-[12.5px] font-bold text-[var(--tone-bad)]">{t("work.noPhone")}</p> : null}

            <div className="mt-4 border-t border-border pt-4">
              <label className={label}>{t("work.channel.label")}
                <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)} className={field}>
                  {CHANNELS.map((c) => <option key={c} value={c}>{t(`work.channel.${c}`)}</option>)}
                </select>
              </label>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <AdminButton variant="primary" size="md" className={big} pending={busy === "contacted"} disabled={!lead.phone || warnings.doNotContact || props.contactsLeft === 0 || !editable} disabledReason={props.contactsLeft === 0 ? t("work.errors.daily_cap") : undefined} onClick={() => void contacted()}>
                  {t("work.markContacted")}
                </AdminButton>
                <span className="text-[12px] text-muted">{t("work.contactsLeft", { n: props.contactsLeft })}</span>
              </div>
            </div>
          </section>

          {editable && lead.status !== "confirmed" ? (
            <section className={card}>
              <h2 className="mb-2 text-[14px] font-extrabold">{t("work.resultTitle")}</h2>
              <label className={label}>{t("work.note")}
                <input value={note} onChange={(e) => setNote(e.target.value)} className={field} maxLength={300} />
              </label>
              <label className={`${label} mt-3`}>{t("work.followUp")}
                <input type="date" value={followUp} onChange={(e) => setFollowUp(e.target.value)} dir="ltr" className={field} />
              </label>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {(["no_answer", "thinking"] as const).map((k) => (
                  <AdminButton key={k} size="md" className="!h-11 !text-[13.5px]" pending={busy === k} onClick={() => void result(k)}>{t(`work.outcome.${k}`)}</AdminButton>
                ))}
                {(["refused", "wrong_number"] as const).map((k) => (
                  <AdminButton key={k} variant="danger" size="md" className="!h-11 !text-[13.5px]" pending={busy === k} onClick={() => void result(k)}>
                    {armed === k ? t("work.sureAgain") : t(`work.outcome.${k}`)}
                  </AdminButton>
                ))}
              </div>
            </section>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
            {back(1)}
            <AdminButton variant="default" size="md" className={big} onClick={() => go(3)}>{t("work.nextYes")}</AdminButton>
          </div>
        </div>

        {/* ── 3 · he said yes ── */}
        <div role="tabpanel" className={panel(3)}>
          <section className={card}>
            <h2 className="mb-1 text-[14px] font-extrabold">{t("work.yesTitle")}</h2>
            {lead.status === "confirmed" || lead.status === "online" ? (
              <>
                <p className="text-[13px] font-bold text-[var(--tone-ok)]">{t("work.doneYes")}</p>
                {lead.confirmationText ? (
                  <blockquote className="mt-3 rounded-xl bg-surface-2 px-3 py-2.5 text-[13px] text-muted">
                    <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.1em]">{t("work.proof", { by: lead.confirmedBy ?? "—" })}</div>
                    {lead.confirmationText}
                  </blockquote>
                ) : null}
              </>
            ) : (
              <>
                <p className="text-[12.5px] text-muted">{t("work.yesHint")}</p>
                <label className={`${label} mt-3`}>{t("work.reply")}
                  <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={4} className={field} maxLength={2000} />
                </label>
                <label className={`${label} mt-3`}>{t("work.channel.label")}
                  <select value={replyChannel} onChange={(e) => setReplyChannel(e.target.value as Channel | "")} className={field}>
                    {CHANNELS.map((c) => <option key={c} value={c}>{t(`work.channel.${c}`)}</option>)}
                  </select>
                </label>
                {confirmHints.length > 0 && (reply.trim() || category) ? (
                  <p className="mt-2 text-[12.5px] text-muted">{t("work.missing")} {confirmHints.map((b) => t(`work.confirmBlockers.${b}`)).join(" · ")}</p>
                ) : null}
                <div className="mt-4">
                  <AdminButton variant="primary" size="md" className={big} pending={busy === "confirm"} onClick={() => void confirm()} icon={<Check className="size-4" />}>
                    {t("work.yesButton")}
                  </AdminButton>
                </div>
              </>
            )}
          </section>
          <div className="flex">{back(2)}</div>
        </div>

        {/* ── 4 · photos, then online ── */}
        <div role="tabpanel" className={panel(4)}>
          {lead.status === "to_contact" || lead.status === "contacted" || lead.status === "declined" ? (
            <section className={card}>
              <h2 className="mb-1 text-[14px] font-extrabold">{t("work.photosTitle")}</h2>
              <p className="text-[13px] text-muted">{t("work.lockedPublish")}</p>
              {lead.status !== "declined" ? <div className="mt-3"><AdminButton variant="primary" size="md" className={big} onClick={() => go(3)}>{t("work.goYes")}</AdminButton></div> : null}
            </section>
          ) : null}

          {lead.status === "confirmed" ? (
            <section className={card}>
              <h2 className="mb-1 text-[14px] font-extrabold">{t("work.photosTitle")}</h2>
              <p className="text-[12.5px] text-muted">{t("work.photosHint", { min: minPhotos })}</p>
              {lead.confirmationText ? (
                <blockquote className="mt-3 rounded-xl bg-surface-2 px-3 py-2.5 text-[13px] text-muted">
                  <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.1em]">{t("work.proof", { by: lead.confirmedBy ?? "—" })}</div>
                  {lead.confirmationText}
                </blockquote>
              ) : null}
              {lead.listingStatus === "pending_review" ? (
                <p className="mt-3 rounded-xl bg-[var(--tone-warn-bg)] px-3 py-2.5 text-[13px] text-[var(--tone-warn)]">{t("work.waitingReview")}</p>
              ) : (
                <>
                  <div className="mt-3">
                    <PhotoUploader photos={photos} onChange={setPhotos} onPendingChange={setPending} mintUrl={`${base}/photo-url`} />
                  </div>
                  <p className={`mt-2 text-[13px] font-bold ${photos.length >= Math.max(1, minPhotos) ? "text-[var(--tone-ok)]" : "text-[var(--tone-bad)]"}`}>
                    {t("work.photosCount", { n: photos.length, min: minPhotos })}
                  </p>

                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <AdminButton icon={<Search className="size-4" />} size="md" className="!h-11 !text-[13.5px] w-full sm:w-auto" pending={busy === "check"} pendingLabel={t("work.check.running")} disabled={photos.length === 0 || pending > 0} disabledReason={pending > 0 ? t("work.uploading") : t("work.check.needPhotos")} onClick={() => void runCheck()}>
                      {t("work.check.button")}
                    </AdminButton>
                    {checkNow?.cover ? (
                      <AdminButton icon={<Star className="size-4" />} size="md" className="!h-11 !text-[13.5px] w-full sm:w-auto" onClick={applyOrder}>{t("work.check.applyOrder")}</AdminButton>
                    ) : null}
                  </div>
                  {checkNow ? (
                    <div className="mt-3">
                      <p className={`text-[13px] font-bold ${checkNow.photos.some((p) => p.flags.length > 0) ? "text-[var(--tone-warn)]" : "text-[var(--tone-ok)]"}`}>
                        {checkNow.photos.some((p) => p.flags.length > 0) ? t("work.check.summary", { n: checkNow.photos.filter((p) => p.flags.length > 0).length }) : t("work.check.clean")}
                      </p>
                      {!checkNow.ai ? <p className="mt-1 text-[12.5px] text-muted">{t("work.check.aiOff")}</p> : null}
                      <ul className="mt-2 space-y-2">
                        {checkNow.photos.map((p, i) => (
                          <li key={p.path} className="flex gap-3 rounded-xl bg-surface-2 p-2">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={annoncePhotoUrl(p.path, 384)} alt="" className="size-16 shrink-0 rounded-lg object-cover" />
                            <div className="min-w-0 text-[13px]">
                              <div className="font-bold">
                                {t("work.check.photoN", { n: i + 1 })}
                                {p.finding ? <span className="ms-1 font-normal text-muted">· {t(`work.check.kind.${p.finding.kind}`)} · {t("work.check.quality", { n: p.finding.quality })}</span> : null}
                                {checkNow.cover === p.path ? <span className="ms-1 text-[var(--tone-ok)]">· {t("work.check.bestCover")}</span> : null}
                              </div>
                              {p.flags.length === 0 ? (
                                <div className="text-[var(--tone-ok)]">{p.finding ? t("work.check.nothing") : t("work.check.notRead")}</div>
                              ) : (
                                <ul className="mt-0.5 space-y-0.5">
                                  {p.flags.map((flag) => (
                                    <li key={flag} className="flex items-start gap-1 text-[var(--tone-bad)]">
                                      <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
                                      <span className="min-w-0 break-words">
                                        {flag === "overlay" ? t("work.check.flag.overlay", { text: p.finding?.overlayText ?? "" }) : null}
                                        {flag === "duplicate" ? t("work.check.flag.duplicate") : null}
                                        {flag !== "overlay" && flag !== "duplicate" ? t(`work.check.flag.${flag}`) : null}
                                        {flag === "duplicate"
                                          ? p.duplicates.map((d) => (
                                              <a key={d.listingId} href={`/${locale}/annonces/${d.listingId}`} target="_blank" rel="noopener noreferrer" className="ms-1 font-bold underline">« {d.title} »</a>
                                            ))
                                          : null}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="mt-4 space-y-2 text-[13.5px]">
                    <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 size-4" checked={checkedNoPhone} onChange={(e) => setCheckedNoPhone(e.target.checked)} />{t("work.checkNoPhone")}</label>
                    <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 size-4" checked={checkedNoMark} onChange={(e) => setCheckedNoMark(e.target.checked)} />{t("work.checkNoMark")}</label>
                  </div>
                  {publishHints.length > 0 && photos.length > 0 ? (
                    <p className="mt-2 text-[12.5px] text-muted">{t("work.missing")} {publishHints.map((b) => t(`work.publishBlockers.${b}`, { min: minPhotos })).join(" · ")}</p>
                  ) : null}
                  <div className="mt-4">
                    <AdminButton variant="primary" size="md" className={big} pending={busy === "publish"} disabled={pending > 0} disabledReason={t("work.uploading")} onClick={() => void publish()}>
                      {t("work.publish")}
                    </AdminButton>
                  </div>
                </>
              )}
            </section>
          ) : null}

          {lead.status === "online" ? (
            <section className={card}>
              <h2 className="mb-2 text-[14px] font-extrabold">{t("work.onlineTitle")}</h2>
              {lead.listingId ? (
                <a href={`/${locale}/annonces/${lead.listingId}`} target="_blank" rel="noopener noreferrer" className={`${tile} w-full`}>
                  {t("work.openListing")} <ExternalLink className="size-3.5" />
                </a>
              ) : null}
              <p className="mt-3 text-[13px] text-muted">
                {lead.smsSentAt ? t("work.smsSentAt", { at: formatDate(lead.smsSentAt, locale, "dateTime") }) : lead.smsError ? t("work.smsFailed", { error: lead.smsError }) : t("work.smsNotYet")}
              </p>
              <div className="mt-2">
                <AdminButton size="md" className={big} pending={busy === "sms"} onClick={() => void resendSms()}>{lead.smsSentAt ? t("work.smsAgain") : t("work.smsSend")}</AdminButton>
              </div>
            </section>
          ) : null}

          <div className="flex">{back(3)}</div>
        </div>
      </div>

      {/* ── what was done on this lead ── */}
      <details className={`${card} mt-5`}>
        <summary className="cursor-pointer text-[14px] font-extrabold">{t("work.historyCount", { n: events.length })}</summary>
        <div className="mt-3 flex gap-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("work.addNote")} className={`${field} mt-0`} maxLength={300} />
          <AdminButton size="md" className="!h-11" pending={busy === "note"} disabled={!note.trim()} onClick={() => void addNote()}>{t("work.add")}</AdminButton>
        </div>
        <ul className="mt-3 divide-y divide-border text-[13px]">
          {events.map((e) => (
            <li key={e.id} className="py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold">
                  {t(`work.event.${e.kind}`)}
                  {e.channel ? <span className="ms-1 font-normal text-muted">· {t(`work.channel.${e.channel}`)}</span> : null}
                </span>
                <span className="mazed-tabular text-[11px] text-muted">{formatDate(e.at, locale, "dateTime")}{e.by ? ` · ${e.by}` : ""}</span>
              </div>
              {e.note ? <div className="mt-0.5 break-words text-muted"><Ltr>{e.note}</Ltr></div> : null}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
