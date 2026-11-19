import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { isSameOrigin } from "@/lib/sameOrigin";
import { clientIp } from "@/lib/clientIp";
import { fail } from "@/lib/http/errors";
import { jsonObject } from "@/lib/http/body";
import { logAction } from "@/lib/activity";
import { asDealType, closedStatus } from "@/lib/listings/deal";
import { findManagedListing, touchManageToken } from "@/lib/prospection/server";

/**
 * POST /api/gerer/:token  { action: "mark_sold" | "withdraw" }
 *
 * What the owner does from the private link in their SMS (0218): mark the
 * annonce sold or rented, or take it down — no password, because the link is
 * the key (24 random bytes, only its hash stored, one live link per annonce,
 * replaced when the SMS is sent again). It goes no further than the two things
 * a seller does from their account with the same words (/api/annonces/:id/status):
 * the annonce is never deleted here, and nothing here puts one online.
 */
const ALLOWED: Record<"mark_sold" | "withdraw", string[]> = {
  mark_sold: ["published", "expired"],
  withdraw: ["published"],
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  const { token } = await params;
  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  // A guess at a token costs the guesser: sixty tries an hour per address.
  const ipHash = createHash("sha256").update(clientIp(req) || "unknown").digest("hex").slice(0, 32);
  const { data: over } = await admin.rpc("check_rate_limit", { p_key: `gerer:${ipHash}`, p_max: 60, p_window_secs: 3600 });
  if (over === true) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const body = await jsonObject(req);
  const action = body.action;
  if (action !== "mark_sold" && action !== "withdraw") return NextResponse.json({ error: "unknown_action" }, { status: 400 });

  const listing = await findManagedListing(admin, token);
  if (!listing) return NextResponse.json({ error: "link_invalid" }, { status: 404 });
  if (!ALLOWED[action].includes(listing.status)) return NextResponse.json({ error: "wrong_status", status: listing.status }, { status: 409 });

  const next = action === "mark_sold" ? closedStatus(asDealType(listing.deal_type)) : "archived";
  const { error } = await admin.from("listings").update({ status: next }).eq("id", listing.id).in("status", ALLOWED[action]);
  if (error) return fail("listing_status_failed", 500, error);

  await touchManageToken(admin, token);
  logAction(req, null, `listing.${action}`, { id: listing.id, from: listing.status, via: "manage_link" });
  return NextResponse.json({ ok: true, status: next });
}
