/**
 * The publishing engine: takes due jobs from the queue (claim_social_jobs,
 * 0170) and does them — post, say « vendu », take down — on the Facebook
 * pages, Instagram and TikTok.
 *
 * Never twice. A job can be taken again after a timeout or a dead run, so
 * before posting on any attempt after the first, the engine looks for a post
 * carrying the request's reference (« MZ-1A2B3C ») and adopts it if it is
 * there. On Instagram the container is stored the moment it is made, and a
 * retry publishes that container instead of making another; on TikTok the
 * same goes for the publish_id (kept in container_id).
 *
 * Never without the rules. A job runs only while its request is approved and
 * its annonce online; otherwise it is cancelled. Each account posts at most
 * `social_daily_limit` times a day (TikTok: `social_tiktok_daily_limit`).
 *
 * Every attempt leaves a row in social_publication_results.
 */
import type { getServiceSupabase } from "@/lib/supabase/admin";
import { log } from "@/lib/log";
import { isPageChannel, type JobAction, type JobStatus, type SocialChannel, type SocialLanguage } from "./channels";
import { closedNotice, referenceCode, tiktokCaption } from "./content";
import { openToken } from "./crypto";
import { requeueWaitingJobs } from "./connect";
import {
  classifyTiktokError, initTiktokPhotoPost, isUnauditedRefusal, pickPrivacy, tiktokClient, tiktokCreatorInfo, TiktokError,
  tiktokPostUrl, tiktokPublishStatus, type TiktokClient, type TiktokPrivacy,
} from "./tiktok";
import { tiktokAccessToken } from "./tiktokConnect";
import {
  createIgContainer, deletePagePost, editPagePost, findIgMedia, findPagePost, graphClient, GraphError,
  igContainerStatus, igPermalink, igPublishingLimit, publishIgContainer, publishPagePost,
  type Fetch, type GraphClient, type PostedRef,
} from "./meta";
import { afterError, nextPostSlot } from "./policy";
import { isMazedPage, refreshRequestStatus, socialOrigin, socialSettings } from "./server";
import { asDealType } from "@/lib/listings/deal";

type Admin = NonNullable<ReturnType<typeof getServiceSupabase>>;
const sLog = log.scope("social");

export type JobRow = {
  id: string;
  request_id: string;
  channel: SocialChannel;
  group_id: string | null;
  action: JobAction;
  account_id: string | null;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  container_id: string | null;
  external_post_id: string | null;
};

export type EngineDeps = {
  fetch?: Fetch;
  /** The site's address, for the photo URLs Meta downloads. */
  origin?: string | null;
  /** How long to wait between two looks at an Instagram container. */
  pollMs?: number;
};

type Outcome = "published" | "done" | "adopted" | "retry" | "failed" | "manual" | "cancelled";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function logResult(
  admin: Admin,
  job: JobRow,
  outcome: Exclude<Outcome, "cancelled">,
  extra: { postId?: string | null; url?: string | null; code?: string | null; message?: string | null; detail?: Record<string, unknown> } = {},
) {
  await admin.from("social_publication_results").insert({
    job_id: job.id,
    attempt: job.attempts,
    outcome,
    external_post_id: extra.postId ?? null,
    external_url: extra.url ?? null,
    error_code: extra.code ?? null,
    error_message: extra.message?.slice(0, 2000) ?? null,
    detail: extra.detail ?? {},
  });
}

async function notifyAdmins(admin: Admin, title: string, body: string) {
  await admin
    .rpc("_notify_admins", {
      p_kind: "admin_social_attention",
      p_title: title,
      p_body: body,
      p_link: "/admin/social?tab=file",
      p_payload: { vars: { title: body } },
    })
    .then(() => {}, () => {});
}

