import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { logAction } from "@/lib/activity";
import { fail } from "@/lib/http/errors";
import { jsonObject } from "@/lib/http/body";
import { isUuid } from "@/lib/uuid";
import { apiTranslator } from "@/lib/i18n/server";
import { CREDIT_NOTE_REASONS, creditNoteReason } from "@/lib/payments/creditNote";
import { decidePayment } from "@/lib/payments/decision";

/**
 * Receipt review — the v3 money queue.
 *
 *   POST { action: "accept" }           → captured; what that unlocks depends on kind
 *   POST { action: "reject", reason }   → failed, with a motif the seller sees
 *   POST { action: "credit_note", reason: "test" | "refunded" | "mistake" }
 *                                       → a captured one cancelled by a credit note
 *
 * There was no working path to either. `/admin/payments` grouped receipts by
 * auction, and `auctions` is empty, so the queue returned nothing by
 * construction — three real `listing_fee` receipts have been sitting in
 * `pending_review` with nowhere to be seen.
 *
 * The database RPC could not have saved it either: `accept_listing_payment`
 * requires `payments.property_id is not null`, and every v3 fee carries its
 * subject in `metadata.listing_id` instead. It raises `payment_missing_property`
 * on all of them. So accepting is a plain status write here, and the
 * `_listing_fee_captured` trigger does the cascade it already knows how to do:
 * move the listing to `pending_review` and notify the seller.
 *
 * Rejection goes through `reject_listing_payment` because that RPC also writes
 * the seller's notification and enforces a real motif — but it is
 * SECURITY DEFINER and checks `is_admin()` against `auth.uid()`, so it must be
 * called with the *admin's* client, never the service client (which has no
 * `auth.uid()` and would be refused).
 *
 * A decision is made in three steps, in this order (the QA tour, 2026-10-30):
 *
 *   1. claim   — `reviewer_id` is taken with one compare-and-set, so two admins
 *                (or accept and reject fired together) cannot both go on: four
 *                accepts at once ran a placement for 60 days and sent four SMS.
 *   2. grant   — the plan, the credits, the badge, the placement.
 *   3. capture — the status, last. The invoice follows the capture (0175), so
 *                a grant that fails leaves the payment where it was, still
 *                pending, with no invoice and nothing to undo: before, it was
 *                captured and invoiced first, and a failed grant left a
 *                customer who had paid with no plan and no way to retry.
 *
 * And nothing is granted on the row's word alone: the product must be the one
 * the kind sells, the amount what the server quoted, the agence or annonce the
 * payer's own (src/lib/payments/quoteCheck.ts). Accept and reject live in
 * src/lib/payments/decision.ts, which the agences console calls too.
 */

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdmin(req, "paiements");
  if (gate instanceof NextResponse) return gate;
  const { user, supabase } = gate;
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const body = await jsonObject(req);
  const action = typeof body.action === "string" ? body.action : "";

  const { data: pay } = await admin
    .from("payments")
    .select("id, user_id, kind, status, amount, metadata")
    .eq("id", id)
    .maybeSingle();
  if (!pay) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // `detail` is shown to the operator verbatim, in the page's language.
  const t = await apiTranslator(req, "adminPayments.api");
  // The payment status in the reader's words, never the enum code.
  const tPay = await apiTranslator(req, "payment.success.status");
  const payWord = (v: unknown) => (tPay.has(String(v)) ? tPay(String(v)) : String(v));
  const conflict = (detail: string) => NextResponse.json({ error: "conflict", detail }, { status: 409 });

  // ── Credit note (0187) ────────────────────────────────────────────────────
  // A payment accepted that should not have been — a test, money given back.
  // Its invoice stays and keeps its number; a credit note cancels it, and what
  // the payment bought stops (the plan, the credits, and since 0192 the
  // placement and the badge too). issue_credit_note does it all in one
  // transaction, and writes the console's log line itself.
  if (action === "credit_note") {
    const reason = creditNoteReason(body.reason);
    if (!reason) {
      return NextResponse.json({ error: "reason_required", detail: t("creditReason") }, { status: 400 });
    }
    if (pay.status !== "captured") return conflict(t("creditNotCaptured", { status: payWord(pay.status) }));
    const { data: inv } = await admin.from("invoices").select("id").eq("payment_id", id).maybeSingle();
    if (!inv) return conflict(t("creditNoInvoice"));
    const { data: noteId, error } = await admin.rpc("issue_credit_note", {
      p_invoice_id: inv.id,
      p_reason: CREDIT_NOTE_REASONS[reason],
      p_actor: user.id,
    });
    if (error) return fail("credit_note_failed", 500, error);
    logAction(req, user, "admin.payment.credit_note", { id, reason, credit_note: noteId });
    return NextResponse.json({ ok: true, status: "refunded", creditNote: noteId });
  }

  if (action !== "accept" && action !== "reject") return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  return decidePayment({ req, admin, supabase, user, pay, action, body });
}
