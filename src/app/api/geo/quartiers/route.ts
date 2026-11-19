import { NextRequest, NextResponse } from "next/server";
import { quartiersOf, quartiersOfGovernorate } from "@/lib/geo/quartier";

/**
 * GET /api/geo/quartiers?gov=…&del=… — the quartiers the form suggests in
 * « Quartier » (src/lib/geo/quartiers.ts, from OpenStreetMap): a délégation's,
 * or a whole governorate's with each one's délégation while the seller has not
 * picked one yet (picking a quartier then fills it).
 *
 * Public and the same for everyone: cached on the CDN for a day. The list
 * changes only when the file is regenerated, which is a deploy.
 */
export async function GET(req: NextRequest) {
  const gov = req.nextUrl.searchParams.get("gov");
  const del = req.nextUrl.searchParams.get("del");
  const quartiers = del
    ? quartiersOf(gov, del).map(([fr, ar]) => ({ fr, ar }))
    : quartiersOfGovernorate(gov).map(({ delegation, q: [fr, ar] }) => ({ fr, ar, delegation }));
  return NextResponse.json(
    { quartiers },
    { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } },
  );
}
