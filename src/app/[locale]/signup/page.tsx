import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SignupForm } from "@/components/auth/SignupForm";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { Link } from "@/i18n/navigation";

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

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  // `next` rides along to the other form: someone sent here from « Vendre »
  // who signs up instead of signing in should still land on the publish page.
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : undefined;
  const t = await getTranslations();

  return (
    <AuthScreen
      labelledBy="signup-title"
      title={t("nav.signup")}
      footer={
        <>
          {t("auth.signup.alreadyMember")}{" "}
          <Link
            href={{ pathname: "/login", query: next ? { next } : {} }}
            className="font-bold text-foreground underline underline-offset-4 transition hover:text-muted"
          >
            {t("nav.login")}
          </Link>
        </>
      }
    >
      <SignupForm />
    </AuthScreen>
  );
}