/** The job is done: store where the post is, log it, tell the seller on a first publication. */
async function succeed(admin: Admin, job: JobRow, ref: PostedRef | null, outcome: "published" | "done" | "adopted") {
  const status: JobStatus = job.action === "publish" ? "published" : "done";
  await admin
    .from("social_publication_jobs")
    .update({
      status,
      external_post_id: ref?.id ?? job.external_post_id,
      external_url: ref?.url ?? null,
      published_at: job.action === "publish" ? new Date().toISOString() : undefined,
      last_error: null,
      locked_at: null,
      manual_reason: null,
    })
    .eq("id", job.id);
  await logResult(admin, job, outcome, { postId: ref?.id, url: ref?.url });
  if (job.action !== "publish") return;

  const before = await admin.from("social_publication_requests").select("status, user_id, listing_id").eq("id", job.request_id).maybeSingle();
  await refreshRequestStatus(admin, job.request_id);
  // The seller hears once: when the first channel goes online.
  if (before.data && before.data.status !== "published") {
    await admin
      .rpc("enqueue_notification", {
        p_user_id: before.data.user_id,
        p_kind: "social_published",
        p_title: "Votre annonce est sur les réseaux",
        p_body: "Votre annonce a été publiée sur les réseaux de Mazed Immo.",
        p_link: `/account/listings/${before.data.listing_id}/promote`,
        p_payload: { vars: { channel: job.channel } },
      })
      .then(() => {}, () => {});
  }
}

async function cancel(admin: Admin, job: JobRow, why: string) {
  await admin.from("social_publication_jobs").update({ status: "cancelled", last_error: why, locked_at: null }).eq("id", job.id);
  await refreshRequestStatus(admin, job.request_id);
}

/** Hand the job to a person, with the reason the console shows. */
async function toManual(admin: Admin, job: JobRow, reason: string, message: string) {
  await admin
    .from("social_publication_jobs")
    .update({ status: "manual_action_required", manual_reason: reason, last_error: message, locked_at: null })
    .eq("id", job.id);
  await logResult(admin, job, "manual", { code: reason, message });
  await refreshRequestStatus(admin, job.request_id);
}

/** Put the job back in the queue without spending an attempt (not ready yet, quota). */
async function later(admin: Admin, job: JobRow, minutes: number, why: string) {
  await admin
    .from("social_publication_jobs")
    .update({
      status: "scheduled",
      run_after: new Date(Date.now() + minutes * 60_000).toISOString(),
      attempts: Math.max(0, job.attempts - 1),
      last_error: why,
      locked_at: null,
    })
    .eq("id", job.id);
}

async function postedToday(admin: Admin, accountId: string): Promise<number> {
  const { count } = await admin
    .from("social_publication_jobs")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("action", "publish")
    .eq("status", "published")
    .gte("published_at", new Date(Date.now() - 86_400_000).toISOString());
  return count ?? 0;
}

/** When the account last put a post online (any page channel, or TikTok). */
async function lastPostedAt(admin: Admin, accountId: string): Promise<Date | null> {
  const { data } = await admin
    .from("social_publication_jobs")
    .select("published_at")
    .eq("account_id", accountId)
    .eq("action", "publish")
    .in("status", ["published", "done"])
    .gte("published_at", "2000-01-01T00:00:00Z")
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.published_at ? new Date(data.published_at as string) : null;
}

/**
 * The page's rhythm (2026-11-26): a post no sooner than `social_min_gap_minutes`
 * after the last one, and only in the posting hours. Returns the minutes to wait,
 * 0 when the job may post now. Before, a run posted the five jobs it took one
 * after the other — two or three posts in the same second — until the day's
 * limit stopped the page for the rest of the day.
 */
async function minutesToSlot(admin: Admin, accountId: string, settings: { minGapMinutes: number; hoursStart: number; hoursEnd: number }): Promise<number> {
  const now = new Date();
  const slot = nextPostSlot({
    now,
    lastPostedAt: await lastPostedAt(admin, accountId),
    gapMinutes: settings.minGapMinutes,
    startHour: settings.hoursStart,
    endHour: settings.hoursEnd,
  });
  const ms = slot.getTime() - now.getTime();
  return ms > 30_000 ? Math.ceil(ms / 60_000) : 0;
}

/**
 * The account's id on the network and a client with its token. Instagram
 * posts with its Facebook page's token.
 */
