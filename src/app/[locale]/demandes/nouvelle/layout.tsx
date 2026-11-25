import { RouteTexts } from "@/components/i18n/RouteTexts";

/**
 * Adds the browser texts only the demande form reads
 * (src/lib/i18n/publicMessages.ts, ROUTE_TEXTS.demande): the root layout no
 * longer sends them to every page (2026-11-25, the speed plan).
 */
export default async function DemandeLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <RouteTexts route="demande" locale={locale}>
      {children}
    </RouteTexts>
  );
}
