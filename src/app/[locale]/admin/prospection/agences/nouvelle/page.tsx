import { requireAdmin } from "@/lib/admin/session";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ArrowLeft } from "lucide-react";
import { teamNames } from "@/lib/prospection/report";
import { NewAgencyForm } from "./NewAgencyForm";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("adminProspection");
  return { title: t("agencies.new.pageTitle") };
}

export default async function NewAgencyPage() {
  const { scopes } = await requireAdmin("prospection");
  const t = await getTranslations("adminProspection");
  const everyone = scopes === null;
  const admin = getServiceSupabase();
  const team = everyone && admin ? await teamNames(admin) : new Map<string, string>();

  return (
    <div>
      <Link href={"/admin/prospection/agences" as "/admin/prospection"} className="mb-3 inline-flex items-center gap-1 text-[12px] font-bold text-muted hover:text-foreground">
        <ArrowLeft className="size-3.5 rtl:rotate-180" /> {t("agencies.work.back")}
      </Link>
      <AdminPageHeader eyebrow={t("agencies.title")} title={t("agencies.new.title")} description={t("agencies.new.description")} />
      <NewAgencyForm canAssign={everyone} members={[...team.entries()].map(([id, name]) => ({ id, name }))} />
    </div>
  );
}
