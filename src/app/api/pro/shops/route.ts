import { NextRequest, NextResponse } from "next/server";
import { jsonObject } from "@/lib/http/body";
import { randomBytes } from "node:crypto";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator } from "@/lib/i18n/server";
import { proGate } from "@/lib/pro/api";
import { parseShopInput, slugify } from "@/lib/pro/shops";
import { parseRequestPayment, planOptional } from "@/lib/pro/agenceRequest";
import { addMonths, monthsOf } from "@/lib/pro/planChange";
import { paymentsOpen, usablePayeeMethods } from "@/lib/payments";
import { missingObjects } from "@/lib/listings/storage";
import { featureOff } from "@/lib/settings/gate";
import { getSettings } from "@/lib/settings/server";

/**
 * POST /api/pro/shops — open a shop (0173). One shop per owner. It waits for
 * an admin (status pending) before it shows on the site; its owner can set
 * it up meanwhile.
 *
 * With its plan (the owner, 2026-10-31): the form asks for the agence, the
 * plan and the plan's receipt, and sends them here at once —
 * `{ …agence, plan, provider, receipt_paths, payment_id }`. The agence, its
 * owner's membership and the plan's payment (already « reçu à valider ») are
 * written together, or none of them is, and the admins hear one thing: « X
 * demande l'agence … avec l'abonnement … ». The console then accepts and opens
 * it in one decision, or refuses it (/api/admin/boutiques/:id).
 *
 * Without a plan when the form does not ask for one (feature_pro_signup_plan
 * off, or no payee to pay) or when « Envoyer sans payer » is allowed
 * (pro_signup_pay_later, the founding offer): the agence alone, as before.
 */