async function clientFor(
  admin: Admin,
  accountId: string,
  deps: EngineDeps,
): Promise<{ g: GraphClient; externalId: string } | { error: "missing" | "expired" | "no_key" }> {
  const { data: acc } = await admin
    .from("social_accounts")
    .select("id, external_id, status, token_sealed, token_expires_at, parent_account_id")
    .eq("id", accountId)
    .maybeSingle();
  if (!acc) return { error: "missing" };
  if (acc.status !== "connected" || (acc.token_expires_at && new Date(acc.token_expires_at).getTime() <= Date.now())) {
    return { error: "expired" };
  }
  let sealed = acc.token_sealed as string | null;
  if (!sealed && acc.parent_account_id) {
    const { data: parent } = await admin
      .from("social_accounts")
      .select("token_sealed, status")
      .eq("id", acc.parent_account_id)
      .maybeSingle();
    if (parent?.status !== "connected") return { error: "expired" };
    sealed = (parent?.token_sealed as string | null) ?? null;
  }
  if (!sealed) return { error: "expired" };
  let token: string;
  try {
    token = openToken(sealed);
  } catch {
    return { error: "no_key" };
  }
  return {
    g: graphClient(token, { appSecret: process.env.META_APP_SECRET ?? null, fetch: deps.fetch }),
    externalId: acc.external_id as string,
  };
}

/** Do one claimed job. Never throws: every outcome ends in the job's row. */
export async function runSocialJob(admin: Admin, job: JobRow, deps: EngineDeps = {}): Promise<Outcome> {
  try {
    return await run(admin, job, deps);
  } catch (err) {
    const kind = err instanceof GraphError ? err.kind : "network";
    const step = afterError(kind, job);
    const message = err instanceof Error ? err.message : String(err);
    sLog.warn("job attempt failed", { job: job.id, channel: job.channel, action: job.action, kind, attempt: job.attempts });

    if (step.expireAccount && job.account_id) {
      await admin.from("social_accounts").update({ status: "expired", last_error: message.slice(0, 500) }).eq("id", job.account_id);
    }
    if (step.status === "manual_action_required") {
      await toManual(admin, job, step.manualReason ?? "account_expired", message);
    } else {
      await admin
        .from("social_publication_jobs")
        .update({
          status: step.status,
          run_after: step.runAfter?.toISOString(),
          last_error: message.slice(0, 1000),
          locked_at: null,
          container_id: step.clearContainer ? null : undefined,
        })
        .eq("id", job.id);
      await logResult(admin, job, step.status === "failed" ? "failed" : "retry", {
        code: err instanceof TiktokError
          ? `${err.kind}:${err.tiktokCode ?? ""}`
          : err instanceof GraphError ? `${err.kind}:${err.code ?? ""}:${err.subcode ?? ""}` : "error",
        message,
      });
      if (step.status === "failed") await refreshRequestStatus(admin, job.request_id);
    }
    if (step.notifyAdmins) {
      await notifyAdmins(admin, "Publication à reprendre", `${job.channel} · ${job.action} : ${message.slice(0, 160)}`);
    }
    return step.status === "failed" ? "failed" : step.status === "scheduled" ? "retry" : "manual";
  }
}

