-- Rollback of 0214 (the « Mazed » page channel, annonces put forward by an
-- admin). What was queued or posted on « Mazed » is forgotten here — the
-- posts themselves stay on Facebook, to take down by hand. An ask that was
-- for « Mazed » only is deleted with its texts and jobs.

delete from public.social_tracking_events where channel = 'facebook_mazed';
delete from public.social_publication_jobs where channel = 'facebook_mazed';
delete from public.social_content_variants where channel = 'facebook_mazed';
delete from public.social_publication_requests where channels = array['facebook_mazed']::text[];
update public.social_publication_requests
   set channels = array_remove(channels, 'facebook_mazed')
 where 'facebook_mazed' = any(channels);

alter table public.social_publication_requests drop constraint if exists social_publication_requests_channels_check;
alter table public.social_publication_requests
  add constraint social_publication_requests_channels_check
  check (cardinality(channels) > 0
         and channels <@ array['facebook_page', 'instagram', 'facebook_groups', 'tiktok']::text[]);
alter table public.social_content_variants drop constraint if exists social_content_variants_channel_check;
alter table public.social_content_variants
  add constraint social_content_variants_channel_check
  check (channel in ('facebook_page', 'instagram', 'facebook_groups', 'tiktok'));
alter table public.social_publication_jobs drop constraint if exists social_publication_jobs_channel_check;
alter table public.social_publication_jobs
  add constraint social_publication_jobs_channel_check
  check (channel in ('facebook_page', 'instagram', 'facebook_groups', 'tiktok'));
alter table public.social_tracking_events drop constraint if exists social_tracking_events_channel_check;
alter table public.social_tracking_events
  add constraint social_tracking_events_channel_check
  check (channel in ('facebook_page', 'instagram', 'facebook_groups', 'tiktok', 'other'));

alter table public.social_publication_requests drop column if exists initiated_by;

-- The follow-up as 0170 wrote it: only Mazed Immo's page through the API.
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
  v_action := case
    when new.status in ('sold', 'rented') then 'mark_closed'
    when new.status in ('archived', 'rejected') then 'remove'
  end;

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

  insert into public.social_publication_jobs (request_id, channel, group_id, action, account_id, status, manual_reason)
  select j.request_id, j.channel, j.group_id, v_action, j.account_id,
         case when j.channel = 'facebook_page' and j.account_id is not null then 'scheduled' else 'manual_action_required' end,
         case when j.channel = 'facebook_page' and j.account_id is not null then null
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