export async function POST(req: NextRequest) {
  const off = await featureOff("feature_pro_signup");
  if (off) return off;
  const gate = await proGate(req);
  if (gate instanceof NextResponse) return gate;
  const { user, admin } = gate;
  const t = await apiTranslator(req, "proApi");

  const settings = await getSettings();
  const { limit_shop_create_per_hour: perHour } = settings;
  const { data: over } = await admin.rpc("check_rate_limit", { p_key: `shop-create:${user.id}`, p_max: perHour, p_window_secs: 3600 });
  if (over === true) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const { data: owned } = await admin.from("shops").select("id").eq("owner_id", user.id).limit(1);
  if (owned && owned.length > 0) return NextResponse.json({ error: "conflict", detail: t("oneShop") }, { status: 409 });

  const body = await jsonObject(req);
  const parsed = parseShopInput(body, user.id);
  if (!parsed.ok) return NextResponse.json({ error: "invalid", detail: t(`errors.${parsed.error}`) }, { status: 400 });

  // The plan and its receipt, checked before anything is written: a request
  // refused here leaves no agence behind.
  const open = paymentsOpen(settings);
  const withPlan = settings.feature_pro_signup_plan && open;
  const asked = withPlan ? parseRequestPayment(body, user.id) : ({ none: true } as const);
  if ("ok" in asked && !asked.ok) {
    return NextResponse.json({ error: "invalid", detail: t(`errors.request.${asked.error}`) }, { status: 400 });
  }
  if ("none" in asked && !planOptional({ withPlan: settings.feature_pro_signup_plan, paymentsOpen: open, payLater: settings.pro_signup_pay_later })) {
    return NextResponse.json({ error: "invalid", detail: t("errors.request.plan") }, { status: 400 });
  }
  const request = "ok" in asked ? asked.value : null;
  let plan: { id: string; slug: string; price: number | string; duration_days: number | null; listing_quota: number; name_fr: string } | null = null;
  if (request) {
    const { data: product } = await admin
      .from("products")
      .select("id, slug, price, duration_days, listing_quota, name_fr")
      .eq("slug", request.plan)
      .eq("kind", "subscription")
      .eq("is_active", true)
      .maybeSingle();
    if (!product) return NextResponse.json({ error: "invalid", detail: t("errors.plan") }, { status: 400 });
    plan = product;
    // A method whose details are the seed's example account is not offered;
    // a receipt sent « by » it is a forged request.
    const usable = usablePayeeMethods({
      name: settings.payee_name, bank: settings.payee_bank, rib: settings.payee_rib, iban: settings.payee_iban, d17: settings.payee_d17,
    });
    if (!usable[request.provider]) return NextResponse.json({ error: "invalid", detail: t("errors.request.provider") }, { status: 400 });
    // The files must be there: the console would have nothing to look at.
    if ((await missingObjects(admin, "receipts", request.receiptPaths)).length > 0) {
      return NextResponse.json({ error: "receipt_missing" }, { status: 400 });
    }
  }

  // A free address: the name's, or the name's with a short suffix.
  let slug = slugify(parsed.value.name, randomBytes(4).toString("hex"));
  const { data: taken } = await admin.from("shops").select("id").eq("slug", slug).maybeSingle();
  if (taken) slug = `${slug.slice(0, 50)}-${randomBytes(2).toString("hex")}`;

  const create = (withSlug: string) =>
    admin
      .from("shops")
      .insert({ ...parsed.value, slug: withSlug, owner_id: user.id, status: "pending" })
      .select("id, slug, name")
      .single();
  let { data: shop, error } = await create(slug);
  // The address went to a request a moment earlier: once more, with a suffix.
  if (error?.code === "23505" && !error.message.includes("shops_one_live_per_owner")) {
    slug = `${slug.slice(0, 50)}-${randomBytes(2).toString("hex")}`;
    ({ data: shop, error } = await create(slug));
  }
  // Two requests at the same moment both passed the check above (the QA
  // tour, 2026-10-30: three agences for one owner); the table allows one
  // (shops_one_live_per_owner, 0191) and the second is the same 409.
  if (error?.code === "23505" && error.message.includes("shops_one_live_per_owner")) {
    return NextResponse.json({ error: "conflict", detail: t("oneShop") }, { status: 409 });
  }
  if (error || !shop) return fail("shop_create_failed", 500, error);

  const { error: mErr } = await admin.from("shop_members").insert({ shop_id: shop.id, user_id: user.id, role: "owner", invited_by: user.id });
  if (mErr) {
    await admin.from("shops").delete().eq("id", shop.id);
    return fail("shop_create_failed", 500, mErr);
  }

  // The plan's payment, its receipt already in: the console's queue sees it
  // « à valider » at once, as if the checkout had sent it. The amount is the
  // plan's price — a new agence has no period for planChange to take off.
  let paymentId: string | null = null;
  if (request && plan) {
    const now = new Date();
    const price = Number(plan.price);
    const row = (id: string | null) => ({
      ...(id ? { id } : {}),
      user_id: user.id,
      kind: "subscription",
      provider: request.provider,
      amount: price,
      status: "pending_review",
      receipt_urls: request.receiptPaths,
      receipt_url: request.receiptPaths[0],
      receipt_uploaded_at: now.toISOString(),
      metadata: {
        shop_id: shop!.id,
        product_id: plan!.id,
        product_slug: plan!.slug,
        duration_days: plan!.duration_days,
        listing_quota: plan!.listing_quota,
        initiated_at: now.toISOString(),
        change: "new",
        list_price: price,
        // Paid with the request that opens the agence: the console decides both at once.
        opening: true,
        // As quoted; the period itself starts when the receipt is accepted (grantPlanPeriod).
        starts_at: now.toISOString(),
        ends_at: addMonths(now, monthsOf(Number(plan!.duration_days))).toISOString(),
      },
    });
    let { data: pay, error: pErr } = await admin.from("payments").insert(row(request.paymentId)).select("id").single();
    // The page's id was taken (a request sent twice from one page): a fresh one.
    if (pErr?.code === "23505" && request.paymentId) ({ data: pay, error: pErr } = await admin.from("payments").insert(row(null)).select("id").single());
    if (pErr || !pay) {
      await admin.from("shop_members").delete().eq("shop_id", shop.id);
      await admin.from("shops").delete().eq("id", shop.id);
      return fail("shop_create_failed", 500, pErr);
    }
    paymentId = pay.id as string;
  }

  // One notice for one request: the agence and, when it came with one, the
  // plan it paid — the receipt is the console's to check.
  const { data: owner } = plan
    ? await admin.from("profiles").select("full_name").eq("id", user.id).maybeSingle()
    : { data: null };
  const ownerName = ((owner as { full_name: string | null } | null)?.full_name ?? "").trim();
  await admin
    .rpc("_notify_admins", plan
      ? {
          p_kind: "admin_shop_pending",
          p_title: "Demande d'agence",
          p_body: `${ownerName || "Un compte"} demande l'agence « ${shop.name} » avec l'abonnement ${plan.name_fr} (${Number(plan.price)} TND, reçu joint).`,
          p_link: `/admin/agences?id=${shop.id}`,
          p_payload: { vars: { variant: "request", name: shop.name, owner: ownerName || "—", plan: plan.name_fr, amount: Number(plan.price) } },
        }
      : {
          p_kind: "admin_shop_pending",
          p_title: "Agence à valider",
          p_body: `« ${shop.name} » demande à ouvrir son agence.`,
          p_link: `/admin/agences?id=${shop.id}`,
          p_payload: { vars: { name: shop.name } },
        })
    .then(() => {}, () => {});

  logAction(req, user, "shop.create", { id: shop.id, ...(plan ? { plan: plan.slug, paymentId } : {}) });
  return NextResponse.json({ ok: true, id: shop.id, slug: shop.slug, paymentId });
}