async function run(admin: Admin, job: JobRow, deps: EngineDeps): Promise<Outcome> {
  if (job.attempts > job.max_attempts) {
    await admin.from("social_publication_jobs").update({ status: "failed", locked_at: null }).eq("id", job.id);
    await logResult(admin, job, "failed", { code: "max_attempts" });
    await refreshRequestStatus(admin, job.request_id);
    return "failed";
  }
  // Groups are shared by a person; nothing for the engine to do.
  if (job.channel === "facebook_groups") {
    await toManual(admin, job, "groups_manual", "manual channel");
    return "manual";
  }

  const { data: req } = await admin
    .from("social_publication_requests")
    .select("id, ref, status, language, listing:listings (id, status, deal_type)")
    .eq("id", job.request_id)
    .maybeSingle();
  const listing = (Array.isArray(req?.listing) ? req?.listing[0] : req?.listing) as
    | { id: string; status: string; deal_type: string | null }
    | null
    | undefined;
  if (!req || !listing) {
    await cancel(admin, job, "request_missing");
    return "cancelled";
  }
  if (job.action === "publish" && (!["scheduled", "published", "failed"].includes(req.status as string) || listing.status !== "published")) {
    await cancel(admin, job, listing.status !== "published" ? `listing_${listing.status}` : `request_${req.status}`);
    return "cancelled";
  }

  if (!job.account_id) {
    await toManual(admin, job, "no_account", "no connected account");
    return "manual";
  }
  if (job.channel === "tiktok") return runTiktok(admin, job, job.account_id, deps);
  const client = await clientFor(admin, job.account_id, deps);
  if ("error" in client) {
    await toManual(admin, job, client.error === "missing" ? "no_account" : "account_expired", `account ${client.error}`);
    if (client.error !== "missing") {
      await notifyAdmins(admin, "Compte à reconnecter", `Le compte ${job.channel} doit être reconnecté.`);
    }
    return "manual";
  }
  const { g, externalId } = client;
  const marker = referenceCode(req.ref as string);

  // Follow-ups work on the post the publish job made.
  if (job.action !== "publish") {
    const { data: original } = await admin
      .from("social_publication_jobs")
      .select("external_post_id")
      .eq("request_id", job.request_id)
      .eq("channel", job.channel)
      .eq("action", "publish")
      .is("group_id", null)
      .maybeSingle();
    const postId = original?.external_post_id as string | null | undefined;
    if (!postId || !isPageChannel(job.channel)) {
      await succeed(admin, job, null, "done");
      return "done";
    }
    if (job.action === "remove") {
      try {
        await deletePagePost(g, postId);
      } catch (err) {
        // Already gone is what we wanted.
        if (!(err instanceof GraphError && err.code === 100)) throw err;
      }
    } else {
      const { data: v } = await admin
        .from("social_content_variants")
        .select("body")
        .eq("request_id", job.request_id)
        .eq("channel", job.channel)
        .maybeSingle();
      const notice = closedNotice(asDealType(listing.deal_type), req.language as SocialLanguage);
      await editPagePost(g, postId, `${notice}\n\n${(v?.body as string | undefined) ?? ""}`.trim());
    }
    await succeed(admin, job, { id: postId, url: null }, "done");
    return "done";
  }

  // Already online after an attempt whose outcome was unknown? Take it.
  if (job.attempts > 1 && !job.container_id) {
    const found = isPageChannel(job.channel) ? await findPagePost(g, externalId, marker) : await findIgMedia(g, externalId, marker);
    if (found) {
      await succeed(admin, job, found, "adopted");
      return "adopted";
    }
  }

  const settings = await socialSettings(admin);
  const wait = await minutesToSlot(admin, job.account_id, settings);
  if (wait > 0) {
    await later(admin, job, wait, "spacing");
    return "retry";
  }
  if ((await postedToday(admin, job.account_id)) >= settings.dailyLimit) {
    await later(admin, job, 60, "daily_limit");
    return "retry";
  }

  const { data: variant } = await admin
    .from("social_content_variants")
    .select("body, photo_paths")
    .eq("request_id", job.request_id)
    .eq("channel", job.channel)
    .maybeSingle();
  if (!variant) {
    await cancel(admin, job, "no_variant");
    return "cancelled";
  }
  const origin = socialOrigin(deps.origin);
  const imageUrls = ((variant.photo_paths as string[]) ?? []).map(
    (_, i) => `${origin}/api/social/image/${job.request_id}/${i}?c=${job.channel}`,
  );

  if (isPageChannel(job.channel)) {
    const posted = await publishPagePost(g, externalId, { message: variant.body as string, imageUrls });
    await succeed(admin, job, posted, "published");
    return "published";
  }

  // Instagram: one container, stored at once, published when ready.
  const quota = await igPublishingLimit(g, externalId);
  if (quota && quota.used >= quota.total) {
    await later(admin, job, 60, "instagram_quota");
    return "retry";
  }
  let containerId = job.container_id;
  if (containerId) {
    const status = await igContainerStatus(g, containerId);
    if (status === "PUBLISHED") {
      const found = await findIgMedia(g, externalId, marker);
      await succeed(admin, job, found, "adopted");
      return "adopted";
    }
    if (status === "EXPIRED" || status === "ERROR") containerId = null;
  }
  if (!containerId) {
    containerId = await createIgContainer(g, externalId, { caption: variant.body as string, imageUrls });
    await admin.from("social_publication_jobs").update({ container_id: containerId }).eq("id", job.id);
    job.container_id = containerId;
  }
  for (let i = 0; i < 5; i++) {
    const status = await igContainerStatus(g, containerId);
    if (status === "FINISHED") {
      const posted = await publishIgContainer(g, externalId, containerId);
      await succeed(admin, job, { id: posted.id, url: posted.url ?? (await igPermalink(g, posted.id)) }, "published");
      return "published";
    }
    if (status === "ERROR") throw new GraphError("Instagram could not process the photos", "media");
    if (status === "EXPIRED") throw new GraphError("Instagram container expired", "expired_container");
    await sleep(deps.pollMs ?? 3000);
  }
  await later(admin, job, 2, "container_in_progress");
  return "retry";
}

// ── TikTok ────────────────────────────────────────────────────────────────

