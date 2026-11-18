import { requireAdmin } from "@/lib/admin/session";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ArrowLeft } from "lucide-react";
import { teamNames } from "@/lib/prospection/report";
import { stageOf } from "@/lib/prospection/agencies/model";
import { agencyMessage, loadOwnAgency, syncAgencyShops } from "@/lib/prospection/agencies/server";
import { AgencyWorkspace, type AgencyEventView } from "./AgencyWorkspace";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("adminProspection");
  return { title: t("agencies.work.pageTitle") };
}

export default async function AgencyPage({ params }: { params: Promise<{ id: string }> }) {
  const { user, scopes } = await requireAdmin("prospection");
  const { id } = await params;
  const t = await getTranslations("adminProspection");
  const locale = (await getLocale()) as "fr" | "ar";
  const admin = getServiceSupabase();
  if (!admin) return null;

  // A member opens the agencies in their charge only: a colleague's is « not found », like an id that does not exist.
  const found = await loadOwnAgency(admin, id, { scopes, userId: user.id });
  if (!found) notFound();
  await syncAgencyShops(admin).catch(() => undefined);
  // Read again: the matching may have just found that it signed up.
  const agency = (await loadOwnAgency(admin, id, { scopes, userId: user.id })) ?? found;

  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? "www.mazed.immo"}`;
  const everyone = scopes === null;

  const [{ data: eventRows }, team, message, shop] = await Promise.all([
    admin.from("prospect_agency_events").select("id, kind, channel, note, actor_id, created_at").eq("agency_id", id).order("created_at", { ascending: false }).limit(100),
    teamNames(admin),
    agencyMessage(agency, origin, locale),
    agency.shop_id
      ? admin.from("shops").select("id, name, status").eq("id", agency.shop_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const names = new Map(team);
  const missing = [...new Set([...(eventRows ?? []).map((e) => e.actor_id as string | null), agency.assigned_to].filter((x): x is string => !!x && !names.has(x)))];
  if (missing.length > 0) {
    const { data } = await admin.from("profiles").select("id, full_name").in("id", missing);
    for (const p of data ?? []) names.set(p.id as string, (p.full_name as string | null) || "—");
  }
  let online = 0;
  if (agency.shop_id) {
    const { count } = await admin.from("listings").select("id", { count: "exact", head: true }).eq("shop_id", agency.shop_id).eq("status", "published");
    online = count ?? 0;
  }

  const events: AgencyEventView[] = (eventRows ?? []).map((e) => ({
    id: e.id as string,
    kind: e.kind as string,
    channel: (e.channel as string | null) ?? null,
    note: (e.note as string | null) ?? null,
    by: e.actor_id ? names.get(e.actor_id as string) ?? "—" : null,
    at: e.created_at as string,
  }));

  return (
    <div>
      <Link href={"/admin/prospection/agences" as "/admin/prospection"} className="mb-3 inline-flex items-center gap-1 text-[12px] font-bold text-muted hover:text-foreground">
        <ArrowLeft className="size-3.5 rtl:rotate-180" /> {t("agencies.work.back")}
      </Link>
      <AdminPageHeader eyebrow={t("agencies.title")} title={agency.name} />
      <AgencyWorkspace
        agency={{
          id: agency.id,
          name: agency.name,
          phone: agency.phone,
          phone2: agency.phone2,
          governorate: agency.governorate,
          city: agency.city,
          address: agency.address,
          website: agency.website,
          facebookUrl: agency.facebook_url,
          email: agency.email,
          legalId: agency.legal_id,
          licensed: agency.licensed,
          source: agency.source,
          sourceNote: agency.source_note,
          status: agency.status,
          outcome: agency.outcome,
          declineReason: agency.decline_reason,
          assignedTo: agency.assigned_to,
          assignedName: agency.assigned_to ? names.get(agency.assigned_to) ?? null : null,
          followUpAt: agency.follow_up_at,
          lastContactAt: agency.last_contact_at,
          contactCount: agency.contact_count,
          stage: stageOf(agency),
        }}
        shop={shop.data ? { id: shop.data.id as string, name: shop.data.name as string, status: shop.data.status as string, online } : null}
        events={events}
        message={message}
        canAssign={everyone}
        members={everyone ? [...team.entries()].map(([mid, name]) => ({ id: mid, name })) : []}
      />
    </div>
  );
}
