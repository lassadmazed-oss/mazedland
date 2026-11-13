-- Rollback of 0222 · asking the price, and a draft with no price yet.
--
-- Roll the code back first: it writes price questions, saves a draft with no
-- price, and reads leads.question_id.
--
-- What is lost: every price question and the price a seller answered with
-- (export the table first). A shop's clients who came with a question stay,
-- counted as added by hand. A draft saved with no price gets 0, the way the
-- form stored « not said yet » before 0222, so the strict rule holds again.

update public.leads set source = 'manual' where source = 'price_question';
alter table public.leads drop constraint if exists leads_source_check;
alter table public.leads add constraint leads_source_check
  check (source in ('visit', 'manual', 'suggestion', 'offer'));
alter table public.leads drop column if exists question_id;

drop table if exists public.price_questions;

update public.listings set price = 0
 where status = 'draft' and price is null and not price_on_request;
alter table public.listings drop constraint if exists listings_price_present;
alter table public.listings add constraint listings_price_present
  check (price_on_request or price is not null);

-- analytics_marketplace as 0204 left it.
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
      'no_price', (select count(*) from public.listings where status = 'published' and (price_on_request or price is null or price <= 0)),
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
