import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { AuthScreen } from "@/components/auth/AuthScreen";

/**
 * Landing page for the password-recovery magic link sent by Supabase. The URL
 * fragment carries a recovery token; Supabase JS creates a short-lived
 * recovery session so the user can call `auth.updateUser({ password })`.
 * The frame is AuthScreen's, like the rest of the auth flow. No "back to
 * login" footer — the form's success state redirects to /login.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth.reset" });
  // Not a page to list in search results: a sign-in box, not content.
  return { title: t("metaTitle"), robots: { index: false } };
}

export default async function ResetPasswordPage() {
  const t = await getTranslations();

  return (
    <AuthScreen labelledBy="reset-title" title={t("auth.reset.title")} intro={t("auth.reset.intro")}>
      <ResetPasswordForm />
    </AuthScreen>
  );
}
