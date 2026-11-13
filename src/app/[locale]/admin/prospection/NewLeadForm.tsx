"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { AdminButton } from "@/components/admin/AdminButton";

/**
 * One post pasted: the text of a Facebook post, its link, the poster's name.
 * The number is read from the text; the assistant reads the rest into a
 * draft; the member lands on the lead to write to the owner.
 */
export function NewLeadForm() {
  const t = useTranslations("adminProspection");
  const router = useRouter();
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (text.trim().length < 20) {
      setError(t("new.errors.too_short"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/prospection/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, url, name, phone }),
      });
      const j = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !j.id) {
        setError(t.has(`new.errors.${j.error}`) ? t(`new.errors.${j.error}`) : t("new.errors.failed"));
        return;
      }
      router.push(`/admin/prospection/${j.id}`);
    } catch {
      setError(t("new.errors.failed"));
    } finally {
      setBusy(false);
    }
  }

  const field = "mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-[13px] outline-none focus:border-[var(--gold)]";
  return (
    <form onSubmit={submit} className="mt-6 max-w-3xl space-y-4">
      <label className="block text-[12px] font-bold text-muted">
        {t("new.text")}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          placeholder={t("new.textPlaceholder")}
          className={field}
          maxLength={8000}
        />
        <span className="mt-1 block text-[11px] font-normal">{t("new.textHint")}</span>
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block text-[12px] font-bold text-muted">
          {t("new.url")}
          <input value={url} onChange={(e) => setUrl(e.target.value)} dir="ltr" inputMode="url" placeholder="https://facebook.com/…" className={field} />
        </label>
        <label className="block text-[12px] font-bold text-muted">
          {t("new.name")}
          <input value={name} onChange={(e) => setName(e.target.value)} className={field} maxLength={120} />
        </label>
        <label className="block text-[12px] font-bold text-muted">
          {t("new.phone")}
          <input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" inputMode="tel" placeholder="+216 …" className={field} />
        </label>
      </div>
      <p className="text-[11px] text-muted">{t("new.phoneHint")}</p>

      {error ? <p role="alert" className="text-[12.5px] font-bold text-[var(--tone-bad)]">{error}</p> : null}

      <AdminButton type="submit" variant="primary" size="md" pending={busy} pendingLabel={t("new.reading")}>
        {t("new.submit")}
      </AdminButton>
    </form>
  );
}
