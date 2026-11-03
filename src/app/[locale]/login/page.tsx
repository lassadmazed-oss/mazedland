import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LoginForm } from "@/components/auth/LoginForm";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { AuthSwitchLink } from "@/components/auth/AuthSwitchLink";
import { Link } from "@/i18n/navigation";

/**
 * Login surface — AuthScreen draws the frame (the brand photo, the floating
 * card on phones, the split screen from lg); this page is the words and the
 * form.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth.login" });
  // Not a page to list in search results: a sign-in box, not content.
  return { title: t("metaTitle"), robots: { index: false } };
}

// The same page for every visitor (a signed-in one never reaches it: the
// proxy sends them home), so it comes from the CDN. `?next=` is read in the
// browser, by the form and by the link to the signup.
export const revalidate = 60;
// A build that fails, naming the API, the day something here reads the
// request (src/app/[locale]/(home)/page.tsx).
export const dynamic = "error";

export default async function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  // Before any translation: next-intl would otherwise read the request headers.
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  return (
    <AuthScreen
      labelledBy="login-title"
      title={t("nav.login")}
      desktopTitle={t.rich("auth.login.welcome", { brand: (chunks) => <span>{chunks}</span> })}
      below={
        <p className="mt-4 text-center text-[13px]">
          <Link href="/forgot-password" className="font-semibold text-muted transition hover:text-foreground">
            {t("auth.login.forgotPassword")}
          </Link>
        </p>
      }
      footer={
        <>
          {t("auth.login.noAccount")}{" "}
          <AuthSwitchLink
            to="/signup"
            className="font-bold text-foreground underline underline-offset-4 transition hover:text-muted"
          >
            {t("nav.signup")}
          </AuthSwitchLink>
        </>
      }
    >
      <LoginForm />
    </AuthScreen>
  );
}
