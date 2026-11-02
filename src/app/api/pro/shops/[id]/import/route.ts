import { NextRequest, NextResponse } from "next/server";
import { jsonObject } from "@/lib/http/body";
import { fail } from "@/lib/http/errors";
import { logAction } from "@/lib/activity";
import { recordServerEvent } from "@/lib/analytics/server-events";
import { apiTranslator, requestLocale } from "@/lib/i18n/server";
import { getSettings } from "@/lib/settings/server";
import { suspendedResponse } from "@/lib/moderation/ban";
import { proGate } from "@/lib/pro/api";
import { activePlan } from "@/lib/pro/shops";
import { listingFields, phone } from "@/lib/listings/input";
import {
  duplicateKey, interpretFile, readFile, type AttributeDef, type ImportRow, type LeafCategory,
} from "@/lib/listings/importRows";

/**
 * POST /api/pro/shops/:id/import  { text, commit? }
 *
 * « Importer plusieurs annonces » (the agencies' bulk import): the text of a
 * file saved from Excel (CSV) or lines pasted from it. Without `commit` it
 * only says what each line would become — the console of the agence shows it
 * before anything is written. With `commit` every line that is fine becomes a
 * DRAFT of the agence (the same rows the publish form saves), and nothing
 * else: the photos and the seller's attestation are theirs, and the usual
 * moderation reads each annonce when it is sent. Lines are read again on the
 * server — what the browser showed is never what is written.
 *
 * So many lines per file (import_max_rows), and no more drafts than the
 * agence's plan has places (or limit_drafts_per_account, if that is more).
 */
const MAX_TEXT = 600_000;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await proGate(req, { id, action: "publish" });
  if (gate instanceof NextResponse) return gate;
  const { user, admin } = gate;
  const banned = await suspendedResponse(admin, req, user.id);
  if (banned) return banned;

  const settings = await getSettings();
  if (!settings.feature_listing_import) return NextResponse.json({ error: "feature_off" }, { status: 403 });
  const t = await apiTranslator(req, "proApi");

  const { data: shop } = await admin.from("shops").select("name, phone, governorate, status").eq("id", id).maybeSingle();
  if (!shop || shop.status !== "approved") {
    return NextResponse.json({ error: "conflict", detail: t("errors.importNotOpen") }, { status: 409 });
  }

  const body = await jsonObject(req);
  const text = typeof body.text === "string" ? body.text : "";
  if (text.length > MAX_TEXT) return NextResponse.json({ error: "too_big" }, { status: 413 });
  const commit = body.commit === true;

  const file = readFile(text);
  if (!file.ok) return NextResponse.json({ error: file.error, missing: file.missing ?? [] }, { status: 400 });
  const max = settings.import_max_rows;
  if (file.lines.length > max) return NextResponse.json({ error: "too_many_rows", max, rows: file.lines.length }, { status: 400 });

  const [{ data: cats }, { data: attrs }, { data: have }, { data: profile }] = await Promise.all([
    admin.from("categories").select("id, slug, label_fr, label_ar, kind, parent_id").eq("is_active", true).not("parent_id", "is", null),
    admin.from("category_attributes").select("category_id, field_key, label, data_type, required, deal_types"),
    // What the agence already has, so a second import of the same file adds nothing.
    admin
      .from("listings")
      .select("title, price, price_on_request, governorate, attributes")
      .eq("shop_id", id)
      .in("status", ["draft", "pending_review", "pending_payment", "published"])
      .limit(2000),
    admin.from("profiles").select("phone").eq("id", user.id).maybeSingle(),
  ]);
  const existing = new Set(
    ((have ?? []) as { title: string; price: number | string | null; price_on_request: boolean; governorate: string; attributes: Record<string, unknown> | null }[]).map((l) => {
      const area = Number(l.attributes?.area_sqm);
      return duplicateKey(l.title, l.price_on_request || l.price == null ? null : Number(l.price), Number.isFinite(area) && area > 0 ? area : null, l.governorate);
    }),
  );

  const tp = await apiTranslator(req, "publish");
  const locale = requestLocale(req);
  const leaves = (cats ?? []) as LeafCategory[];
  const rows: ImportRow[] = interpretFile(file, {
    leaves,
    attributes: (attrs ?? []) as AttributeDef[],
    defaultGovernorate: shop.governorate as string,
    defaultPhone: phone(shop.phone) ?? phone(profile?.phone),
    contactName: shop.name as string,
    nouns: Object.fromEntries(leaves.map((c) => [c.slug, tp.has(`titleNoun.${c.slug}`) ? tp(`titleNoun.${c.slug}`) : c.label_fr])),
    forRent: (category) => tp("titleForRent", { category }),
    locale,
    existing,
  });
  const ok = rows.filter((r) => r.status === "ok");
  const summary = {
    ok: ok.length,
    error: rows.filter((r) => r.status === "error").length,
    duplicate: rows.filter((r) => r.status === "duplicate").length,
  };
  const shown = rows.map(({ body: _body, ...row }) => row);

  if (!commit) return NextResponse.json({ ok: true, rows: shown, summary, max });
  if (ok.length === 0) return NextResponse.json({ error: "nothing_to_import", rows: shown, summary }, { status: 400 });

  // No more drafts than the agence could ever send: its plan's places, or the
  // usual ceiling when that is higher.
  const plan = await activePlan(admin, id);
  const capacity = Math.max(settings.limit_drafts_per_account, plan?.quota ?? 0);
  const { count: drafts } = await admin
    .from("listings")
    .select("id", { count: "exact", head: true })
    .eq("seller_id", user.id)
    .eq("status", "draft");
  if ((drafts ?? 0) + ok.length > capacity) {
    return NextResponse.json(
      { error: "too_many_drafts", capacity, drafts: drafts ?? 0, rows: ok.length, detail: t("errors.importTooManyDrafts", { capacity, drafts: drafts ?? 0, count: ok.length }) },
      { status: 429 },
    );
  }

  // One statement: all the drafts or none.
  const { data: created, error } = await admin
    .from("listings")
    .insert(ok.map((r) => ({ ...listingFields(r.body!), seller_id: user.id, shop_id: id, status: "draft" })))
    .select("id");
  if (error) return fail("import_failed", 500, error);

  logAction(req, user, "shop.import", { id, count: created?.length ?? ok.length });
  recordServerEvent(req, "listing_import", { userId: user.id, shopId: id, params: { count: created?.length ?? ok.length } });
  return NextResponse.json({ ok: true, created: created?.length ?? ok.length, rows: shown, summary });
}
