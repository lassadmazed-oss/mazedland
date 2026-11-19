"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { AdminButton } from "@/components/admin/AdminButton";
import { TUNISIAN_GOVERNORATES, governorateLabel } from "@/lib/tunisia";

const card = "rounded-2xl bg-surface p-4 ring-1 ring-border";
const field = "mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-[15px] outline-none focus:border-[var(--gold)]";
const label = "block text-[12.5px] font-bold text-muted";

/** One agency added by hand: a page found on Facebook, a card, a number heard. A member holds what they add. */
export function NewAgencyForm({ canAssign, members }: { canAssign: boolean; members: { id: string; name: string }[] }) {
  const t = useTranslations("adminProspection");
  const locale = useLocale();
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [governorate, setGovernorate] = useState("");
  const [city, setCity] = useState("");
  const [address, setAddress] = useState("");
  const [website, setWebsite] = useState("");
  const [facebook, setFacebook] = useState("");
  const [assignTo, setAssignTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; id?: string } | null>(null);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/prospection/agences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, governorate: governorate || null, city, address, website, facebook_url: facebook, assign_to: assignTo || null }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; id?: string; error?: string };
      if (res.ok && json.ok && json.id) {
        router.push(`/admin/prospection/agences/${json.id}` as "/admin/prospection");
        return;
      }
      const code = json.error ?? "failed";
      setError({ text: t.has(`agencies.errors.${code}`) ? t(`agencies.errors.${code}`) : t("agencies.errors.failed"), id: code === "duplicate" ? json.id : undefined });
    } catch {
      setError({ text: t("agencies.errors.failed") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-5 max-w-2xl pb-10">
      <section className={card}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className={`${label} sm:col-span-2`}>{t("agencies.work.name")}<input value={name} onChange={(e) => setName(e.target.value)} className={field} maxLength={160} /></label>
          <label className={label}>{t("agencies.col.phone")}<input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" inputMode="tel" className={field} /></label>
          <label className={label}>{t("agencies.filter.governorate")}
            <select value={governorate} onChange={(e) => setGovernorate(e.target.value)} className={field}>
              <option value="">—</option>
              {TUNISIAN_GOVERNORATES.map((g) => <option key={g} value={g}>{governorateLabel(g, locale)}</option>)}
            </select>
          </label>
          <label className={label}>{t("agencies.work.city")}<input value={city} onChange={(e) => setCity(e.target.value)} className={field} maxLength={120} /></label>
          <label className={label}>{t("agencies.work.address")}<input value={address} onChange={(e) => setAddress(e.target.value)} className={field} maxLength={300} /></label>
          <label className={label}>{t("agencies.work.website")}<input value={website} onChange={(e) => setWebsite(e.target.value)} dir="ltr" className={field} /></label>
          <label className={label}>{t("agencies.work.facebook")}<input value={facebook} onChange={(e) => setFacebook(e.target.value)} dir="ltr" className={field} /></label>
          {canAssign ? (
            <label className={`${label} sm:col-span-2`}>{t("agencies.work.assignTitle")}
              <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} className={field}>
                <option value="">{t("agencies.import.shareLater")}</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
          ) : null}
        </div>
        <p className="mt-3 text-[12px] text-muted">{t("agencies.new.hint")}</p>
        <div className="mt-4"><AdminButton variant="primary" size="md" className="!h-11 !px-5" pending={busy} disabled={!name.trim()} onClick={() => void submit()}>{t("agencies.new.save")}</AdminButton></div>
        {error ? (
          <p role="alert" className="mt-3 rounded-xl bg-[var(--tone-bad-bg)] px-3 py-2.5 text-[13px] font-bold text-[var(--tone-bad)]">
            {error.text}
            {error.id ? <> <a href={`/${locale}/admin/prospection/agences/${error.id}`} className="underline">{t("agencies.new.open")}</a></> : null}
          </p>
        ) : null}
      </section>
    </div>
  );
}
