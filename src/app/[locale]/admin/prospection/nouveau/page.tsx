import { requireAdmin } from "@/lib/admin/session";
import { getTranslations } from "next-intl/server";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { NewLeadForm } from "../NewLeadForm";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("adminProspection");
  return { title: t("new.title") };
}

export default async function NewLeadPage() {
  await requireAdmin("prospection");
  const t = await getTranslations("adminProspection");
  return (
    <div>
      <AdminPageHeader eyebrow={t("eyebrow")} title={t("new.title")} description={t("new.description")} />
      <NewLeadForm />
    </div>
  );
}
