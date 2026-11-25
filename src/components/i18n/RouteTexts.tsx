import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { clientMessages, type RouteTextsKey } from "@/lib/i18n/publicMessages";

/**
 * The browser texts of one part of the site (src/lib/i18n/publicMessages.ts):
 * what every page carries, plus this route's own namespaces — the « Espace
 * Pro », the publishing wizard, « Mon compte »… The root layout no longer
 * sends them to every visitor (2026-11-25, the speed plan).
 */
export async function RouteTexts({
  route,
  locale,
  children,
}: {
  route: RouteTextsKey;
  locale: string;
  children: React.ReactNode;
}) {
  // Keeps the route static where it is (/pro is built ahead): the locale comes from the segment.
  setRequestLocale(locale);
  const messages = clientMessages(await getMessages(), route);
  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
