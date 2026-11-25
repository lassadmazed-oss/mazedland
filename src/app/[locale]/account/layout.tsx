import { RouteTexts } from "@/components/i18n/RouteTexts";

/**
 * Adds the browser texts only « Mon compte » (annonces, paiements, demandes, mise en avant) reads
 * (src/lib/i18n/publicMessages.ts, ROUTE_TEXTS.account): the root layout no
 * longer sends them to every page (2026-11-25, the speed plan).
 */
export default async function AccountLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <RouteTexts route="account" locale={locale}>
      {children}
    </RouteTexts>
  );
}
