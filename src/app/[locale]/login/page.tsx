import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LoginForm } from "@/components/auth/LoginForm";
import { AuthScreen } from "@/components/auth/AuthScreen";
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

export default async function LoginPage({
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
          <Link
            href={{ pathname: "/signup", query: next ? { next } : {} }}
            className="font-bold text-foreground underline underline-offset-4 transition hover:text-muted"
          >
            {t("nav.signup")}
          </Link>
        </>
      }
    >
      <LoginForm />
    </AuthScreen>
  );
}