/**
 * Posts that left for this TikTok account in the last 24 hours — published,
 * or sent as a draft (TikTok holds at most 5 drafts waiting in the app, and
 * about 15 posts a day, all apps together).
 */
async function tiktokSentToday(admin: Admin, accountId: string): Promise<number> {
  const { count } = await admin
    .from("social_publication_jobs")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("channel", "tiktok")
    .eq("action", "publish")
    .in("status", ["published", "manual_action_required", "done"])
    .gte("published_at", new Date(Date.now() - 86_400_000).toISOString());
  return count ?? 0;
}

/** The draft is in the TikTok app's inbox: a person adds the music, posts it, and pastes its link here. */
async function toTiktokDraft(admin: Admin, job: JobRow, ref: string): Promise<void> {
  await admin
    .from("social_publication_jobs")
    .update({
      status: "manual_action_required",
      manual_reason: "tiktok_draft",
      last_error: null,
      locked_at: null,
      // Counted against TikTok's daily ceiling (tiktokSentToday).
      published_at: new Date().toISOString(),
    })
    .eq("id", job.id);
  await logResult(admin, job, "manual", { code: "tiktok_draft", message: "draft sent to the TikTok app's inbox" });
  await refreshRequestStatus(admin, job.request_id);
  await notifyAdmins(admin, "Brouillon TikTok à publier", `${referenceCode(ref)} : ouvrez l'appli TikTok (boîte de réception) et publiez-le.`);
}

/**
 * Where the post TikTok is making stands: online (the job is published),
 * a draft in the app (a person finishes it), refused (the publish_id is
 * forgotten so a retry starts a new post, and the error goes to the policy),
 * or still downloading the photos — looked at again on the next run.
 */
async function followTiktok(
  admin: Admin,
  job: JobRow,
  c: TiktokClient,
  ctx: { ref: string; username: string | null; adopted: boolean },
  deps: EngineDeps,
): Promise<Outcome> {
  const publishId = job.container_id as string;
  for (let i = 0; i < 5; i++) {
    const st = await tiktokPublishStatus(c, publishId);
    if (st.status === "PUBLISH_COMPLETE") {
      // A private post has no public id, and so no link.
      const postId = st.postIds[0] ?? null;
      await succeed(admin, job, { id: postId ?? publishId, url: tiktokPostUrl(ctx.username, postId) }, ctx.adopted ? "adopted" : "published");
      return ctx.adopted ? "adopted" : "published";
    }
    if (st.status === "SEND_TO_USER_INBOX") {
      await toTiktokDraft(admin, job, ctx.ref);
      return "manual";
    }
    if (st.status === "FAILED") {
      await admin.from("social_publication_jobs").update({ container_id: null }).eq("id", job.id);
      job.container_id = null;
      const reason = st.failReason ?? "failed";
      throw new TiktokError(`TikTok: ${reason}`, classifyTiktokError(200, reason), reason);
    }
    await sleep(deps.pollMs ?? 3000);
  }
  await later(admin, job, 2, "tiktok_processing");
  return "retry";
}

/**
 * A TikTok job: a Photo Mode post of the annonce's photos, or a draft sent
 * to the TikTok app (social_tiktok_draft). The photos are pulled by TikTok
 * from /api/social/image on the site's domain (the one verified in the
 * TikTok app). The publish_id is stored the moment TikTok gives it, and an
 * attempt that finds one follows that post instead of starting another.
 * TikTok's API can neither edit nor delete a post: « vendu » and take-downs
 * are a task for a person.
 */
