import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
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

export default async function ForgotPasswordPage() {
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
