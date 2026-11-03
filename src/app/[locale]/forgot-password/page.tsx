import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { Link } from "@/i18n/navigation";

/**
 * "Forgot password" page — the phone-OTP recovery (ForgotPasswordForm) in the
 * same frame as login and signup (AuthScreen), so the whole auth quartet is
 * one screen drawn four times.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth.forgot" });
  // Not a page to list in search results: a sign-in box, not content.
  return { title: t("metaTitle"), robots: { index: false } };
}

// The same page for everyone (a signed-in visitor never reaches it: the proxy
// sends them home), so it comes from the CDN.
export const revalidate = 60;
// A build that fails, naming the API, the day something here reads the
// request (src/app/[locale]/(home)/page.tsx).
export const dynamic = "error";

export default async function ForgotPasswordPage({ params }: { params: Promise<{ locale: string }> }) {
  // Before any translation: next-intl would otherwise read the request headers.
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  return (
    <AuthScreen
      labelledBy="forgot-title"
      title={t("auth.forgot.title")}
      intro={t("auth.forgot.intro")}
      footer={
        <>
          {t("auth.forgot.remember")}{" "}
          <Link href="/login" className="font-bold text-foreground underline underline-offset-4 transition hover:text-muted">
            {t("auth.forgot.signIn")}
          </Link>
        </>
      }
    >
      <ForgotPasswordForm />
    </AuthScreen>
  );
}
