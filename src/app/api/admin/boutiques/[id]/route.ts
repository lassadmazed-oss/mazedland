import { NextRequest, NextResponse } from "next/server";
import { jsonObject } from "@/lib/http/body";
import { requireAdmin } from "@/lib/admin/guard";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { apiTranslator, requestLocale } from "@/lib/i18n/server";
import { activePlan, offerPlanPeriod } from "@/lib/pro/shops";
import { audit } from "@/lib/admin/audit";
import { canOpen } from "@/lib/admin/sections";
import { claimDecision, decidePayment, OPEN, releaseDecision, type PaymentRow } from "@/lib/payments/decision";
import { refusalOutcome } from "@/lib/pro/agenceRequest";
import { getSettings } from "@/lib/settings/server";
import { formatDate } from "@/lib/utils";

/**
 * POST /api/admin/boutiques/:id — the console's decisions on a shop (0173).
 *   approve | reject (reason) | suspend (reason) | reinstate
 *   verify | unverify — separate from opening it: « vérifié » means an admin
 *   checked who they are, and paying never sets it.
 *   offer_plan (product_id) — « Offrir une période »: the founding agencies'
 *   free months, `founding_offer_months` of the plan chosen, once per agence.
 *   An offered plan is a plan: « Ouvrir » then accepts the agence on it.
 *
 * An agence asked for with its plan (the agence request, 2026-10-31) is one
 * decision: « Ouvrir » accepts the plan's receipt still waiting — the same
 * checks and invoice as the payments queue (src/lib/payments/decision.ts),
 * so it needs that section too — then opens the agence on the plan it
 * bought, and the owner hears it once.
 *
 * Each decision starts from a known status, tested in the same statement as
 * the write. A second click, or a second moderator, used to go through again:
 * the review date was overwritten and the owner was told twice. And
 * `reinstate` reopens a suspended agence only — it was a second door for a
 * pending one that had not paid its plan, which only `approve` checks.
 */
const FROM: Record<string, readonly string[]> = {
  approve: ["pending", "rejected"],
  reject: ["pending"],
  suspend: ["approved"],
  reinstate: ["suspended"],
};

/** The code and the sentence for a decision the shop's status does not allow. */
function refusal(action: string, status: string): { error: string; key: string } {
  if (status === "approved" && (action === "approve" || action === "reinstate")) return { error: "already_approved", key: "alreadyOpen" };
  if (status === "rejected" && action === "reject") return { error: "already_rejected", key: "alreadyRejected" };
  if (status === "suspended" && action === "suspend") return { error: "already_suspended", key: "alreadySuspended" };
  if (action === "reinstate") return { error: "wrong_status", key: "reinstateOnlySuspended" };
  return { error: "wrong_status", key: "wrongStatus" };
}

