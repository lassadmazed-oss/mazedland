import { requireAdmin } from "@/lib/admin/session";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getServiceSupabase } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings/server";
import { categoryLabel } from "@/lib/i18n";
import { TUNISIAN_GOVERNORATES, governorateLabel } from "@/lib/tunisia";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ChevronLeft } from "lucide-react";
import { contactsLeft, propertyLine, readDraft } from "@/lib/prospection/model";
import { askMessage, contactsToday, leadWarnings, loadLead, syncLeadWithListing } from "@/lib/prospection/server";
import { LeadWorkspace, type WorkspaceEvent } from "../LeadWorkspace";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("adminProspection");
  return { title: t("work.pageTitle") };
}

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireAdmin("prospection");
  const { id } = await params;
  const t = await getTranslations("adminProspection");
  const locale = (await getLocale()) as "fr" | "ar";
  const admin = getServiceSupabase();
  if (!admin) return null;

  const found = await loadLead(admin, id);
  if (!found) notFound();
  // An annonce an admin approved after the rules held it is online: the lead follows.
  const lead = await syncLeadWithListing(admin, found);

  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? "www.mazed.immo"}`;
  const settings = await getSettings();

  const [{ data: eventRows }, { data: listing }, { data: photoRows }, warnings, { data: members }, { data: catRows }, made, ask] = await Promise.all([
    admin.from("prospect_events").select("id, kind, channel, note, actor_id, created_at").eq("lead_id", id).order("created_at", { ascending: false }).limit(100),
    lead.listing_id ? admin.from("listings").select("id, status").eq("id", lead.listing_id).maybeSingle() : Promise.resolve({ data: null }),
    lead.listing_id ? admin.from("listing_photos").select("storage_path, sort_order").eq("listing_id", lead.listing_id).order("sort_order") : Promise.resolve({ data: [] }),
    leadWarnings(admin, { phone: lead.phone, sourceUrl: lead.source_url, excludeId: id }),
    admin.from("profiles").select("id, full_name").eq("role", "admin").is("banned_at", null).limit(100),
    admin.from("categories").select("slug, label_fr, label_ar, kind, parent_id").eq("is_active", true),
    contactsToday(admin, user.id),
    askMessage(lead, origin),
  ]);

  const names = new Map<string, string>();
  for (const m of members ?? []) names.set(m.id as string, (m.full_name as string | null) || "—");
  const missing = [...(eventRows ?? []).map((e) => e.actor_id as string | null), lead.assigned_to, lead.confirmed_by].filter((x): x is string => !!x && !names.has(x));
  if (missing.length > 0) {
    const { data: more } = await admin.from("profiles").select("id, full_name").in("id", missing);
    for (const m of more ?? []) names.set(m.id as string, (m.full_name as string | null) || "—");
  }

  const events: WorkspaceEvent[] = (eventRows ?? []).map((e) => ({
    id: e.id as string,
    kind: e.kind as string,
    channel: (e.channel as string | null) ?? null,
    note: (e.note as string | null) ?? null,
    by: e.actor_id ? names.get(e.actor_id as string) ?? "—" : null,
    at: e.created_at as string,
  }));

  const draft = readDraft(lead.draft);
  return (
    <div>
      <Link href="/admin/prospection" className="mb-3 inline-flex items-center gap-1 text-[12px] font-bold text-muted hover:text-foreground">
        <ChevronLeft className="size-3.5 rtl:rotate-180" /> {t("work.back")}
      </Link>
      <AdminPageHeader eyebrow={t("eyebrow")} title={propertyLine(draft) || t("untitled")} />
      <LeadWorkspace
        lead={{
          id: lead.id,
          status: lead.status,
          phone: lead.phone,
          name: lead.poster_name,
          url: lead.source_url,
          sourceText: lead.source_text,
          language: lead.language,
          isBroker: lead.is_broker,
          assignedTo: lead.assigned_to,
          followUpAt: lead.follow_up_at,
          outcome: lead.outcome,
          confirmationText: lead.confirmation_text,
          confirmedAt: lead.confirmed_at,
          confirmedBy: lead.confirmed_by ? names.get(lead.confirmed_by) ?? null : null,
          listingId: lead.listing_id,
          listingStatus: (listing?.status as string | null) ?? null,
          smsSentAt: lead.sms_sent_at,
          smsError: lead.sms_error,
          createdAt: lead.created_at,
        }}
        draft={draft}
        photos={(photoRows ?? []).map((p) => ({ path: p.storage_path as string }))}
        events={events}
        warnings={warnings}
        ask={ask}
        members={[...names.entries()].map(([mid, name]) => ({ id: mid, name }))}
        categories={(catRows ?? [])
          .filter((c) => c.parent_id != null)
          .map((c) => ({ slug: c.slug as string, label: categoryLabel(c as { label_fr: string; label_ar: string | null }, locale) }))
          .sort((a, b) => a.label.localeCompare(b.label, locale))}
        governorates={TUNISIAN_GOVERNORATES.map((g) => ({ value: g, label: governorateLabel(g, locale) }))}
        minPhotos={settings.moderation_min_photos}
        contactsLeft={contactsLeft(settings.prospect_daily_cap, made)}
        meId={user.id}
      />
    </div>
  );
}
