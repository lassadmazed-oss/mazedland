import { NextRequest, NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/guard";
import { canOpen } from "@/lib/admin/sections";
import {
  SEARCH_LIMIT, SEARCH_MIN_CHARS, SEARCH_SOURCES, SOURCE_SECTION, cleanTerm, isUuid, listingRefFor, phoneDigits, searchHref, socialRefFor,
  type SearchGroup, type SearchHit, type SearchSource,
} from "@/lib/admin/search";
import { parsePaymentSearch } from "@/lib/payments/search";
import { asAppLocale } from "@/lib/i18n";
import { formatDate, formatTND } from "@/lib/utils";
import { fail } from "@/lib/http/errors";
import { log } from "@/lib/log";

const sLog = log.scope("admin-search");

/**
 * The console's search box (src/components/admin/AdminSearch.tsx): one term,
 * every section the member may open, a few rows each, each with the link that
 * opens it where it is changed. Read through the service client after the
 * gate; a source of a section the member lacks is never queried
 * (SOURCE_SECTION), and one that fails leaves the others standing.
 */

/** The payment kinds /admin/paiements settles (its V3_KINDS). */
const PAYMENT_KINDS = ["listing_fee", "listing_pack", "subscription", "promo", "badge", "renewal"];

type Ctx = {
  admin: SupabaseClient;
  q: string;
  digits: string;
  /** The digits of a phone number, when the term is one (phoneDigits). */
  phone: string | null;
  locale: "fr" | "ar";
  tStatus: Awaited<ReturnType<typeof getTranslations>>;
  t: Awaited<ReturnType<typeof getTranslations>>;
};

const money = (ctx: Ctx, n: number | string | null) => ctx.t("amount", { amount: formatTND(Number(n) || 0, ctx.locale) });
const status = (ctx: Ctx, s: string | null) => (s && ctx.tStatus.has(s) ? ctx.tStatus(s) : s ?? "");
const pick = (ctx: Ctx, fr: string | null, ar: string | null) => (ctx.locale === "ar" ? ar || fr : fr || ar) ?? "";
const compact = (parts: (string | null | undefined | false)[]) => parts.filter((p): p is string => !!p);

const SEARCHES: Record<SearchSource, (ctx: Ctx) => Promise<SearchHit[]>> = {
  async listings(ctx) {
    const ref = listingRefFor(ctx.q);
    const or = [`reference.ilike.%${ctx.q}%`, `title.ilike.%${ctx.q}%`];
    if (ref) or.push(`reference.eq.${ref}`);
    if (ctx.phone && ctx.phone.length >= 4) or.push(`contact_phone.ilike.%${ctx.phone}%`);
    if (isUuid(ctx.q)) or.push(`id.eq.${ctx.q}`);
    const { data, error } = await ctx.admin
      .from("listings")
      .select("id, reference, title, status, governorate, price, price_on_request")
      .or(or.join(","))
      .order("updated_at", { ascending: false })
      .limit(SEARCH_LIMIT);
    if (error) throw error;
    type Row = { id: string; reference: string | null; title: string; status: string; governorate: string | null; price: number | null; price_on_request: boolean | null };
    // An exact reference first: « 1643 » means MZ-01643 before the titles holding 1643.
    const rows = ((data ?? []) as Row[]).sort((a, b) => Number(b.reference === ref) - Number(a.reference === ref));
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      meta: compact([r.reference, r.governorate, r.price && !r.price_on_request ? money(ctx, r.price) : null, status(ctx, r.status)]),
      href: searchHref.listing(r.id, r.reference),
    }));
  },

  async shops(ctx) {
    const or = [`name.ilike.%${ctx.q}%`, `slug.ilike.%${ctx.q}%`, `legal_name.ilike.%${ctx.q}%`, `email.ilike.%${ctx.q}%`];
    if (ctx.phone && ctx.phone.length >= 4) or.push(`phone.ilike.%${ctx.phone}%`);
    if (isUuid(ctx.q)) or.push(`id.eq.${ctx.q}`);
    const { data, error } = await ctx.admin
      .from("shops")
      .select("id, name, status, governorate, city, phone")
      .or(or.join(","))
      .order("created_at", { ascending: false })
      .limit(SEARCH_LIMIT);
    if (error) throw error;
    const tShop = await getTranslations({ locale: ctx.locale, namespace: "pro.status" });
    return ((data ?? []) as { id: string; name: string; status: string; governorate: string | null; city: string | null; phone: string | null }[]).map((r) => ({
      id: r.id,
      title: r.name,
      meta: compact([r.city || r.governorate, r.phone, tShop.has(r.status) ? tShop(r.status) : r.status]),
      href: searchHref.shop(r.id),
    }));
  },

  async sellers(ctx) {
    const or = [`full_name.ilike.%${ctx.q}%`];
    if (ctx.phone) or.push(`phone.ilike.%${ctx.phone}%`);
    if (isUuid(ctx.q)) or.push(`id.eq.${ctx.q}`);
    const { data, error } = await ctx.admin
      .from("profiles")
      .select("id, full_name, phone, role, banned_at")
      .is("deleted_at", null)
      .or(or.join(","))
      .order("created_at", { ascending: false })
      .limit(SEARCH_LIMIT);
    if (error) throw error;
    return ((data ?? []) as { id: string; full_name: string | null; phone: string | null; role: string; banned_at: string | null }[]).map((r) => ({
      id: r.id,
      title: r.full_name?.trim() || r.phone || ctx.t("noName"),
      meta: compact([r.phone, status(ctx, r.role), r.banned_at ? ctx.t("banned") : null]),
      href: searchHref.seller(r.id, r.phone),
    }));
  },

  async payments(ctx) {
    const search = parsePaymentSearch(ctx.q);
    const payers: string[] = [];
    {
      const or = [`full_name.ilike.%${ctx.q}%`];
      if (ctx.phone) or.push(`phone.ilike.%${ctx.phone}%`);
      const { data } = await ctx.admin.from("profiles").select("id").or(or.join(",")).limit(20);
      for (const p of (data ?? []) as { id: string }[]) payers.push(p.id);
    }
    const or = [`admin_notes.ilike.%${ctx.q}%`];
    if (search.idRange) or.push(`and(id.gte.${search.idRange[0]},id.lte.${search.idRange[1]})`);
    if (payers.length) or.push(`user_id.in.(${payers.join(",")})`);
    const { data, error } = await ctx.admin
      .from("payments")
      .select("id, kind, status, amount, created_at, payer:profiles!payments_user_id_fkey (full_name, phone)")
      .in("kind", PAYMENT_KINDS)
      .or(or.join(","))
      .order("created_at", { ascending: false })
      .limit(SEARCH_LIMIT);
    if (error) throw error;
    const tKind = await getTranslations({ locale: ctx.locale, namespace: "admin.paymentKind" });
    type Row = { id: string; kind: string; status: string; amount: number | string; created_at: string; payer: { full_name: string | null; phone: string | null } | null };
    return ((data ?? []) as unknown as Row[]).map((r) => ({
      id: r.id,
      title: `${tKind.has(r.kind) ? tKind(r.kind) : r.kind} · ${money(ctx, r.amount)}`,
      meta: compact([r.payer?.full_name || r.payer?.phone, `MAZED IMMO-${r.id.slice(0, 8).toUpperCase()}`, formatDate(r.created_at, ctx.locale, "medium"), status(ctx, r.status)]),
      href: searchHref.payment(r.id),
    }));
  },

  async invoices(ctx) {
    // A number is « MZ-2026-0001 »-like: only a term with a digit can be one.
    if (!ctx.digits) return [];
    const { data, error } = await ctx.admin
      .from("invoices")
      .select("id, payment_id, credits_invoice_id, number, doc_type, amount_ttc, issued_at")
      .ilike("number", `%${ctx.q}%`)
      .order("issued_at", { ascending: false })
      .limit(SEARCH_LIMIT);
    if (error) throw error;
    type Row = { id: string; payment_id: string | null; credits_invoice_id: string | null; number: string; doc_type: string; amount_ttc: number | string; issued_at: string };
    const rows = (data ?? []) as Row[];
    // A credit note has no payment of its own (0187): it opens the payment of
    // the invoice it cancels, where it is shown.
    const credited = rows.filter((r) => !r.payment_id && r.credits_invoice_id).map((r) => r.credits_invoice_id as string);
    const paymentOf = new Map<string, string>();
    if (credited.length) {
      const { data: originals } = await ctx.admin.from("invoices").select("id, payment_id").in("id", credited);
      for (const o of (originals ?? []) as { id: string; payment_id: string | null }[]) if (o.payment_id) paymentOf.set(o.id, o.payment_id);
    }
    const LABEL: Record<string, string> = { invoice: "invoice", receipt: "receipt", credit_note: "creditNote" };
    return rows.flatMap((r) => {
      const payment = r.payment_id ?? (r.credits_invoice_id ? paymentOf.get(r.credits_invoice_id) : undefined);
      if (!payment) return [];
      return [{
        id: r.id,
        title: ctx.t(LABEL[r.doc_type] ?? "invoice", { number: r.number }),
        meta: compact([money(ctx, r.amount_ttc), formatDate(r.issued_at, ctx.locale, "medium")]),
        href: searchHref.payment(payment),
      }];
    });
  },

  async social(ctx) {
    const ref = socialRefFor(ctx.q);
    if (!ref) return [];
    const { data, error } = await ctx.admin
      .from("social_publication_requests")
      .select("id, ref, status, created_at, listing:listings (title)")
      .eq("ref", ref)
      .limit(SEARCH_LIMIT);
    if (error) throw error;
    type Row = { id: string; ref: string; status: string; created_at: string; listing: { title: string } | { title: string }[] | null };
    const tSocial = await getTranslations({ locale: ctx.locale, namespace: "adminSearch.socialStatus" });
    return ((data ?? []) as unknown as Row[]).map((r) => {
      const listing = Array.isArray(r.listing) ? r.listing[0] : r.listing;
      return {
        id: r.id,
        title: ctx.t("socialRequest", { ref: `MZ-${r.ref}` }),
        meta: compact([listing?.title, formatDate(r.created_at, ctx.locale, "medium"), tSocial.has(r.status) ? tSocial(r.status) : r.status]),
        href: searchHref.social(r.status),
      };
    });
  },

  async ads(ctx) {
    const { data, error } = await ctx.admin
      .from("ads")
      .select("id, advertiser, title, title_ar, placement, ends_at")
      .or(`title.ilike.%${ctx.q}%,title_ar.ilike.%${ctx.q}%,advertiser.ilike.%${ctx.q}%`)
      .order("created_at", { ascending: false })
      .limit(SEARCH_LIMIT);
    if (error) throw error;
    const tPlace = await getTranslations({ locale: ctx.locale, namespace: "adminAds.placements" });
    return ((data ?? []) as { id: string; advertiser: string | null; title: string | null; title_ar: string | null; placement: string; ends_at: string | null }[]).map((r) => ({
      id: r.id,
      title: pick(ctx, r.title, r.title_ar) || r.advertiser || "—",
      meta: compact([r.advertiser, tPlace.has(r.placement) ? tPlace(r.placement) : r.placement, r.ends_at ? ctx.t("until", { date: formatDate(r.ends_at, ctx.locale, "medium") }) : null]),
      href: searchHref.ad(r.id),
    }));
  },

  async products(ctx) {
    const { data, error } = await ctx.admin
      .from("products")
      .select("id, name_fr, name_ar, slug, price, is_active")
      .or(`name_fr.ilike.%${ctx.q}%,name_ar.ilike.%${ctx.q}%,slug.ilike.%${ctx.q}%`)
      .order("sort_order")
      .limit(SEARCH_LIMIT);
    if (error) throw error;
    return ((data ?? []) as { id: string; name_fr: string; name_ar: string | null; slug: string; price: number | string; is_active: boolean }[]).map((r) => ({
      id: r.id,
      title: pick(ctx, r.name_fr, r.name_ar) || r.slug,
      meta: compact([money(ctx, r.price), r.is_active ? null : ctx.t("inactive")]),
      href: searchHref.product(r.id),
    }));
  },

  async articles(ctx) {
    const { data, error } = await ctx.admin
      .from("articles")
      .select("id, slug, status, title_fr, title_ar")
      .or(`title_fr.ilike.%${ctx.q}%,title_ar.ilike.%${ctx.q}%,slug.ilike.%${ctx.q}%`)
      .order("updated_at", { ascending: false })
      .limit(SEARCH_LIMIT);
    if (error) throw error;
    return ((data ?? []) as { id: string; slug: string; status: string; title_fr: string | null; title_ar: string | null }[]).map((r) => ({
      id: r.id,
      title: pick(ctx, r.title_fr, r.title_ar) || r.slug,
      meta: compact([`/guides/${r.slug}`, status(ctx, r.status)]),
      href: searchHref.article(r.id),
    }));
  },

  async categories(ctx) {
    const { data, error } = await ctx.admin
      .from("categories")
      .select("id, slug, label_fr, label_ar, is_active")
      .or(`label_fr.ilike.%${ctx.q}%,label_ar.ilike.%${ctx.q}%,slug.ilike.%${ctx.q}%`)
      .order("sort_order")
      .limit(SEARCH_LIMIT);
    if (error) throw error;
    return ((data ?? []) as { id: string; slug: string; label_fr: string; label_ar: string | null; is_active: boolean }[]).map((r) => ({
      id: r.id,
      title: pick(ctx, r.label_fr, r.label_ar) || r.slug,
      meta: compact([r.slug, r.is_active ? null : ctx.t("inactive")]),
      href: searchHref.category(r.id),
    }));
  },
};

