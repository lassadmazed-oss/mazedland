import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getServerSupabase } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { ShopForm, type ShopFormValues } from "@/components/pro/ShopForm";
import { AgenceRequest, type RequestPlan } from "@/components/pro/AgenceRequest";
import { getSettings } from "@/lib/settings/server";
import { phoneForField, readableEmail } from "@/lib/pro/shopForm";
import { fetchPayeeDetails, paymentsOpen, usablePayeeMethods } from "@/lib/payments";
import type { PaymentProvider } from "@/lib/payments/types";

export const dynamic = "force-dynamic";

/** The tab's title: the page carried the site's home title. */
export async function generateMetadata() {
  const t = await getTranslations("pro.create");
  return { title: t("title") };
}

/**
 * Open a shop (0173): the form, with what the account already knows in it —
 * the owner's phone, e-mail and governorate — and their name one tap away.
 * One shop per owner.
 *
 * Since 2026-10-31 the plan is part of it (the owner: « في نفس الفناتر يختار
 * … ويبعث مرة واحدة »): the agence, its plan and the plan's receipt, sent as
 * one request (AgenceRequest). The agence alone, as before, while that is
 * switched off (feature_pro_signup_plan) or nobody can be paid yet.
 */
export default async function CreateShopPage() {
  const locale = await getLocale();
  // New shops switched off in the console: back to the Pro page, which then
  // offers no way in. A shop that exists keeps its dashboard.
  const settings = await getSettings();
  if (!settings.feature_pro_signup) redirect(`/${locale}/pro`);
  const t = await getTranslations("pro.create");
  const supabase = await getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/pro/creer`)}`);

  const admin = getServiceSupabase();
  const db = admin ?? supabase;
  const withPlan = settings.feature_pro_signup_plan && paymentsOpen(settings);
  const [{ data: owned }, { data: profile }, { data: planRows }, payee] = await Promise.all([
    db.from("shops").select("id").eq("owner_id", user!.id).limit(1),
    db.from("profiles").select("full_name, phone, governorate").eq("id", user!.id).maybeSingle(),
    withPlan
      ? db.from("products").select("slug, name_fr, name_ar, description, description_ar, price, listing_quota").eq("kind", "subscription").eq("is_active", true).order("price")
      : Promise.resolve({ data: null }),
    withPlan ? fetchPayeeDetails(db) : Promise.resolve(null),
  ]);
  if (owned && owned.length > 0) redirect(`/${locale}/pro/dashboard?shop=${owned[0].id}`);
  // A phone account's e-mail is a synthetic one on the signup domain — the
  // same default as /api/auth/signup — that nobody reads: not offered.
  const email = readableEmail(user!.email, process.env.SIGNUP_EMAIL_DOMAIN || "phone.mazedland.app");
  const suggestedName = ((profile?.full_name as string | null) ?? "").trim() || undefined;
  const initial: ShopFormValues = {
    name: "",
    kind: "agency",
    description: "",
    governorate: (profile?.governorate as string | null) ?? "",
    city: "",
    phone: phoneForField(profile?.phone as string | null),
    email,
    website: "",
    hours: "",
    legal_name: "",
    legal_id: "",
    logo_path: null,
    cover_path: null,
  };

  const plans: RequestPlan[] = ((planRows ?? []) as {
    slug: string; name_fr: string; name_ar: string | null; description: string | null; description_ar: string | null; price: number | string; listing_quota: number;
  }[]).map((p) => ({
    slug: p.slug,
    name: locale === "ar" && p.name_ar ? p.name_ar : p.name_fr,
    price: Number(p.price),
    quota: p.listing_quota,
    description: (locale === "ar" && p.description_ar ? p.description_ar : p.description) ?? null,
  }));
  // Only a method whose details are real (usablePayeeMethods), as the checkout.
  const usable = payee ? usablePayeeMethods(payee) : { bank_transfer: false, d17: false };
  const methods = (["bank_transfer", "d17"] as PaymentProvider[]).filter((m) => usable[m]);
  const request = withPlan && plans.length > 0 && methods.length > 0 && payee;

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 lg:py-10">
      <h1 className="text-[24px] font-extrabold tracking-tight">{t("title")}</h1>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">{t(request ? "subtitleWithPlan" : "subtitle")}</p>
      <div className="mt-6">
        {request ? (
          <AgenceRequest
            userId={user!.id}
            initial={initial}
            suggestedName={suggestedName}
            plans={plans}
            payee={payee}
            methods={methods}
            paymentId={randomUUID()}
            payLater={settings.pro_signup_pay_later}
          />
        ) : (
          <ShopForm mode="create" suggestedName={suggestedName} initial={initial} />
        )}
      </div>
    </main>
  );
}