async function runTiktok(admin: Admin, job: JobRow, accountId: string, deps: EngineDeps): Promise<Outcome> {
  if (job.action !== "publish") {
    await toManual(admin, job, "not_supported", "TikTok's API cannot edit or remove a post");
    return "manual";
  }
  const fresh = await tiktokAccessToken(admin, accountId, { fetch: deps.fetch });
  if (!fresh.ok) {
    const reason = fresh.error === "missing" || fresh.error === "not_configured" ? "no_account" : "account_expired";
    await toManual(admin, job, reason, `tiktok account ${fresh.error}`);
    if (reason === "account_expired") await notifyAdmins(admin, "Compte à reconnecter", "Le compte TikTok doit être reconnecté.");
    return "manual";
  }
  const c = tiktokClient(fresh.token, { fetch: deps.fetch });
  const { data: req } = await admin.from("social_publication_requests").select("ref").eq("id", job.request_id).maybeSingle();
  const ref = (req?.ref as string | undefined) ?? "";
  const ctx = { ref, username: fresh.account.username, adopted: false };

  // Started on an attempt that did not see the end of it: follow that post.
  if (job.container_id) return followTiktok(admin, job, c, { ...ctx, adopted: true }, deps);

  const all = await socialSettings(admin);
  const settings = all.tiktok;
  const wait = await minutesToSlot(admin, accountId, all);
  if (wait > 0) {
    await later(admin, job, wait, "spacing");
    return "retry";
  }
  if ((await tiktokSentToday(admin, accountId)) >= settings.dailyLimit) {
    await later(admin, job, 60, "daily_limit");
    return "retry";
  }

  const { data: variant } = await admin
    .from("social_content_variants")
    .select("body, photo_paths")
    .eq("request_id", job.request_id)
    .eq("channel", job.channel)
    .maybeSingle();
  if (!variant) {
    await cancel(admin, job, "no_variant");
    return "cancelled";
  }
  const photos = (variant.photo_paths as string[] | null) ?? [];
  if (photos.length === 0) {
    await toManual(admin, job, "media_rejected", "a TikTok photo post needs at least one photo");
    return "manual";
  }
  const origin = socialOrigin(deps.origin);
  const imageUrls = photos.map((_, i) => `${origin}/api/social/image/${job.request_id}/${i}?c=tiktok`);
  const { title, description } = tiktokCaption(variant.body as string);

  // A direct post asks TikTok first who it posts as and how (TikTok's rule);
  // a draft is finished in the app, where the person chooses all that.
  let privacy: TiktokPrivacy | undefined;
  let disableComment = !settings.comments;
  if (!settings.draft) {
    const creator = await tiktokCreatorInfo(c);
    privacy = pickPrivacy(creator.privacyOptions, settings.public) ?? undefined;
    if (creator.commentDisabled) disableComment = true;
    if (creator.username) ctx.username = creator.username;
  }

  let publishId: string;
  try {
    publishId = await initTiktokPhotoPost(c, {
      title,
      description,
      imageUrls,
      draft: settings.draft,
      privacy,
      disableComment,
      autoAddMusic: settings.autoMusic,
    });
  } catch (err) {
    // Before TikTok's audit a direct post needs a private account. Not a
    // failure to retry: a person switches to drafts (or posts it by hand).
    if (isUnauditedRefusal(err)) {
      await toManual(admin, job, "tiktok_unaudited", err instanceof Error ? err.message : String(err));
      await notifyAdmins(
        admin,
        "TikTok : application pas encore validée",
        "TikTok n'accepte encore que les comptes privés. Passez TikTok en brouillon dans les réglages, puis « Réessayer ».",
      );
      return "manual";
    }
    throw err;
  }
  await admin.from("social_publication_jobs").update({ container_id: publishId }).eq("id", job.id);
  job.container_id = publishId;
  return followTiktok(admin, job, c, ctx, deps);
}

