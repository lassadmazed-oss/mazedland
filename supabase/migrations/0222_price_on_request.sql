-- ============================================================================
-- 0222 · « Prix sur demande »: asking the price, and a draft with no price yet
--
-- « Prix sur demande » has existed since 0146 (price_on_request), and on
-- 2026-11-13 21 of the 96 annonces online used it. What it lacked was the
-- second half of « ask me and I'll tell you »: the buyer could only reveal the
-- number (which tells the seller nothing) or ask for a visit. Read-only audit
-- of that day: the priced sales had about four times more numbers revealed
-- than the « sur demande » ones (3.2 against 0.75 per annonce, small sample).
--
-- 1. price_questions — a signed-in buyer asks the price of an annonce
--    « sur demande ». The seller hears it (in the site and by SMS) and answers
--    with the price, which goes to the buyer, or marks it handled (he called).
--    One open question per buyer and annonce. Server-side only, like visits.
-- 2. leads — on a shop's annonce the buyer becomes one of its clients, with
--    the question, the way a visit or an offer does (0174, 0211).
-- 3. listings_price_present — a DRAFT may have neither a price nor
--    « sur demande »: it simply has not been said yet. Until now the voice
--    publisher saved such a draft as « sur demande » and the form opened it
--    with the box ticked, so an annonce could go online without a price nobody
--    chose to hide; the form saved an empty price as 0 for the same reason.
--    Leaving the draft (submit) still needs one or the other: the API says
--    so first, this constraint holds the line behind it.
-- 4. analytics_marketplace — the console's « Sans prix » warning counted every
--    annonce « sur demande »: those have a price, it is just not shown. Same
--    function as 0204 (read back from the live database), that line only.
--
-- rollbacks/0222_price_on_request.down.sql undoes all four.
-- Wrapped in one transaction by scripts/apply-migrations.mjs.
-- ============================================================================

-- ── 1. price_questions ──────────────────────────────────────────────────────
create table if not exists public.price_questions (
  id            uuid primary key default gen_random_uuid(),
  listing_id    uuid not null references public.listings(id) on delete cascade,
  buyer_id      uuid not null references public.profiles(id) on delete cascade,
  seller_id     uuid not null references public.profiles(id) on delete cascade,
  shop_id       uuid references public.shops(id) on delete set null,
  buyer_name    text not null check (char_length(buyer_name) between 1 and 120),
  -- Null once the buyer deleted their account (src/lib/admin/deletion.ts): the
  -- question stays with the seller, the person does not.
  buyer_phone   text check (buyer_phone is null or char_length(buyer_phone) between 8 and 24),
  message       text check (message is null or char_length(message) <= 600),
  -- open: waiting on the seller · answered: the seller gave a price · done:
  -- the seller handled it another way (he called the buyer)
  status        text not null default 'open' check (status in ('open', 'answered', 'done')),
  answer_price  numeric(12,2) check (answer_price is null or answer_price > 0),
  answered_by   uuid references public.profiles(id) on delete set null,
  answered_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint price_questions_answer_has_price check (status <> 'answered' or answer_price is not null)
);

create unique index if not exists price_questions_open_once
  on public.price_questions (listing_id, buyer_id)
  where status = 'open';
create index if not exists price_questions_seller_idx on public.price_questions (seller_id, created_at desc);
create index if not exists price_questions_buyer_idx  on public.price_questions (buyer_id, created_at desc);
create index if not exists price_questions_shop_idx   on public.price_questions (shop_id, created_at desc) where shop_id is not null;

drop trigger if exists _touch_price_questions on public.price_questions;
create trigger _touch_price_questions before update on public.price_questions
  for each row execute function public._touch_updated_at();

alter table public.price_questions enable row level security;
revoke all on table public.price_questions from anon, authenticated;

-- ── 2. A shop's client who came with a question ────────────────────────────
alter table public.leads add column if not exists question_id uuid unique references public.price_questions(id) on delete set null;
alter table public.leads drop constraint if exists leads_source_check;
alter table public.leads add constraint leads_source_check
  check (source in ('visit', 'manual', 'suggestion', 'offer', 'price_question'));

-- ── 3. A draft may not have its price yet ──────────────────────────────────
alter table public.listings drop constraint if exists listings_price_present;
alter table public.listings add constraint listings_price_present
  check (price_on_request or price is not null or status = 'draft');

