import { RouteTexts } from "@/components/i18n/RouteTexts";

/**
 * Adds the browser texts only the checkout reads
 * (src/lib/i18n/publicMessages.ts, ROUTE_TEXTS.payment): the root layout no
 * longer sends them to every page (2026-11-25, the speed plan).
 */
export default async function PaymentLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return (
    <RouteTexts route="payment" locale={locale}>
      {children}
    </RouteTexts>
  );
}