export async function GET(req: NextRequest) {
  // Any member: each source checks its own section below (SOURCE_SECTION).
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;
  const { scopes } = gate;

  const admin = getServiceSupabase();
  if (!admin) return fail("server_misconfigured", 500);

  const q = cleanTerm(req.nextUrl.searchParams.get("q") ?? "");
  if (q.length < SEARCH_MIN_CHARS) return NextResponse.json({ groups: [] });
  const locale = asAppLocale(req.nextUrl.searchParams.get("locale") ?? "fr");

  const ctx: Ctx = {
    admin,
    q,
    digits: q.replace(/\D/g, ""),
    phone: phoneDigits(q),
    locale,
    t: await getTranslations({ locale, namespace: "adminSearch" }),
    tStatus: await getTranslations({ locale, namespace: "admin.status" }),
  };

  const sources = SEARCH_SOURCES.filter((source) => canOpen(scopes, SOURCE_SECTION[source]));
  const settled = await Promise.allSettled(sources.map((source) => SEARCHES[source](ctx)));
  const groups: SearchGroup[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      if (r.value.length) groups.push({ source: sources[i], hits: r.value });
    } else {
      sLog.error(`${sources[i]} failed: ${r.reason instanceof Error ? r.reason.message : JSON.stringify(r.reason)}`);
    }
  });

  return NextResponse.json({ groups, partial: settled.some((r) => r.status === "rejected") });
}
