import { RouteTexts } from "@/components/i18n/RouteTexts";

/**
 * Adds the browser texts only Espace Pro (the dashboard, « Créer mon agence ») reads
 * (src/lib/i18n/publicMessages.ts, ROUTE_TEXTS.pro): the root layout no
 * longer sends them to every page (2026-11-25, the speed plan).
 */
export default async function ProLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <RouteTexts route="pro" locale={locale}>
      {children}
    </RouteTexts>
  );
}
