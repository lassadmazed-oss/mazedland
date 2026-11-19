"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { AdminButton } from "@/components/admin/AdminButton";

/**
 * The owner's « share the unassigned agencies among the team »: pick the
 * members, and the agencies nobody holds are cut into equal parts by
 * governorate (src/lib/prospection/agencies/model.ts shareOut).
 */
export function ShareForm({ unassigned, members }: { unassigned: number; members: { id: string; name: string }[] }) {
  const t = useTranslations("adminProspection");
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>(members.map((m) => m.id));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  if (unassigned === 0) return null;

  async function share() {
    if (busy || picked.length === 0) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/prospection/agences/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_ids: picked }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; counts?: Record<string, number>; total?: number };
      if (!res.ok || !json.ok) {
        setNotice({ tone: "bad", text: t("agencies.errors.failed") });
        return;
      }
      setNotice({ tone: "ok", text: t("agencies.shared", { n: json.total ?? 0, detail: Object.entries(json.counts ?? {}).map(([name, n]) => `${name} ${n}`).join(" · ") }) });
      router.refresh();
    } catch {
      setNotice({ tone: "bad", text: t("agencies.errors.failed") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="mt-3 rounded-2xl bg-surface px-4 py-3 ring-1 ring-border">
      <summary className="cursor-pointer text-[13px] font-bold">{t("agencies.shareTitle", { n: unassigned })}</summary>
      <p className="mt-2 text-[12.5px] text-muted">{t("agencies.shareHint")}</p>
      {members.length === 0 ? (
        <p className="mt-2 text-[12.5px] font-bold text-[var(--tone-warn)]">{t("agencies.noMembers")}</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
          {members.map((m) => (
            <label key={m.id} className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                className="size-4"
                checked={picked.includes(m.id)}
                onChange={(e) => setPicked((p) => (e.target.checked ? [...p, m.id] : p.filter((x) => x !== m.id)))}
              />
              {m.name}
            </label>
          ))}
        </div>
      )}
      <div className="mt-3">
        <AdminButton variant="primary" size="md" pending={busy} disabled={picked.length === 0} onClick={() => void share()}>
          {t("agencies.shareButton")}
        </AdminButton>
      </div>
      {notice ? (
        <p role="status" className={`mt-3 rounded-xl px-3 py-2.5 text-[13px] font-bold ${notice.tone === "ok" ? "bg-[var(--tone-ok-bg)] text-[var(--tone-ok)]" : "bg-[var(--tone-bad-bg)] text-[var(--tone-bad)]"}`}>{notice.text}</p>
      ) : null}
    </details>
  );
}
