"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

/** « Vendue » and « Retirer »: the two things an owner does from their private link. */
export function ManageActions({
  token,
  status: initial,
  rent,
  locale,
  listingId,
}: {
  token: string;
  status: string;
  rent: boolean;
  locale: string;
  listingId: string;
}) {
  const t = useTranslations("manage");
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "mark_sold" | "withdraw") {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/gerer/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const j = (await res.json().catch(() => ({}))) as { status?: string };
      if (!res.ok || !j.status) {
        setError(t("failed"));
        return;
      }
      setStatus(j.status);
      setArmed(false);
      // The sentence above the buttons says where the annonce stands: read it again.
      router.refresh();
    } catch {
      setError(t("failed"));
    } finally {
      setBusy(false);
    }
  }

  const live = status === "published";
  const btn = "inline-flex h-11 w-full items-center justify-center rounded-full px-5 text-[14px] font-bold transition disabled:opacity-50";
  return (
    <div className="mt-5 space-y-3">
      {live ? (
        <>
          <a href={`/${locale}/annonces/${listingId}`} className={`${btn} border border-border`}>{t("seeListing")}</a>
          <button type="button" disabled={busy} onClick={() => void act("mark_sold")} className={`${btn} bg-foreground text-[var(--background)]`}>
            {rent ? t("markRented") : t("markSold")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => (armed ? void act("withdraw") : setArmed(true))}
            className={`${btn} border border-[var(--tone-bad-ring)] text-[var(--tone-bad)]`}
          >
            {armed ? t("withdrawSure") : t("withdraw")}
          </button>
        </>
      ) : null}
      {status === "sold" || status === "rented" || status === "archived" ? <p className="text-[13px] font-bold">{t("done")}</p> : null}
      {error ? <p role="alert" className="text-[13px] font-bold text-[var(--tone-bad)]">{error}</p> : null}
    </div>
  );
}
