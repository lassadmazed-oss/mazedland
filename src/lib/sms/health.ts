import type { getServiceSupabase } from "@/lib/supabase/admin";
import { log } from "@/lib/log";
import { SMS_KINDS } from "@/lib/sms-kinds";
import { LEAD_COLUMNS, sendOwnerSms, type LeadRow } from "@/lib/prospection/online";
import { PRODUCTION_ORIGIN, siteUrl } from "@/lib/siteUrl";
import { isSmsConfigured, readOutbox, sendSms } from "@/lib/winsms";
import { forgetSmsVerdict } from "./gate";
import {
  digitsOf, failureReason, failuresAfter, ownerSmsListing, providerDown, smsCarriesLink, type OutboxRow,
} from "./outbox";

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;

const hLog = log.scope("sms-health");

/** A number no Tunisian mobile can have (none starts with 0): the probe reaches nobody. */
const PROBE_TO = "21600000001";
/** While the provider is down, one probe SMS this often (each one is billed): nothing else would show it is back. */
const PROBE_EVERY_MS = 10 * 60_000;
/** Even when nothing was sent, look at the outbox this often. */
const FORCE_EVERY_MS = 60 * 60_000;
/** A message that failed is sent again only if its record is this recent. */
const REQUEUE_WINDOW_MS = 48 * 3_600_000;
const MAX_REQUEUE = 60;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Was anything sent since `iso`? A notification SMS, a code, an owner's SMS: those are what the outbox can contradict. */
async function sentSince(admin: Admin, iso: string): Promise<boolean> {
  const head = { count: "exact" as const, head: true };
  const [n, o, l] = await Promise.all([
    admin.from("notifications").select("id", head).gte("sms_sent_at", iso),
    admin.from("phone_otps").select("phone", head).gte("last_sent_at", iso),
    admin.from("prospect_leads").select("id", head).gte("sms_sent_at", iso),
  ]);
  return (n.count ?? 0) + (o.count ?? 0) + (l.count ?? 0) > 0;
}

export type Requeued = { notifications: number; owners: number; ignored: number };

/**
 * What the provider failed to deliver, sent again. A failed row is matched to
 * our own record by its text: an owner's SMS carries the private /gerer/ link and
 * names its annonce; a notification's SMS ends with that notification's link, and
 * goes to the profile with that number. Whatever matches nothing (a code, an
 * alert) is left: a code is asked for again, an alert comes round again.
 */
export async function requeueFailed(admin: Admin, failed: readonly OutboxRow[]): Promise<Requeued> {
  const out: Requeued = { notifications: 0, owners: 0, ignored: 0 };
  const since = new Date(Date.now() - REQUEUE_WINDOW_MS).toISOString();
  const used = new Set<string>();

  for (const f of failed) {
    const listingId = ownerSmsListing(f.sms);
    if (listingId) {
      const { data } = await admin.from("prospect_leads").select(LEAD_COLUMNS).eq("listing_id", listingId).maybeSingle();
      const lead = data as LeadRow | null;
      if (lead && lead.status === "online") {
        // Marked as not sent, then sent again now: the lead page shows the truth whatever happens next.
        await admin.from("prospect_leads").update({ sms_sent_at: null, sms_error: "provider_down" }).eq("id", lead.id);
        const sent = await sendOwnerSms(admin, { lead: { ...lead, sms_sent_at: null }, origin: siteUrl() ?? PRODUCTION_ORIGIN, actorId: null });
        if (sent.sent) out.owners++;
        else out.ignored++;
      } else out.ignored++;
      continue;
    }

    const { data: profiles } = await admin.from("profiles").select("id").eq("phone", `+${digitsOf(f.phone)}`).limit(5);
    const userIds = (profiles ?? []).map((p) => p.id as string);
    if (userIds.length === 0) { out.ignored++; continue; }
    const { data: rows } = await admin
      .from("notifications")
      .select("id, link")
      .in("user_id", userIds)
      .in("kind", [...SMS_KINDS])
      .not("sms_sent_at", "is", null)
      .gte("sms_sent_at", since)
      .order("sms_sent_at", { ascending: false })
      .limit(30);
    const hit = (rows ?? []).find((r) => !used.has(r.id as string) && smsCarriesLink(f.sms, r.link as string | null));
    if (!hit) { out.ignored++; continue; }
    used.add(hit.id as string);
    // The drain claims it again (sms_attempts back to 0) on its next run.
    await admin.from("notifications").update({ sms_sent_at: null, sms_attempts: 0 }).eq("id", hit.id);
    out.notifications++;
  }
  return out;
}

