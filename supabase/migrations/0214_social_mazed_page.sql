-- ============================================================================
-- 0214 · Social Publisher: the « Mazed » page, and annonces Mazed puts forward
--
-- The owner wants any annonce he likes on Mazed's pages (2026-11-05), on both:
-- Mazed Immo's page (+ Instagram), as before, and « Mazed »
-- (facebook.com/mazedonline, the old auction project's audience).
--
-- 1. A channel of its own, facebook_mazed: posted by the API through the same
--    connection, followed up (« vendu / loué », taken down) like the other
--    page. Which connected page it is comes from the social_mazed_page
--    setting (its id or username); every other page is Mazed Immo's.
-- 2. initiated_by: the admin who put the annonce forward. The ask is still
--    the seller's (they see it and can withdraw it); what stands for their
--    consent is the CGU in the version that allows it (« 3. Annonces »,
--    from legal_version 2026-11-05), recorded in consent_version as
--    « terms-<version> ».
--
-- Rollback: supabase/rollbacks/0214_social_mazed_page.down.sql. Idempotent.
-- ============================================================================

-- ── 1. The channel ─────────────────────────────────────────────────────────
alter table public.social_publication_requests
  drop constraint if exists social_publication_requests_channels_check;
alter table public.social_publication_requests
  add constraint social_publication_requests_channels_check
  check (cardinality(channels) > 0
         and channels <@ array['facebook_page', 'facebook_mazed', 'instagram', 'facebook_groups', 'tiktok']::text[]);

alter table public.social_content_variants
  drop constraint if exists social_content_variants_channel_check;
alter table public.social_content_variants
  add constraint social_content_variants_channel_check
  check (channel in ('facebook_page', 'facebook_mazed', 'instagram', 'facebook_groups', 'tiktok'));

alter table public.social_publication_jobs
  drop constraint if exists social_publication_jobs_channel_check;
alter table public.social_publication_jobs
  add constraint social_publication_jobs_channel_check
  check (channel in ('facebook_page', 'facebook_mazed', 'instagram', 'facebook_groups', 'tiktok'));

alter table public.social_tracking_events
  drop constraint if exists social_tracking_events_channel_check;
alter table public.social_tracking_events
  add constraint social_tracking_events_channel_check
  check (channel in ('facebook_page', 'facebook_mazed', 'instagram', 'facebook_groups', 'tiktok', 'other'));

-- ── 2. Who put it forward ──────────────────────────────────────────────────
alter table public.social_publication_requests
  add column if not exists initiated_by uuid references public.profiles(id) on delete set null;

-- ── When the annonce stops being online: both pages through the API ────────
create or replace function public._social_follow_listing_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_action text;
begin
  if new.status = old.status or old.status <> 'published' then
    return new;
  end if;
  -- Sold or let: say so. Taken down or refused: remove. Anything else (it
  -- expired, it went back to review after an edit) may come back online, so
  -- the posts stay and only what was not posted yet is cancelled.
  v_action := case
    when new.status in ('sold', 'rented') then 'mark_closed'
    when new.status in ('archived', 'rejected') then 'remove'
  end;

  -- Not posted yet: nothing to follow up, the ask simply ends.
  update public.social_publication_jobs j
     set status = 'cancelled', last_error = 'listing_' || new.status
    from public.social_publication_requests r
   where j.request_id = r.id and r.listing_id = new.id
     and j.status in ('scheduled', 'manual_action_required') and j.action = 'publish';
  update public.social_publication_requests
     set status = 'cancelled', closed_at = now()
   where listing_id = new.id and status in ('draft', 'pending_approval', 'scheduled');

  if v_action is null then
    return new;
  end if;

  -- Posted: say so on the post, or take it down. The two Facebook pages do it
  -- through the API; Instagram and the groups are a task for a person.
  insert into public.social_publication_jobs (request_id, channel, group_id, action, account_id, status, manual_reason)
  select j.request_id, j.channel, j.group_id, v_action, j.account_id,
         case when j.channel in ('facebook_page', 'facebook_mazed') and j.account_id is not null then 'scheduled' else 'manual_action_required' end,
         case when j.channel in ('facebook_page', 'facebook_mazed') and j.account_id is not null then null
              when j.channel = 'facebook_groups' then 'groups_manual'
              else 'not_supported' end
    from public.social_publication_jobs j
    join public.social_publication_requests r on r.id = j.request_id
   where r.listing_id = new.id and j.action = 'publish' and j.status = 'published'
  on conflict on constraint social_jobs_once do nothing;

  update public.social_publication_requests
     set closed_at = now()
   where listing_id = new.id and status = 'published' and closed_at is null;
  return new;
end;
$function$;

revoke execute on function public._social_follow_listing_status() from public, anon, authenticated;

notify pgrst, 'reload schema';
