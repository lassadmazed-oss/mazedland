import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { propertyPhotoUrl } from "@/lib/imageUrl";
import { governorateLabel } from "@/lib/tunisia";
import { delegationLabel } from "@/lib/delegations";
import { ArrowUpRight, BadgeCheck, Store } from "lucide-react";
import { getSettings } from "@/lib/settings/server";
import { loadReactivity, reactiveRules } from "@/lib/pro/reactivity";
import { ReactiveBadge } from "@/components/agency/ReactiveBadge";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("shops");
  const locale = await getLocale();
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: {
      canonical: `/${locale}/agences`,
      languages: { fr: `/fr/agences`, ar: `/ar/agences`, "x-default": `/fr/agences` },
    },
  };
}

/** Les agences (0173, « boutiques » until 2026-10-27): the open shops, verified ones first, each with its count of annonces online. */
export default async function ShopsPage() {
  const locale = await getLocale();
  const t = await getTranslations("shops");
  const tKinds = await getTranslations("pro.kinds");
  const admin = getServiceSupabase();
  if (!admin) return <p className="p-6 text-[13px] text-muted">{t("unavailable")}</p>;

  const { data } = await admin
    .from("shops")
    .select("id, slug, name, kind, logo_path, governorate, city, verified_at")
    .eq("status", "approved")
    .order("verified_at", { ascending: false, nullsFirst: false })
    .order("name");
  const shops = (data ?? []) as { id: string; slug: string; name: string; kind: string; logo_path: string | null; governorate: string; city: string | null; verified_at: string | null }[];

  const counts = new Map<string, number>();
  if (shops.length) {
    const { data: rows } = await admin.from("listings").select("shop_id").eq("status", "published").in("shop_id", shops.map((s) => s.id));
    for (const r of (rows ?? []) as { shop_id: string }[]) counts.set(r.shop_id, (counts.get(r.shop_id) ?? 0) + 1);
  }
  // « Agence réactive »: earned by answering visit requests fast (src/lib/pro/reactivity.ts).
  const settings = await getSettings();
  const reactivity = settings.feature_agency_reactive ? await loadReactivity(admin, shops.map((s) => s.id), reactiveRules(settings)) : new Map();

  return (
    <main className="mx-auto max-w-[var(--max-w-wide)] px-4 py-6 lg:px-8 lg:py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="mazed-h2 text-[26px] text-foreground lg:text-[34px]">{t("title")}</h1>
          <p className="mt-1.5 text-[14px] text-muted">{t("subtitle")}</p>
        </div>
        <Link href="/pro" className="inline-flex items-center gap-1 rounded-full bg-surface px-4 py-2 text-[12.5px] font-bold text-foreground ring-1 ring-border transition hover:ring-foreground/40">
          {t("openYours")} <ArrowUpRight className="size-3.5 rtl:-scale-x-100" strokeWidth={2.4} aria-hidden />
        </Link>
      </div>

      {shops.length === 0 ? (
        <p className="mt-8 rounded-3xl border border-dashed border-border px-6 py-12 text-center text-[13.5px] text-muted">{t("empty")}</p>
      ) : (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
          {shops.map((s) => (
            <li key={s.id}>
              <Link
                href={`/agences/${s.slug}` as never}
                className="group flex items-center gap-4 rounded-2xl border border-border bg-surface p-4 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)] hover:border-foreground/30"
              >
                <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-2xl bg-surface-2 ring-1 ring-border">
                  {s.logo_path ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a small logo
                    <img src={propertyPhotoUrl(s.logo_path, { transform: { width: 128, quality: 70 } })} alt="" className="size-full object-cover" />
                  ) : (
                    <Store className="size-6 text-muted" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 truncate text-[15px] font-extrabold text-foreground" dir="auto">
                    {s.name}
                    {s.verified_at && <BadgeCheck className="size-4 shrink-0 text-foreground" strokeWidth={2.4} aria-label={t("verified")} />}
                  </span>
                  <span className="mt-0.5 block truncate text-[12.5px] text-muted">
                    {tKinds(s.kind)} · {s.city ? `${delegationLabel(s.city, locale)}, ` : ""}{governorateLabel(s.governorate, locale)}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] font-bold text-foreground">
                    {t("listingsCount", { count: counts.get(s.id) ?? 0 })}
                    <ReactiveBadge reactivity={reactivity.get(s.id)} />
                  </span>
                </span>
                <ArrowUpRight className="size-4 shrink-0 text-subtle transition group-hover:text-foreground rtl:-scale-x-100" strokeWidth={2.2} aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
