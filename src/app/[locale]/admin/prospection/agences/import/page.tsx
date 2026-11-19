import { requireAdmin } from "@/lib/admin/session";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ArrowLeft } from "lucide-react";
import { teamNames } from "@/lib/prospection/report";
import { ImportForm } from "./ImportForm";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("adminProspection");
  return { title: t("agencies.import.pageTitle") };
}

export default async function ImportAgenciesPage() {
  const { scopes } = await requireAdmin("prospection");
  // The list is the owner's: a member works the agencies they are given.
  if (scopes !== null) notFound();
  const t = await getTranslations("adminProspection");
  const admin = getServiceSupabase();
  if (!admin) return null;
  const team = await teamNames(admin);

  return (
    <div>
      <Link href={"/admin/prospection/agences" as "/admin/prospection"} className="mb-3 inline-flex items-center gap-1 text-[12px] font-bold text-muted hover:text-foreground">
        <ArrowLeft className="size-3.5 rtl:rotate-180" /> {t("agencies.work.back")}
      </Link>
      <AdminPageHeader eyebrow={t("agencies.title")} title={t("agencies.import.title")} description={t("agencies.import.description")} />
      <ImportForm members={[...team.entries()].map(([id, name]) => ({ id, name }))} />
    </div>
  );
}
