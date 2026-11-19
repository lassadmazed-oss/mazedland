import { requireAdmin } from "@/lib/admin/session";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { adminBtn } from "@/components/admin/AdminButton";
import { Ltr } from "@/components/ui/Ltr";
import { ChevronLeft, Download } from "lucide-react";
import manifest from "../../../../../../extension/prospection/manifest.json";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("adminProspection");
  return { title: t("extension.title") };
}

/**
 * « Le bouton Chrome »: how the team installs the extension that carries a
 * Facebook post to « Nouvelle annonce trouvée » (extension/prospection). It is
 * installed from a folder for now — Chrome's « mode développeur » — until it
 * is published in the Chrome Web Store.
 */
export default async function ExtensionPage() {
  await requireAdmin("prospection");
  const t = await getTranslations("adminProspection");
  const steps = ["download", "unzip", "developer", "load", "pin", "use"] as const;
  return (
    <div>
      <Link href="/admin/prospection" className="mb-3 inline-flex items-center gap-1 text-[12px] font-bold text-muted hover:text-foreground">
        <ChevronLeft className="size-3.5 rtl:rotate-180" /> {t("work.back")}
      </Link>
      <AdminPageHeader eyebrow={t("eyebrow")} title={t("extension.title")} description={t("extension.description")} />

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <a href="/downloads/mazed-prospection-extension.zip" download className={adminBtn("primary", "md")}>
          <Download className="size-3.5" /> {t("extension.download")}
        </a>
        <span className="text-[12px] text-muted">{t("extension.version", { v: manifest.version })}</span>
      </div>

      <ol className="mt-6 grid max-w-3xl grid-cols-1 gap-3">
        {steps.map((s, i) => (
          <li key={s} className="flex gap-3 rounded-2xl bg-surface p-4 ring-1 ring-border">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--gold)] text-[12px] font-extrabold text-[var(--background)]">{i + 1}</span>
            <div className="min-w-0">
              <div className="text-[13.5px] font-extrabold">{t(`extension.steps.${s}.title`)}</div>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{t(`extension.steps.${s}.body`)}</p>
              {s === "developer" ? <Ltr className="mt-1 inline-block rounded bg-surface-2 px-2 py-0.5 text-[12px] font-bold">chrome://extensions</Ltr> : null}
            </div>
          </li>
        ))}
      </ol>

      <section className="mt-6 max-w-3xl rounded-2xl bg-surface p-4 ring-1 ring-border">
        <h2 className="text-[13px] font-extrabold">{t("extension.privacyTitle")}</h2>
        <ul className="mt-2 list-disc space-y-1 ps-5 text-[12.5px] leading-relaxed text-muted">
          {(["reads", "sends", "account", "review"] as const).map((k) => (
            <li key={k}>{t(`extension.privacy.${k}`)}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