async function tellAdmins(admin: Admin, kind: "admin_sms_down" | "admin_sms_up", title: string, body: string, vars: Record<string, unknown>) {
  await admin
    .rpc("_notify_admins", { p_kind: kind, p_title: title, p_body: body, p_link: "/admin", p_payload: { vars } })
    .then(() => {}, () => {});
}

export type HealthResult = {
  checked: boolean;
  state: "ok" | "down";
  transition?: "down" | "up";
  skipped?: string;
  probed?: boolean;
  requeued?: Requeued;
};

/**
 * The health job (every ten minutes, 0224): reads WinSMS's outbox when it is
 * worth it, decides whether the provider is failing, keeps the verdict that
 * sendSms obeys, tells the admins when it changes (once), and sends again what
 * failed once the provider answers. Never throws.
 */
export async function runSmsHealth(admin: Admin, now: Date = new Date(), opts: { probeWaitMs?: number } = {}): Promise<HealthResult> {
  try {
    if (!isSmsConfigured()) return { checked: false, state: "ok", skipped: "sms_not_configured" };
    const { data: row } = await admin.from("sms_health").select("state, since, checked_at, last_probe_at, last_requeue_id").eq("id", true).maybeSingle();
    if (!row) return { checked: false, state: "ok", skipped: "no_health_row" };

    const wasDown = row.state === "down";
    const look = wasDown || now.getTime() - Date.parse(row.checked_at as string) >= FORCE_EVERY_MS || (await sentSince(admin, row.checked_at as string));
    if (!look) return { checked: false, state: "ok", skipped: "nothing_sent" };

    let rows = await readOutbox();
    if (!rows) {
      hLog.warn("outbox unreadable");
      return { checked: false, state: wasDown ? "down" : "ok", skipped: "outbox_unreadable" };
    }
    let down = providerDown(rows);

    // Down, nothing sends, so nothing new would ever show the provider is back: one probe now and then.
    let probed = false;
    const lastProbe = row.last_probe_at ? Date.parse(row.last_probe_at as string) : 0;
    if (wasDown && down && now.getTime() - lastProbe >= PROBE_EVERY_MS) {
      await sendSms({ to: PROBE_TO, sms: "diag", skipGate: true });
      await sleep(opts.probeWaitMs ?? 4000);
      rows = (await readOutbox()) ?? rows;
      down = providerDown(rows);
      probed = true;
    }

    const patch: Record<string, unknown> = { checked_at: now.toISOString() };
    if (probed) patch.last_probe_at = now.toISOString();
    let transition: "down" | "up" | undefined;
    if (!wasDown && down) {
      transition = "down";
      patch.state = "down";
      patch.since = now.toISOString();
      patch.note = failureReason(rows[rows.length - 1].status);
    } else if (wasDown && !down) {
      transition = "up";
      patch.state = "ok";
      patch.since = now.toISOString();
      patch.note = null;
    }
    await admin.from("sms_health").update(patch).eq("id", true);
    forgetSmsVerdict();

    // Up (again): what the provider failed in the meantime goes out again.
    let requeued: Requeued | undefined;
    if (!down) {
      // A batch at a time, oldest first: what is left waits for the next run instead of being skipped.
      const batch = failuresAfter(rows, Number(row.last_requeue_id) || 0).slice(0, MAX_REQUEUE);
      if (batch.length > 0) {
        requeued = await requeueFailed(admin, batch);
        await admin.from("sms_health").update({ last_requeue_id: batch[batch.length - 1].id }).eq("id", true);
      }
    }

    if (transition === "down") {
      const reason = failureReason(rows[rows.length - 1].status);
      const at = new Date(now.getTime() + 3_600_000).toISOString().slice(11, 16); // Tunis time
      hLog.error(`WinSMS is failing (${reason}) since ${at}`);
      await tellAdmins(
        admin,
        "admin_sms_down",
        "SMS en panne chez WinSMS",
        `Les SMS ne partent plus (WinSMS : « ${reason} »). Ils sont mis en attente et renvoyés dès que le fournisseur répond.`,
        { reason, at },
      );
    } else if (transition === "up") {
      const count = (requeued?.notifications ?? 0) + (requeued?.owners ?? 0);
      hLog.info(`WinSMS answers again; ${count} SMS sent again`);
      await tellAdmins(admin, "admin_sms_up", "SMS rétablis", `WinSMS répond de nouveau. ${count} SMS renvoyé(s).`, { count });
    }
    return { checked: true, state: down ? "down" : "ok", transition, probed, requeued };
  } catch (err) {
    hLog.error(`health run failed: ${String((err as Error)?.message ?? err)}`);
    return { checked: false, state: "ok", skipped: "error" };
  }
}
