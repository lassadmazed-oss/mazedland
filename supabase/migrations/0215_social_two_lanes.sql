-- ============================================================================
-- 0215 · Social Publisher: the seller's ask and Mazed's, side by side
--
-- Until now an annonce had ONE live ask (0170, social_requests_one_open), and
-- a published one counts as live. So an annonce whose seller had asked for
-- Mazed Immo's page and Instagram never reached « Mazed » (the 116 K page):
-- the site's sweep skipped it (it had an ask) and « Publier sur nos pages »
-- answered « déjà en cours ». Found 2026-11-10 with the Kerkennah houses the
-- owner wanted on « Mazed ».
--
-- Now an annonce has two lanes, each with at most one live ask:
--   · the seller's own (initiated_by null, consent = the promotion box),
--   · Mazed's (an admin put it forward — initiated_by — or the site did on
--     the CGU alone — consent_version « terms-<version> »), as
--     isFeaturedRequest() reads it in src/lib/social/channels.ts.
-- And the two never share a channel: the same house is posted once on each
-- page. The app leaves the covered channels out before it asks; a trigger
-- refuses an overlap that slips through, with the unique-violation code the
-- app already reads as « déjà en cours ».
--
-- Rollback: supabase/rollbacks/0215_social_two_lanes.down.sql. Idempotent.
-- ============================================================================

-- ── 1. One live ask per annonce and lane ──────────────────────────────────
create unique index if not exists social_requests_one_open_per_lane
  on public.social_publication_requests
     (listing_id, (initiated_by is not null or coalesce(consent_version, '') like 'terms-%'))
  where status in ('draft', 'pending_approval', 'scheduled', 'published', 'failed');

drop index if exists public.social_requests_one_open;

-- ── 2. No channel twice among an annonce's live asks ──────────────────────
create or replace function public._social_requests_no_overlap()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if new.status not in ('draft', 'pending_approval', 'scheduled', 'published', 'failed') then
    return new;
  end if;
  -- One at a time per annonce, so two asks made at the same moment cannot both pass.
  perform pg_advisory_xact_lock(hashtextextended('social_request:' || new.listing_id::text, 0));
  if exists (
    select 1
      from public.social_publication_requests r
     where r.listing_id = new.listing_id
       and r.id <> new.id
       and r.status in ('draft', 'pending_approval', 'scheduled', 'published', 'failed')
       and r.channels && new.channels
  ) then
    raise exception 'social_requests_overlap'
      using errcode = '23505',
            detail = 'Another live ask of this annonce already covers one of these channels.';
  end if;
  return new;
end;
$function$;

revoke execute on function public._social_requests_no_overlap() from public, anon, authenticated;

drop trigger if exists _social_requests_no_overlap on public.social_publication_requests;
create trigger _social_requests_no_overlap
  before insert or update of channels on public.social_publication_requests
  for each row execute function public._social_requests_no_overlap();

notify pgrst, 'reload schema';