/** « Tester la connexion » on the TikTok account: a fresh token, and who it posts as. Nothing is posted. */
async function checkTiktokAccount(
  admin: Admin,
  accountId: string,
  deps: EngineDeps,
): Promise<{ ok: true; name: string; quota: null; tiktok: { privacy: TiktokPrivacy[] } } | { ok: false; error: string }> {
  const fresh = await tiktokAccessToken(admin, accountId, { fetch: deps.fetch });
  if (!fresh.ok) return { ok: false, error: fresh.error };
  const now = new Date().toISOString();
  try {
    const info = await tiktokCreatorInfo(tiktokClient(fresh.token, { fetch: deps.fetch }));
    await admin
      .from("social_accounts")
      .update({
        last_checked_at: now,
        last_error: null,
        ...(info.username ? { username: info.username } : {}),
        ...(info.nickname ? { name: info.nickname.slice(0, 200) } : {}),
      })
      .eq("id", accountId);
    return { ok: true, name: info.username ? `@${info.username}` : (info.nickname ?? fresh.account.external_id), quota: null, tiktok: { privacy: info.privacyOptions } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const expired = err instanceof GraphError && err.kind === "auth";
    await admin
      .from("social_accounts")
      .update({ last_checked_at: now, last_error: message.slice(0, 500), ...(expired ? { status: "expired" } : {}) })
      .eq("id", accountId);
    return { ok: false, error: expired ? "expired" : "failed" };
  }
}

/**
 * « Tester la connexion »: read-only calls with the stored token — the page's
 * name, or the Instagram account and its 24 h quota. Nothing is posted. A
 * token Meta refuses marks the account expired, as a failed post would.
 */
export async function checkSocialAccount(
  admin: Admin,
  accountId: string,
  deps: EngineDeps = {},
): Promise<
  | {
      ok: true;
      name: string;
      quota: { used: number; total: number } | null;
      instagram?: { username: string | null; added: boolean };
      tiktok?: { privacy: TiktokPrivacy[] };
    }
  | { ok: false; error: string }
> {
  const { data: acc } = await admin
    .from("social_accounts")
    .select("platform, external_id, username, name, scopes, connected_by")
    .eq("id", accountId)
    .maybeSingle();
  if (!acc) return { ok: false, error: "missing" };
  if (acc.platform === "tiktok") return checkTiktokAccount(admin, accountId, deps);
  const client = await clientFor(admin, accountId, deps);
  if ("error" in client) return { ok: false, error: client.error };
  const now = new Date().toISOString();
  try {
    if (acc.platform === "instagram") {
      const ig = await client.g.get<{ username?: string }>(`/${client.externalId}`, { fields: "username" });
      const quota = await igPublishingLimit(client.g, client.externalId);
      await admin.from("social_accounts").update({ last_checked_at: now, last_error: null }).eq("id", accountId);
      return { ok: true, name: ig.username ? `@${ig.username}` : client.externalId, quota };
    }
    // The page, and the Instagram account linked to it — which may have been
    // linked since the page was connected. Facebook Login is not needed for
    // it: the page's token already carries the Instagram permissions, so the
    // check adopts the account and releases the Instagram posts that were
    // left to a person for want of one (2026-10-31).
    const page = await client.g.get<{ name?: string; instagram_business_account?: { id: string; username?: string } }>(
      `/${client.externalId}`,
      { fields: "name,instagram_business_account{id,username}" },
    );
    await admin.from("social_accounts").update({ last_checked_at: now, last_error: null }).eq("id", accountId);
    let instagram: { username: string | null; added: boolean } | undefined;
    const ig = page.instagram_business_account;
    // Instagram is Mazed Immo's page's only (see saveConnectedPages).
    const mazed = isMazedPage(acc as { external_id: string; username: string | null }, (await socialSettings(admin)).mazedPage);
    if (ig?.id && !mazed) {
      const { data: known } = await admin.from("social_accounts").select("id, status").eq("platform", "instagram").eq("external_id", ig.id).maybeSingle();
      const added = !known || known.status !== "connected";
      await admin.from("social_accounts").upsert(
        {
          platform: "instagram",
          external_id: ig.id,
          name: page.name ?? acc.name,
          username: ig.username ?? null,
          parent_account_id: accountId,
          token_sealed: null,
          token_expires_at: null,
          scopes: acc.scopes ?? [],
          status: "connected",
          last_error: null,
          last_checked_at: now,
          connected_by: acc.connected_by,
          connected_at: now,
        },
        { onConflict: "platform,external_id" },
      );
      if (added) await requeueWaitingJobs(admin);
      instagram = { username: ig.username ?? null, added };
    }
    return { ok: true, name: page.name ?? client.externalId, quota: null, instagram };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const expired = err instanceof GraphError && err.kind === "auth";
    await admin
      .from("social_accounts")
      .update({ last_checked_at: now, last_error: message.slice(0, 500), ...(expired ? { status: "expired" } : {}) })
      .eq("id", accountId);
    return { ok: false, error: expired ? "expired" : "failed" };
  }
}

/** One run of the worker: take up to `limit` due jobs and do them, one at a time. */
export async function runDueSocialJobs(admin: Admin, opts: EngineDeps & { limit?: number } = {}) {
  const { data, error } = await admin.rpc("claim_social_jobs", { p_limit: opts.limit ?? 5 });
  if (error) throw error;
  const counts: Record<Outcome, number> = { published: 0, done: 0, adopted: 0, retry: 0, failed: 0, manual: 0, cancelled: 0 };
  for (const job of (data ?? []) as JobRow[]) {
    counts[await runSocialJob(admin, job, opts)] += 1;
  }
  return { claimed: (data ?? []).length, ...counts };
}