-- ── 4. « Sans prix » is not « sur demande » ────────────────────────────────
CREATE OR REPLACE FUNCTION public.analytics_marketplace(p_from timestamp with time zone, p_to timestamp with time zone, p_expiring_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with ev as (
    select e.listing_id, l.category_id, l.governorate
      from public.site_events e
      join public.listings l on l.id = e.listing_id
     where e.name = 'listing_view' and e.created_at >= p_from and e.created_at < p_to
  ),
  srch as (
    select params->>'gov' as gov
      from public.site_events
     where name in ('search', 'catalogue_view') and created_at >= p_from and created_at < p_to
       and coalesce(params->>'gov', '') <> ''
  ),
  rv as (
    select l.governorate, l.category_id
      from public.contact_reveals r
      join public.listings l on l.id = r.listing_id
     where r.created_at >= p_from and r.created_at < p_to
  ),
  govs as (
    select governorate as gov from public.listings
    union
    select gov from srch
  )
  select jsonb_build_object(
    'by_status', (
      select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
        from (select status::text as status, count(*) as n from public.listings group by 1) s
    ),
    'by_deal', (
      select coalesce(jsonb_agg(jsonb_build_object('deal', deal_type, 'online', online, 'new', new_n, 'published', pub_n) order by deal_type), '[]'::jsonb)
        from (
          select deal_type,
                 count(*) filter (where status = 'published') as online,
                 count(*) filter (where created_at >= p_from and created_at < p_to) as new_n,
                 count(*) filter (where published_at >= p_from and published_at < p_to) as pub_n
            from public.listings
           group by 1
        ) x
    ),
    'by_category', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'slug', c.slug, 'label_fr', c.label_fr, 'label_ar', c.label_ar, 'kind', c.kind,
               'online', x.online, 'published', x.pub_n, 'new', x.new_n, 'views', x.views, 'reveals', x.reveals,
               'median_sale', x.med_sale, 'median_rent', x.med_rent
             ) order by x.online desc, x.pub_n desc, c.sort_order), '[]'::jsonb)
        from public.categories c
        join lateral (
          select count(*) filter (where l.status = 'published') as online,
                 count(*) filter (where l.published_at >= p_from and l.published_at < p_to) as pub_n,
                 count(*) filter (where l.created_at >= p_from and l.created_at < p_to) as new_n,
                 (select count(*) from ev where ev.category_id = c.id) as views,
                 (select count(*) from rv where rv.category_id = c.id) as reveals,
                 percentile_cont(0.5) within group (order by l.price) filter (where l.status = 'published' and l.deal_type = 'sale' and l.price > 0) as med_sale,
                 percentile_cont(0.5) within group (order by l.price) filter (where l.status = 'published' and l.deal_type = 'rent' and l.price > 0) as med_rent
            from public.listings l
           where l.category_id = c.id
        ) x on true
       -- The leaves only: a parent (« Résidentiel ») holds no annonce of its own.
       where c.is_active and not exists (select 1 from public.categories k where k.parent_id = c.id)
    ),
    'by_governorate', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'gov', g.gov, 'online', g.online, 'published', g.published, 'views', g.views,
               'searches', g.searches, 'reveals', g.reveals, 'demandes', g.demandes
             ) order by g.online desc, g.searches desc, g.gov), '[]'::jsonb)
        from (
          select govs.gov,
                 (select count(*) from public.listings l where l.governorate = govs.gov and l.status = 'published') as online,
                 (select count(*) from public.listings l where l.governorate = govs.gov and l.published_at >= p_from and l.published_at < p_to) as published,
                 (select count(*) from ev where ev.governorate = govs.gov) as views,
                 (select count(*) from srch where srch.gov = govs.gov) as searches,
                 (select count(*) from rv where rv.governorate = govs.gov) as reveals,
                 (select count(*) from public.property_requests pr
                   where pr.created_at >= p_from and pr.created_at < p_to and govs.gov = any (pr.governorates)) as demandes
            from govs
           where govs.gov is not null
        ) g
    ),
    'price_bands', (
      select coalesce(jsonb_agg(jsonb_build_object('category', slug, 'deal', deal_type, 'band', band, 'n', n) order by slug, deal_type, band), '[]'::jsonb)
        from (
          select c.slug, l.deal_type,
                 case when l.deal_type = 'rent' then
                   case when l.price < 300 then 1 when l.price < 600 then 2 when l.price < 1000 then 3 when l.price < 2000 then 4 else 5 end
                 else
                   case when l.price < 50000 then 1 when l.price < 100000 then 2 when l.price < 200000 then 3
                        when l.price < 400000 then 4 when l.price < 800000 then 5 else 6 end
                 end as band,
                 count(*) as n
            from public.listings l
            join public.categories c on c.id = l.category_id
           where l.status = 'published' and l.price > 0
           group by 1, 2, 3
        ) x
    ),
    'time_to_publish', (
      select jsonb_build_object(
               'n', count(*),
               'avg_hours', round((avg(extract(epoch from (published_at - created_at)) / 3600))::numeric, 1),
               'median_hours', round((percentile_cont(0.5) within group (order by extract(epoch from (published_at - created_at)) / 3600))::numeric, 1)
             )
        from public.listings
       where published_at >= p_from and published_at < p_to and published_at >= created_at
    ),
    'funnel', jsonb_build_object(
      'start',     (select count(distinct coalesce(user_id::text, visitor_key)) from public.site_events where name = 'publish_start' and created_at >= p_from and created_at < p_to),
      'category',  (select count(distinct coalesce(user_id::text, visitor_key)) from public.site_events where name = 'publish_step' and params->>'step' = 'category' and created_at >= p_from and created_at < p_to),
      'details',   (select count(distinct coalesce(user_id::text, visitor_key)) from public.site_events where name = 'publish_step' and params->>'step' = 'details' and created_at >= p_from and created_at < p_to),
      'photos',    (select count(distinct coalesce(user_id::text, visitor_key)) from public.site_events where name = 'publish_step' and params->>'step' = 'photos' and created_at >= p_from and created_at < p_to),
      'review',    (select count(distinct coalesce(user_id::text, visitor_key)) from public.site_events where name = 'publish_step' and params->>'step' = 'review' and created_at >= p_from and created_at < p_to),
      'submitted', (select count(distinct coalesce(user_id::text, visitor_key)) from public.site_events where name = 'publish_listing' and created_at >= p_from and created_at < p_to),
      'published', (select count(*) from public.listings where published_at >= p_from and published_at < p_to),
      'abandoned', (select count(distinct coalesce(user_id::text, visitor_key)) from public.site_events where name = 'publish_abandon' and created_at >= p_from and created_at < p_to),
      'drafts',    (select count(*) from public.listings where status = 'draft' and created_at >= p_from and created_at < p_to)
    ),
    'moderation', (
      select jsonb_build_object(
               'submitted',      count(*) filter (where action like 'listing.submit.%'),
               'auto_published', count(*) filter (where action = 'listing.submit.auto_published'),
               'approved',       count(*) filter (where action = 'admin.listing.approve'),
               'rejected',       count(*) filter (where action = 'admin.listing.reject'),
               'archived',       count(*) filter (where action = 'admin.listing.archive'),
               'edits_approved', count(*) filter (where action = 'admin.listing.approve_edit'),
               'edits_rejected', count(*) filter (where action = 'admin.listing.reject_edit'),
               'reports',        (select count(*) from public.listing_reports where created_at >= p_from and created_at < p_to),
               'pending_now',    (select count(*) from public.listings where status = 'pending_review'),
               'review_median_hours', (
                 select round((percentile_cont(0.5) within group (order by extract(epoch from (reviewed_at - created_at)) / 3600))::numeric, 1)
                   from public.listings where reviewed_at >= p_from and reviewed_at < p_to and reviewed_at >= created_at
               )
             )
        from public.activity_log
       where type = 'action' and created_at >= p_from and created_at < p_to
    ),
    'quality', jsonb_build_object(
      'online',   (select count(*) from public.listings where status = 'published'),
      'no_photo', (select count(*) from public.listings l where l.status = 'published'
                     and not exists (select 1 from public.listing_photos p where p.listing_id = l.id)),
      'no_price', (select count(*) from public.listings where status = 'published' and not price_on_request and (price is null or price <= 0)),
      'expiring', (select count(*) from public.listings
                    where status = 'published' and expires_at >= now() and expires_at < now() + make_interval(days => greatest(1, p_expiring_days))),
      'expiring_list', (
        select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'reference', reference, 'expires_at', expires_at) order by expires_at), '[]'::jsonb)
          from (select id, title, reference, expires_at from public.listings
                 where status = 'published' and expires_at >= now() and expires_at < now() + make_interval(days => greatest(1, p_expiring_days))
                 order by expires_at limit 20) x
      )
    )
  );
$function$;

notify pgrst, 'reload schema';
