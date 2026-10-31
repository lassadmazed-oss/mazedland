import { NextRequest, NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { canBuy, placementOf, promoEnd, type PromoColumn } from "@/lib/promo";
import type { getServiceSupabase } from "@/lib/supabase/admin";
import type { AdminContext } from "@/lib/admin/guard";
import { logAction } from "@/lib/activity";
import { audit } from "@/lib/admin/audit";
import { fail } from "@/lib/http/errors";
import { isUuid } from "@/lib/uuid";
import { apiTranslator, requestLocale } from "@/lib/i18n/server";
import { formatDate, formatTND } from "@/lib/utils";
import { grantPlanPeriod } from "@/lib/pro/shops";
import { amountMatches, expectedAmount, PRODUCT_KIND_OF, PRODUCT_REQUIRED } from "./quoteCheck";

/**
 * A receipt's verdict — « accept » or « reject » — as /api/admin/paiements/:id
 * gives it, and as the agences console gives it for an agence's request (the
 * agence and its plan's receipt decided together, 2026-10-31). The rules,
 * claim → grant → capture, are in the route's own comment; they live here so
 * both doors go through the same ones.
 *
 * `opening`: the payment is the plan of an agence the same decision opens
 * (POST /api/admin/boutiques/:id). The admins are not told « agence payée — à
 * ouvrir », and the payer hears it once, from the opening.
 */

/** Kinds this screen can settle. The auction kinds are gone. */
const REVIEWABLE = new Set([
  "listing_fee",
  "listing_pack",
  "subscription",
  "promo",
  "badge",
  "renewal",
]);

/** The statuses a decision starts from. */
export const OPEN = ["pending", "pending_review"];

/**
 * How long a decision may hold the payment. A claim older than this is a
 * request that died between the claim and the capture, not a colleague at
 * work: the next admin may take it over instead of meeting 409 forever.
 */
const DECISION_STALE_MS = 10 * 60_000;

export type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

type Meta = {
  product_id?: unknown;
  shop_id?: unknown;
  listing_id?: unknown;
  product_slug?: unknown;
  change?: unknown;
  list_price?: unknown;
  credit?: unknown;
};

type ProductRow = { id: string; kind: string; slug: string; price: number | string; duration_days: number | null; listing_quota: number | null; name_fr: string };
type ListingRow = {
  id: string; seller_id: string; status: string; title: string;
  promo_home_featured: boolean | null; promo_top_listed: boolean | null; promo_banner: boolean | null;
  promo_expires_at: string | null; promo_manual: boolean | null;
};
type ShopRow = { id: string; owner_id: string; name: string; status: string };

/**
 * Step 1: the decision is this admin's, or nobody's. Matches the row only
 * while it is still open and unclaimed (or claimed by a request that died).
 */
export async function claimDecision(
  admin: Admin,
  id: string,
  adminId: string,
): Promise<"claimed" | "taken" | { resolved: string } | { error: unknown }> {
  const staleBefore = new Date(Date.now() - DECISION_STALE_MS).toISOString();
  const { data, error } = await admin
    .from("payments")
    .update({ reviewer_id: adminId, reviewed_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", OPEN)
    .or(`reviewer_id.is.null,reviewed_at.is.null,reviewed_at.lt.${staleBefore}`)
    .select("id");
  if (error) return { error };
  if (data && data.length > 0) return "claimed";
  // Nothing matched: a colleague holds it, or it was decided meanwhile.
  const { data: now } = await admin.from("payments").select("status").eq("id", id).maybeSingle();
  const status = String(now?.status ?? "captured");
  return OPEN.includes(status) ? "taken" : { resolved: status };
}

/** A grant failed: the payment stays open for the next try, under nobody's name. */
export async function releaseDecision(admin: Admin, id: string, adminId: string): Promise<void> {
  await admin
    .from("payments")
    .update({ reviewer_id: null, reviewed_at: null })
    .eq("id", id)
    .eq("reviewer_id", adminId)
    .in("status", OPEN);
}

export type PaymentRow = { id: string; user_id: string; kind: string; status: string; amount: number | string; metadata: unknown };

export async function decidePayment(input: {
  req: NextRequest;
  admin: Admin;
  supabase: AdminContext["supabase"];
  user: User;
  pay: PaymentRow;
  action: "accept" | "reject";
  body: Record<string, unknown>;
  opening?: boolean;
}): Promise<NextResponse> {
  const { req, admin, supabase, user, pay, action, body, opening = false } = input;
  const id = pay.id;
  // `detail` is shown to the operator verbatim, in the page's language.
  const t = await apiTranslator(req, "adminPayments.api");
  // The payment status in the reader's words, never the enum code.
  const tPay = await apiTranslator(req, "payment.success.status");
  const payWord = (v: unknown) => (tPay.has(String(v)) ? tPay(String(v)) : String(v));
  const locale = requestLocale(req);
  const conflict = (detail: string) => NextResponse.json({ error: "conflict", detail }, { status: 409 });

  if (!OPEN.includes(String(pay.status))) return conflict(t("alreadyResolved", { status: payWord(pay.status) }));
  if (!REVIEWABLE.has(pay.kind as string)) {
    return NextResponse.json(
      {
        error: "wrong_kind",
        detail: t("wrongKind", { kind: String(pay.kind) }),
      },
      { status: 400 },
    );
  }

  const kind = pay.kind as string;
  const meta = (pay.metadata ?? {}) as Meta;
  const productId = isUuid(meta.product_id) ? meta.product_id : null;
  const shopId = isUuid(meta.shop_id) ? meta.shop_id : null;
  const listingId = isUuid(meta.listing_id) ? meta.listing_id : null;

  // ── Accept ────────────────────────────────────────────────────────────────
  if (action === "accept") {
    // A payment is accepted on its receipt. On 2026-10-28 a Pro 59 DT with no
    // receipt — a choice the agence had dropped for Business — was accepted
    // and invoiced. Nothing to pay (an upgrade fully covered) needs none.
    if (pay.status !== "pending_review" && Number(pay.amount) > 0) return conflict(t("noReceipt"));

    // What the payment says it buys, read before anything is written: the
    // product the kind sells, at the amount the server quoted, for an agence
    // or an annonce that is the payer's.
    const [{ data: productRow }, { data: shopRow }, { data: listingRow }] = await Promise.all([
      productId
        ? admin.from("products").select("id, kind, slug, price, duration_days, listing_quota, name_fr").eq("id", productId).maybeSingle()
        : Promise.resolve({ data: null }),
      shopId ? admin.from("shops").select("id, owner_id, name, status").eq("id", shopId).maybeSingle() : Promise.resolve({ data: null }),
      listingId
        ? admin
            .from("listings")
            .select("id, seller_id, status, title, promo_home_featured, promo_top_listed, promo_banner, promo_expires_at, promo_manual")
            .eq("id", listingId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const product = productRow as ProductRow | null;
    const shop = shopRow as ShopRow | null;
    const l = listingRow as ListingRow | null;

    if ((PRODUCT_REQUIRED.has(kind) || meta.product_id != null) && (!product || product.kind !== PRODUCT_KIND_OF[kind])) {
      return conflict(t("productUnknown"));
    }
    if (product) {
      const expected = expectedAmount(kind, meta, Number(product.price));
      if (!amountMatches(Number(pay.amount), expected)) {
        return conflict(t("amountMismatch", { amount: formatTND(Number(pay.amount), locale), expected: formatTND(expected, locale) }));
      }
    }
    if (kind === "subscription" && !shop) return conflict(t("subjectMissing"));
    if (meta.shop_id != null && !shop) return conflict(t("subjectMissing"));
    if (shop && shop.owner_id !== pay.user_id) return conflict(t("notPayers"));
    if (kind === "promo" && !l) return conflict(t("subjectMissing"));
    if (meta.listing_id != null && !l) return conflict(t("subjectMissing"));
    if (l && l.seller_id !== pay.user_id) return conflict(t("notPayers"));

    // A placement (0156) goes on the annonce from now — or from where the
    // same one ends — for the product's days.
    let placement: PromoColumn | null = null;
    if (kind === "promo" && l) {
      placement = placementOf(meta.product_slug as string | undefined) ?? placementOf(product?.slug);
      if (!placement) return conflict(t("productUnknown"));
      // Nobody sees a placement on an annonce that is not online: the seller
      // archived it (sold) between the receipt and the review.
      if (l.status !== "published") return conflict(t("listingNotOnline"));
      // Another placement the seller PAID for still runs: granting this one
      // would erase it (the three share one expiry). One an admin curated
      // (promo_manual) gives way to a paid one.
      if (!canBuy(l, placement) && l.promo_manual !== true) {
        return conflict(t("promoRunning", { date: formatDate(l.promo_expires_at as string, locale, "medium") }));
      }
    }

    // Step 1: the decision is this admin's alone.
    const claim = await claimDecision(admin, id, user.id);
    if (typeof claim !== "string") {
      return "error" in claim
        ? fail("decision_failed", 500, claim.error)
        : conflict(t("alreadyResolved", { status: payWord(claim.resolved) }));
    }
    if (claim === "taken") return conflict(t("deciding"));

    // Step 2: what the money buys. A failure here releases the claim and
    // leaves the payment open for the next try.
    const grantFailed = async (code: string, err?: unknown) => {
      await releaseDecision(admin, id, user.id);
      return fail(code, 500, err);
    };
    let granted: string | null = null;

    // A pack is only worth money if the credits actually appear. Nothing in
    // the database does this for us — `_listing_fee_captured` handles fees and
    // `_on_payment_captured` is auction machinery — so it happens here. Once
    // per payment: a retry after a crash must not hand the credits out twice.
    if (kind === "listing_pack" && product) {
      const quota = Number(product.listing_quota);
      if (!(Number.isFinite(quota) && quota > 0)) return grantFailed("credit_product_invalid");
      const { data: already } = await admin.from("seller_credits").select("id").eq("payment_id", pay.id).limit(1);
      if (!already || already.length === 0) {
        // D9: prepaid credits expire after 12 months unless the product says
        // otherwise. Credits with no expiry are an open-ended liability.
        const days = Number(product.duration_days);
        const expires = new Date(
          Date.now() + (Number.isFinite(days) && days > 0 ? days : 365) * 86_400_000,
        );
        const { error: credErr } = await admin.from("seller_credits").insert({
          seller_id: pay.user_id,
          product_id: product.id,
          payment_id: pay.id,
          quota_total: quota,
          quota_used: 0,
          expires_at: expires.toISOString(),
          status: "active",
          granted_by: user.id,
        });
        if (credErr) return grantFailed("credit_grant_failed", credErr);
      }
      granted = `${quota} publications`;
    }

    // A plan (0173): one period of the plan for the shop — at once for a
    // bigger plan than the one running, with the time left on the smaller one
    // added to it, else when what is paid for ends (grantPlanPeriod). The
    // payment id is unique on the period, so the same receipt never grants
    // twice.
    if (kind === "subscription" && product && shop) {
      const quota = Number(product.listing_quota);
      const days = Number(product.duration_days);
      if (!(Number.isFinite(quota) && quota > 0)) return grantFailed("subscription_product_invalid");
      const period = await grantPlanPeriod(admin, {
        shopId: shop.id,
        productId: product.id,
        paymentId: pay.id,
        quota,
        days: Number.isFinite(days) && days > 0 ? days : 30,
        grantedBy: user.id,
        // Quoted before 2026-10-28: full price, so the old days-carried rule.
        legacy: !meta.change,
      });
      if ("error" in period) return grantFailed("subscription_grant_failed", period.error);
      granted = `${product.name_fr ?? "Pro"} jusqu'au ${period.endsAt.toISOString().slice(0, 10)}`
        + (period.carriedDays > 0 ? ` (+${period.carriedDays} j reportés)` : "");

      // An agence pays before it is opened (2026-10-28): the admins hear that
      // this one has, and the console's toast says it is still to open —
      // unless this very decision opens it.
      if (shop.status === "pending" && !opening) {
        granted = `${granted} — agence encore à ouvrir`;
        await admin
          .rpc("_notify_admins", {
            p_kind: "admin_shop_pending",
            p_title: "Agence payée — à ouvrir",
            p_body: `« ${shop.name} » a payé son abonnement ${product.name_fr ?? "Pro"} : ouvrez-la.`,
            p_link: `/admin/agences?id=${shop.id}`,
            p_payload: { vars: { name: shop.name, plan: product.name_fr ?? "Pro", variant: "paid" } },
          })
          .then(() => {}, () => {});
      }
    }

    if (kind === "badge" && product) {
      const { data: already } = await admin.from("seller_badges").select("id").eq("payment_id", pay.id).limit(1);
      if (!already || already.length === 0) {
        const days = Number(product.duration_days);
        // D10: the badge lasts 12 months unless the product sets otherwise.
        const expires = new Date(
          Date.now() + (Number.isFinite(days) && days > 0 ? days : 365) * 86_400_000,
        );
        // One live badge per seller (seller_badges_one_active): a new one
        // replaces the one running, as the console's own grant does.
        const { error: oldErr } = await admin
          .from("seller_badges")
          .update({ revoked_at: new Date().toISOString(), revoke_reason: "remplacé" })
          .eq("seller_id", pay.user_id)
          .is("revoked_at", null);
        if (oldErr) return grantFailed("badge_grant_failed", oldErr);
        const { error: badgeErr } = await admin.from("seller_badges").insert({
          seller_id: pay.user_id,
          kind: "verified",
          product_id: product.id,
          payment_id: pay.id,
          granted_by: user.id,
          expires_at: expires.toISOString(),
        });
        if (badgeErr) return grantFailed("badge_grant_failed", badgeErr);
      }
      granted = "badge vérifié";
    }

    // Bought, so not « manual ».
    let promo: { title: string; until: Date } | null = null;
    if (kind === "promo" && l && placement) {
      const days = Number(product?.duration_days) > 0 ? Number(product?.duration_days) : 30;
      const until = canBuy(l, placement) ? promoEnd(l, placement, days) : new Date(Date.now() + days * 86_400_000);
      const { error: promoErr } = await admin
        .from("listings")
        .update({
          promo_home_featured: placement === "promo_home_featured",
          promo_top_listed: placement === "promo_top_listed",
          promo_banner: placement === "promo_banner",
          promo_expires_at: until.toISOString(),
          promo_manual: false,
        })
        .eq("id", l.id);
      if (promoErr) return grantFailed("promo_grant_failed", promoErr);
      promo = { title: l.title, until };
      granted = `${placement} jusqu'au ${until.toISOString().slice(0, 10)}`;
    }

    // Step 3: captured — under this admin's claim, so a claim taken over
    // meanwhile (a request that died, then ten minutes) cannot capture twice.
    const { data: captured, error: capErr } = await admin
      .from("payments")
      .update({
        status: "captured",
        reviewed_at: new Date().toISOString(),
        admin_notes: null,
      })
      .eq("id", id)
      .eq("reviewer_id", user.id)
      .in("status", OPEN)
      .select("id");
    if (capErr || !captured || captured.length === 0) {
      return fail("capture_failed", 500, capErr ?? new Error("claim lost before capture"));
    }

    // The payer hears it — the fee of an annonce already does, through its own
    // trigger (_listing_fee_captured); every other receipt did not, so a Pro
    // plan or a badge started in silence. With the invoice the capture wrote
    // (0175): its number, and the tap opens the document itself — nobody found
    // it in the payments list (the owner, 2026-10-28). An agence opened by the
    // same decision says it all in one notice, from the opening.
    let invoice: { id: string; number: string } | null = null;
    if (kind !== "listing_fee") {
      const { data: docRow } = await admin.from("invoices").select("id, number, doc_type").eq("payment_id", pay.id).maybeSingle();
      const doc = docRow as { id: string; number: string; doc_type: string } | null;
      const invoiced = doc?.doc_type === "invoice" ? doc : null;
      invoice = doc ? { id: doc.id, number: doc.number } : null;
      if (!opening) await admin
        .rpc("enqueue_notification", {
          p_user_id: pay.user_id,
          p_kind: "payment_accepted",
          p_title: promo ? "Mise en avant active" : invoiced ? `Paiement validé — facture ${invoiced.number}` : "Paiement validé",
          p_body: promo
            ? `La mise en avant de « ${promo.title} » est active jusqu'au ${promo.until.toISOString().slice(0, 10)}.`
            : `Votre paiement de ${pay.amount} TND est validé.${invoiced ? ` Votre facture ${invoiced.number} est prête.` : ""}`,
          p_link: promo && listingId
            ? `/annonces/${listingId}`
            : doc ? `/factures/${doc.id}` : shopId ? "/pro/dashboard" : "/account/payments",
          p_payload: promo
            ? { vars: { variant: "promo", title: promo.title, expires_at: promo.until.toISOString() }, focus: pay.id }
            : {
                vars: { variant: invoiced ? "invoice" : "plain", amount: Number(pay.amount), paymentKind: kind, number: invoiced?.number ?? null },
                focus: pay.id,
              },
        })
        .then(() => {}, () => {});
    }

    logAction(req, user, "admin.payment.accept", { id, kind, granted });
    await audit(admin, user.id, {
      action: "payment.accept", targetType: "payment", targetId: id,
      before: { status: pay.status }, after: { status: "captured", kind, amount: pay.amount, granted },
    });
    return NextResponse.json({ ok: true, status: "captured", granted, invoice });
  }

  // ── Reject ────────────────────────────────────────────────────────────────
  if (action === "reject") {
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    if (reason.length < 5) {
      return NextResponse.json(
        {
          error: "reason_required",
          detail: t("reasonRequired"),
        },
        { status: 400 },
      );
    }

    // The same claim as an accept: a reject and an accept fired together used
    // to both answer 200, the service granted and the seller told « refusé ».
    const claim = await claimDecision(admin, id, user.id);
    if (typeof claim !== "string") {
      return "error" in claim
        ? fail("decision_failed", 500, claim.error)
        : conflict(t("alreadyResolved", { status: payWord(claim.resolved) }));
    }
    if (claim === "taken") return conflict(t("deciding"));

    if (kind === "listing_fee") {
      // The RPC writes the notification and the audit fields together, and it
      // runs as the admin (it checks is_admin() against auth.uid()).
      const { error } = await supabase.rpc("reject_listing_payment", {
        p_payment_id: id,
        p_reason: reason,
      });
      if (error) {
        await releaseDecision(admin, id, user.id);
        return fail("reject_failed", 500, error);
      }
    } else {
      const { data: rejected, error } = await admin
        .from("payments")
        .update({
          status: "failed",
          admin_notes: reason,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("reviewer_id", user.id)
        .in("status", OPEN)
        .select("id");
      if (error) {
        await releaseDecision(admin, id, user.id);
        return fail("reject_failed", 500, error);
      }
      if (!rejected || rejected.length === 0) {
        // Another decision landed first, or a stale claim was taken over: say which.
        const { data: cur } = await admin.from("payments").select("status").eq("id", id).maybeSingle();
        return conflict(t("alreadyResolved", { status: payWord(cur?.status ?? "captured") }));
      }

      // The tap lands on the checkout of this payment, where a new receipt is
      // sent (the receipt route takes one on a refused payment).
      await admin
        .rpc("enqueue_notification", {
          p_user_id: pay.user_id,
          p_kind: "payment_rejected",
          p_title: "Reçu refusé",
          p_body: `Motif : ${reason}. Vous pouvez en envoyer un nouveau.`,
          p_link: `/payment/checkout?payment=${id}`,
          p_payload: { vars: { reason } },
        })
        .then(() => {}, () => {});
    }

    logAction(req, user, "admin.payment.reject", { id, kind });
    await audit(admin, user.id, {
      action: "payment.reject", targetType: "payment", targetId: id,
      before: { status: pay.status }, after: { status: "failed", kind, amount: pay.amount }, note: reason,
    });
    return NextResponse.json({ ok: true, status: "failed" });
  }

  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}