/** The takedown reason an agence's annonces carry while it is closed; « Rouvrir » lifts exactly these. */
const SHOP_CLOSED = "Agence suspendue";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req, "agences");
  if (gate instanceof NextResponse) return gate;
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);
  const { id } = await params;
  const t = await apiTranslator(req, "proApi");

  const body = (await jsonObject(req)) as { action?: unknown; reason?: unknown; product_id?: unknown; outcome?: unknown };
  const action = typeof body.action === "string" ? body.action : "";
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";

  const { data: shop } = await admin.from("shops").select("id, owner_id, name, status").eq("id", id).maybeSingle();
  if (!shop) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const now = new Date().toISOString();
  const by = gate.user.id;

  // Own keys only: { action: "constructor" } used to reach a prototype function.
  const from = Object.prototype.hasOwnProperty.call(FROM, action) ? FROM[action] : undefined;
  if (from && !from.includes(shop.status)) {
    const why = refusal(action, shop.status);
    return NextResponse.json({ error: why.error, detail: t(`errors.${why.key}`) }, { status: 409 });
  }

  if (action === "offer_plan") {
    // A closed agence (refused, suspended) is not offered anything: it has to be reopened first.
    if (shop.status !== "pending" && shop.status !== "approved") {
      return NextResponse.json({ error: "wrong_status", detail: t("errors.offerClosed") }, { status: 409 });
    }
    const productId = typeof body.product_id === "string" ? body.product_id : "";
    const { data: product } = /^[0-9a-f-]{36}$/i.test(productId)
      ? await admin.from("products").select("id, name_fr, listing_quota").eq("id", productId).eq("kind", "subscription").eq("is_active", true).maybeSingle()
      : { data: null };
    const quota = Number(product?.listing_quota);
    if (!product || !(Number.isFinite(quota) && quota > 0)) {
      return NextResponse.json({ error: "invalid", detail: t("errors.plan") }, { status: 400 });
    }
    const { founding_offer_months: months } = await getSettings();
    const period = await offerPlanPeriod(admin, { shopId: id, productId: product.id, quota, months, grantedBy: by });
    if ("error" in period) return fail("shop_offer_failed", 500, period.error);
    if ("already" in period) {
      const date = formatDate(period.already.toISOString(), requestLocale(req), "medium");
      return NextResponse.json({ error: "already_offered", detail: t("errors.offerAlready", { date }) }, { status: 409 });
    }
    logAction(req, gate.user, "admin.shop.offer_plan", { id, product_id: product.id, months });
    await audit(admin, by, {
      action: "shop.offer_plan", targetType: "shop", targetId: id,
      after: { name_fr: product.name_fr, quota, months, ends_at: period.endsAt.toISOString().slice(0, 10) },
    });
    return NextResponse.json({ ok: true, plan: product.name_fr, months, until: period.endsAt.toISOString() });
  }

  // Refusing an agence that came with its plan's receipt: what happens to the
  // money is chosen with the refusal (refusalOutcome, the owner's three).
  // There is no invoice yet — it follows an accepted receipt — so nothing to
  // cancel by credit note.
  let refund: PaymentRow | null = null;
  if (action === "reject") {
    const request = await requestPayment(admin, id);
    if (request) {
      const outcome = refusalOutcome(body.outcome);
      if (!outcome) return NextResponse.json({ error: "invalid", detail: t("errors.outcome") }, { status: 400 });
      if (reason.length < 3) return NextResponse.json({ error: "reason_required", detail: t("errors.reason") }, { status: 400 });
      if (!canOpen(gate.scopes, "paiements")) {
        return NextResponse.json({ error: "forbidden_section", section: "paiements", detail: t("errors.requestNeedsPayments") }, { status: 403 });
      }
      if (outcome === "receipt") {
        // Only the receipt, as the payments queue refuses one: its notice
        // tells the owner why and links to the checkout, where another goes.
        const res = await decidePayment({ req, admin, supabase: gate.supabase, user: gate.user, pay: request, action: "reject", body: { reason } });
        if (!res.ok) return res;
        logAction(req, gate.user, "admin.shop.request_receipt", { id, payment: request.id });
        return NextResponse.json({ ok: true, outcome });
      }
      if (outcome === "fix") {
        // Still waiting, and so is its payment, counted: the owner corrects
        // the agence and the request comes back (PATCH /api/pro/shops/:id).
        const { data: moved, error } = await admin
          .from("shops")
          .update({ rejection_reason: reason, reviewed_by: by, reviewed_at: now })
          .eq("id", id)
          .eq("status", "pending")
          .select("id");
        if (error) return fail("shop_review_failed", 500, error);
        if ((moved ?? []).length === 0) return NextResponse.json({ error: "wrong_status", detail: t("errors.wrongStatus") }, { status: 409 });
        await admin
          .rpc("enqueue_notification", {
            p_user_id: shop.owner_id,
            p_kind: "shop_rejected",
            p_title: "Agence à corriger",
            p_body: `« ${shop.name} » : ${reason}. Corrigez votre agence dans votre espace Pro : la demande revient à l'équipe, sans nouveau paiement.`,
            p_link: "/pro/dashboard?tab=agence",
            p_payload: { vars: { variant: "fix", name: shop.name, reason } },
          })
          .then(() => {}, () => {});
        logAction(req, gate.user, "admin.shop.request_fix", { id });
        await audit(admin, by, { action: "shop.request_fix", targetType: "shop", targetId: id, note: reason });
        return NextResponse.json({ ok: true, outcome });
      }
      // For good: the agence is refused below and the money goes back by
      // hand. The payment is claimed first, so an accept from the payments
      // queue cannot slip in between.
      const claim = await claimDecision(admin, request.id, by);
      if (typeof claim !== "string" && "error" in claim) return fail("shop_review_failed", 500, claim.error);
      if (claim !== "claimed") return NextResponse.json({ error: "conflict", detail: t("errors.requestDeciding") }, { status: 409 });
      refund = request;
    }
  }

  let update: Record<string, unknown>;
  let notice: { kind: string; title: string; body: string; vars: Record<string, string> } | null = null;
  switch (action) {
    case "approve": {
      // The request's plan, its receipt waiting: accepted first, by the
      // payments queue's own rules — the agence then opens on what it bought.
      const request = await requestPayment(admin, id);
      let accepted: { plan: string; until: string; invoice: string | null } | null = null;
      if (request) {
        if (!canOpen(gate.scopes, "paiements")) {
          return NextResponse.json({ error: "forbidden_section", section: "paiements", detail: t("errors.requestNeedsPayments") }, { status: 403 });
        }
        const res = await decidePayment({ req, admin, supabase: gate.supabase, user: gate.user, pay: request, action: "accept", body: {}, opening: true });
        if (!res.ok) return res;
        const j = (await res.json()) as { invoice?: { number: string } | null };
        const running = await activePlan(admin, id);
        accepted = running
          ? { plan: running.name, until: running.endsAt, invoice: j.invoice?.number ?? null }
          : null;
      }
      // A pending agence pays its plan before the console opens it (the
      // owner's rule, 2026-10-28): with no running plan there is nothing to
      // open, and the button used to open it anyway.
      if (!accepted && !(await activePlan(admin, id))) {
        return NextResponse.json({ error: "plan_required", detail: t("errors.planRequired") }, { status: 409 });
      }
      update = { status: "approved", rejection_reason: null, reviewed_by: by, reviewed_at: now };
      notice = accepted
        ? {
            kind: "shop_approved",
            title: "Agence ouverte",
            body: `« ${shop.name} » est ouverte sur Mazed Immo avec l'abonnement ${accepted.plan}, jusqu'au ${accepted.until.slice(0, 10)}.${accepted.invoice ? ` Facture ${accepted.invoice}.` : ""}`,
            // expires_at: the notice prints it as the reader's date (render.ts).
            vars: { variant: "withPlan", name: shop.name, plan: accepted.plan, expires_at: accepted.until, number: accepted.invoice ?? "—" },
          }
        : { kind: "shop_approved", title: "Boutique ouverte", body: `« ${shop.name} » est ouverte sur Mazed Immo.`, vars: { name: shop.name } };
      break;
    }
    case "reject":
    case "suspend":
      if (reason.length < 3) return NextResponse.json({ error: "reason_required", detail: t("errors.reason") }, { status: 400 });
      update = { status: action === "reject" ? "rejected" : "suspended", rejection_reason: reason, reviewed_by: by, reviewed_at: now };
      notice = refund
        ? {
            kind: "shop_rejected",
            title: "Agence non retenue",
            body: `« ${shop.name} » n'a pas été retenue. Motif : ${reason}. Votre paiement de ${Number(refund.amount)} TND vous sera remboursé.`,
            vars: { variant: "refund", name: shop.name, reason, amount: String(Number(refund.amount)) },
          }
        : {
            kind: "shop_rejected",
            title: action === "reject" ? "Boutique non retenue" : "Boutique suspendue",
            body: `« ${shop.name} » : ${reason}`,
            vars: { name: shop.name, reason, variant: action === "reject" ? "rejected" : "suspended" },
          };
      break;
    case "reinstate":
      update = { status: "approved", rejection_reason: null, reviewed_by: by, reviewed_at: now };
      break;
    case "verify":
      update = { verified_at: now, verified_by: by };
      break;
    case "unverify":
      update = { verified_at: null, verified_by: null };
      break;
    default:
      return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  let write = admin.from("shops").update(update).eq("id", id);
  if (from) write = write.in("status", [...from]);
  const { data: moved, error } = await write.select("id");
  if (error) {
    if (refund) await releaseDecision(admin, refund.id, by);
    return fail("shop_review_failed", 500, error);
  }
  // Moved between the read above and the write: nothing was written, and the
  // owner — told by whoever got there first — is not told again.
  if (from && (moved ?? []).length === 0) {
    if (refund) await releaseDecision(admin, refund.id, by);
    return NextResponse.json({ error: "wrong_status", detail: t("errors.wrongStatus") }, { status: 409 });
  }

  // Refused for good: the plan's money goes back to the owner by hand, and
  // the payment says so — refunded, never invoiced (the invoice follows an
  // accepted receipt), with the motif and what is left to do in its note.
  if (refund) {
    const { data: done, error: rErr } = await admin
      .from("payments")
      .update({
        status: "refunded",
        reviewed_at: now,
        admin_notes: `Demande d'agence refusée — à rembourser à la main. Motif : ${reason}`.slice(0, 500),
      })
      .eq("id", refund.id)
      .eq("reviewer_id", by)
      .in("status", OPEN)
      .select("id");
    if (rErr || !done || done.length === 0) return fail("refund_mark_failed", 500, rErr ?? new Error("claim lost before refund"));
    await audit(admin, by, {
      action: "payment.refund_by_hand", targetType: "payment", targetId: refund.id,
      before: { status: refund.status }, after: { status: "refunded", amount: refund.amount, shop: id }, note: reason,
    });
  }

  // The agence's annonces follow it: the dashboard promises « sa page et ses
  // annonces ne sont plus visibles », and every annonce stayed online (the QA
  // tour). Down as a takedown the owner cannot relist, and back up — still
  // within their time — when the agence reopens. A queued one stays in the
  // queue, where approve refuses while the agence is closed.
  if (action === "suspend" || action === "reject") {
    await admin
      .from("listings")
      .update({ status: "archived", taken_down_at: now, taken_down_by: by, taken_down_reason: `${SHOP_CLOSED} : ${reason}`.slice(0, 500) })
      .eq("shop_id", id)
      .eq("status", "published")
      .is("taken_down_at", null)
      .then(() => {}, () => {});
  }
  if (action === "reinstate") {
    const lifted = { taken_down_at: null, taken_down_by: null, taken_down_reason: null };
    await admin
      .from("listings")
      .update({ status: "published", ...lifted })
      .eq("shop_id", id)
      .like("taken_down_reason", `${SHOP_CLOSED}%`)
      .gt("expires_at", now)
      .then(() => {}, () => {});
    await admin
      .from("listings")
      .update({ status: "expired", ...lifted })
      .eq("shop_id", id)
      .like("taken_down_reason", `${SHOP_CLOSED}%`)
      .lte("expires_at", now)
      .then(() => {}, () => {});
  }
  if (notice) {
    await admin
      .rpc("enqueue_notification", {
        p_user_id: shop.owner_id,
        p_kind: notice.kind,
        p_title: notice.title,
        p_body: notice.body,
        p_link: "/pro/dashboard",
        p_payload: { vars: notice.vars },
      })
      .then(() => {}, () => {});
  }
  logAction(req, gate.user, `admin.shop.${action}`, { id });
  return NextResponse.json({ ok: true });
}

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

/**
 * The agence's plan receipt waiting for the console — the request it was
 * opened with, or one sent from its « Abonnement » tab while it waited: the
 * latest. Accepting it is what « Ouvrir » does first.
 */
async function requestPayment(admin: Admin, shopId: string): Promise<PaymentRow | null> {
  const { data } = await admin
    .from("payments")
    .select("id, user_id, kind, status, amount, metadata")
    .eq("kind", "subscription")
    .eq("status", "pending_review")
    .contains("metadata", { shop_id: shopId })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as PaymentRow | null) ?? null;
}
