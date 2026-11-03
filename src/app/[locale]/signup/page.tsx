import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SignupForm } from "@/components/auth/SignupForm";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { AuthSwitchLink } from "@/components/auth/AuthSwitchLink";

/**
 * Signup surface — the same frame as the login (AuthScreen), with the
 * create-account form in the card.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth.signup" });
  // Not a page to list in search results: a sign-in box, not content.
  return { title: t("metaTitle"), robots: { index: false } };
}

// The same page for every visitor (a signed-in one never reaches it: the
// proxy sends them home), so it comes from the CDN. `?next=` is read in the
// browser, by the form and by the link to the login.
export const revalidate = 60;
// A build that fails, naming the API, the day something here reads the
// request (src/app/[locale]/(home)/page.tsx).
export const dynamic = "error";

export default async function SignupPage({
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
      labelledBy="signup-title"
      title={t("nav.signup")}
      footer={
        <>
          {t("auth.signup.alreadyMember")}{" "}
          <AuthSwitchLink
            to="/login"
            className="font-bold text-foreground underline underline-offset-4 transition hover:text-muted"
          >
            {t("nav.login")}
          </AuthSwitchLink>
        </>
      }
    >
      <SignupForm />
    </AuthScreen>
  );
}
