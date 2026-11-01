-- ============================================================================
-- 0207 · « Le marché en chiffres » (/marche): the one aggregation the public
--        page reads.
--
-- The site's own figures, computed from the annonces it publishes and the
-- demand it sees, for anyone — a buyer wondering what a flat in Sfax asks, a
-- journalist, a search engine. The console's analytics_* functions (0204)
-- name annonces, agences and searches one by one; none of that may reach a
-- public page, so this function exists instead of exposing them:
--
--   · aggregates only — a count, a median, never a row;
--   · the minimum-sample rule is applied HERE, in SQL: a median built from
--     fewer than p_min_sample prices comes back null, with the count beside
--     it, so the page can say « pas encore assez de données » instead of a
--     number that two annonces would make up;
--   · asking prices, never sale prices: what a seller wrote on the site;
--   · service role only, like the console's. The page calls it with the
--     admin client and keeps the result in analytics_cache for
--     public_stats_cache_minutes.
--
-- What it returns (jsonb):
--   generated_at, window_days, min_sample
--   headline     annonces online (sale / rent), published in the last window
--                and in the window before, agences open, governorates served
--   categories   the active leaf categories, with their labels, in order
--   prices       one row per (governorate | all) × (category | all) × deal:
--                n online, priced_n, median (null under the sample),
--                sqm_n, sqm_median (price per m², null under the sample),
--                recent_n / recent_median (published in the window),
--                prev_n / prev_median (the window before) — the trend
--   bands        how the asking prices online spread over the console's
--                bands (0204), per deal, only when the deal has the sample
--   governorates every governorate with an annonce online: online, sale, rent
--   demand       the last window's searches, visit requests and buyer
--                demandes, site-wide and per governorate, each null under
--                the sample
--
-- Days are Tunisian days where it matters (the window is counted back from
-- p_now, so it needs no calendar). Idempotent.
-- Rollback: supabase/rollbacks/0207_public_market_stats.down.sql.
-- ============================================================================

create or replace function public.public_market_stats(
  p_min_sample  int default 5,
  p_window_days int default 30,
  p_now         timestamptz default now()
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with p as (
    select greatest(2, coalesce(p_min_sample, 5))    as min_n,
           greatest(7, coalesce(p_window_days, 30))  as win,
           coalesce(p_now, now())                    as now_at
  ),
  -- Every annonce that was published at some point, with the figures the page
  -- compares on. An annonce without a price (« prix sur demande ») counts in
  -- the supply and in no median; a surface that is not a number counts in no
  -- price per m².
  pub as (
    select l.deal_type   as deal,
           l.governorate as gov,
           c.slug        as cat,
           case when l.price > 0 then l.price end as price,
           case when l.attributes->>'area_sqm' ~ '^[0-9]+([.][0-9]+)?$'
                 and (l.attributes->>'area_sqm')::numeric > 0
                then (l.attributes->>'area_sqm')::numeric end as area,
           l.status,
           l.published_at
      from public.listings l
      join public.categories c on c.id = l.category_id
     where l.deal_type in ('sale', 'rent')
       and l.published_at is not null
       and l.status <> 'rejected'
  ),
  online as (
    select * from pub where status = 'published'
  ),
  -- The supply and the asking prices now, at every level the page shows: the
  -- whole site, a category, a governorate, a category in a governorate.
  now_stats as (
    select gov, cat, deal,
           count(*)                                                  as n,
           count(price)                                              as priced_n,
           percentile_cont(0.5) within group (order by price)
             filter (where price is not null)                        as median,
           count(*) filter (where price is not null and area is not null) as sqm_n,
           percentile_cont(0.5) within group (order by price / area)
             filter (where price is not null and area is not null)   as sqm_median
      from online
     group by grouping sets ((deal), (cat, deal), (gov, deal), (gov, cat, deal))
  ),
  -- The trend: what was published in the last window against the window
  -- before, whatever became of it since (an annonce sold in a week still
  -- asked its price).
  trend as (
    select gov, cat, deal,
           count(*) filter (where published_at >= p.now_at - make_interval(days => p.win) and price is not null) as recent_n,
           percentile_cont(0.5) within group (order by price)
             filter (where published_at >= p.now_at - make_interval(days => p.win) and price is not null)         as recent_median,
           count(*) filter (where published_at <  p.now_at - make_interval(days => p.win) and price is not null) as prev_n,
           percentile_cont(0.5) within group (order by price)
             filter (where published_at <  p.now_at - make_interval(days => p.win) and price is not null)         as prev_median
      from pub cross join p
     where published_at >= p.now_at - make_interval(days => 2 * p.win)
       and published_at <  p.now_at
     group by grouping sets ((deal), (cat, deal), (gov, deal), (gov, cat, deal))
  ),
  -- Demand, in the last window: where people search, which annonces they ask
  -- to visit, which governorates their demandes name.
  d_search as (
    select e.params->>'gov' as gov, count(*) as n
      from public.site_events e cross join p
     where e.name in ('search', 'catalogue_view')
       and e.created_at >= p.now_at - make_interval(days => p.win)
       and e.created_at <  p.now_at
       and coalesce(e.params->>'gov', '') <> ''
     group by 1
  ),
  d_search_total as (
    select count(*) as n
      from public.site_events e cross join p
     where e.name = 'search'
       and e.created_at >= p.now_at - make_interval(days => p.win)
       and e.created_at <  p.now_at
  ),
  d_visits as (
    select l.governorate as gov, count(*) as n
      from public.visit_requests v
      join public.listings l on l.id = v.listing_id
      cross join p
     where v.created_at >= p.now_at - make_interval(days => p.win)
       and v.created_at <  p.now_at
     group by 1
  ),
  d_visits_total as (
    select count(*) as n
      from public.visit_requests v cross join p
     where v.created_at >= p.now_at - make_interval(days => p.win)
       and v.created_at <  p.now_at
  ),
  d_requests as (
    select g as gov, count(*) as n
      from public.property_requests r
      cross join p
      cross join lateral unnest(r.governorates) as g
     where r.created_at >= p.now_at - make_interval(days => p.win)
       and r.created_at <  p.now_at
     group by 1
  ),
  d_requests_total as (
    select count(*) as n
      from public.property_requests r cross join p
     where r.created_at >= p.now_at - make_interval(days => p.win)
       and r.created_at <  p.now_at
  ),
  d_govs as (
    select gov from d_search
    union
    select gov from d_visits
    union
    select gov from d_requests
  )
  select jsonb_build_object(
    'generated_at', (select now_at from p),
    'window_days',  (select win from p),
    'min_sample',   (select min_n from p),
    'headline', jsonb_build_object(
      'online',       (select count(*) from online),
      'sale',         (select count(*) from online where deal = 'sale'),
      'rent',         (select count(*) from online where deal = 'rent'),
      'new_recent',   (select count(*) from pub cross join p
                        where published_at >= p.now_at - make_interval(days => p.win) and published_at < p.now_at),
      'new_prev',     (select count(*) from pub cross join p
                        where published_at >= p.now_at - make_interval(days => 2 * p.win)
                          and published_at <  p.now_at - make_interval(days => p.win)),
      'agences',      (select count(*) from public.shops where status = 'approved'),
      'governorates', (select count(distinct gov) from online)
    ),
    'categories', (
      select coalesce(jsonb_agg(jsonb_build_object('slug', c.slug, 'label_fr', c.label_fr, 'label_ar', c.label_ar, 'kind', c.kind)
                                order by c.sort_order, c.slug), '[]'::jsonb)
        from public.categories c
       where c.is_active and c.parent_id is not null
    ),
    'prices', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'gov',           coalesce(s.gov, t.gov),
               'cat',           coalesce(s.cat, t.cat),
               'deal',          coalesce(s.deal, t.deal),
               'n',             coalesce(s.n, 0),
               'priced_n',      coalesce(s.priced_n, 0),
               'median',        case when coalesce(s.priced_n, 0) >= p.min_n then round(s.median) end,
               -- A price per m² only within one category: across them it
               -- would average a field at 7 DT/m² with a flat at 1 000.
               'sqm_n',         case when s.cat is not null then coalesce(s.sqm_n, 0) else 0 end,
               'sqm_median',    case when s.cat is not null and coalesce(s.sqm_n, 0) >= p.min_n then round(s.sqm_median) end,
               'recent_n',      coalesce(t.recent_n, 0),
               'recent_median', case when coalesce(t.recent_n, 0) >= p.min_n then round(t.recent_median) end,
               'prev_n',        coalesce(t.prev_n, 0),
               'prev_median',   case when coalesce(t.prev_n, 0) >= p.min_n then round(t.prev_median) end
             )), '[]'::jsonb)
        from now_stats s
        full join trend t
          on t.deal = s.deal
         and t.gov is not distinct from s.gov
         and t.cat is not distinct from s.cat
        cross join p
    ),
    'bands', (
      select coalesce(jsonb_agg(jsonb_build_object('deal', b.deal, 'band', b.band, 'n', b.n) order by b.deal, b.band), '[]'::jsonb)
        from (
          select o.deal,
                 case when o.deal = 'rent' then
                   case when o.price < 300 then 1 when o.price < 600 then 2 when o.price < 1000 then 3 when o.price < 2000 then 4 else 5 end
                 else
                   case when o.price < 50000 then 1 when o.price < 100000 then 2 when o.price < 200000 then 3
                        when o.price < 400000 then 4 when o.price < 800000 then 5 else 6 end
                 end as band,
                 count(*) as n
            from online o
           where o.price is not null
             -- The spread of a deal is shown only once the deal has the sample.
             and (select count(*) from online o2 where o2.deal = o.deal and o2.price is not null) >= (select min_n from p)
           group by 1, 2
        ) b
    ),
    'governorates', (
      select coalesce(jsonb_agg(jsonb_build_object('gov', g.gov, 'online', g.n, 'sale', g.sale_n, 'rent', g.rent_n)
                                order by g.n desc, g.gov), '[]'::jsonb)
        from (
          select gov, count(*) as n,
                 count(*) filter (where deal = 'sale') as sale_n,
                 count(*) filter (where deal = 'rent') as rent_n
            from online
           group by gov
        ) g
    ),
    'demand', (
      select jsonb_build_object(
               'searches', case when st.n >= p.min_n then st.n end,
               'visits',   case when vt.n >= p.min_n then vt.n end,
               'demandes', case when rt.n >= p.min_n then rt.n end,
               'by_governorate', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'gov',      x.gov,
                          'searches', case when coalesce(ds.n, 0) >= p.min_n then ds.n end,
                          'visits',   case when coalesce(dv.n, 0) >= p.min_n then dv.n end,
                          'demandes', case when coalesce(dr.n, 0) >= p.min_n then dr.n end
                        ) order by greatest(coalesce(ds.n, 0), coalesce(dv.n, 0), coalesce(dr.n, 0)) desc, x.gov), '[]'::jsonb)
                   from d_govs x
                   left join d_search   ds on ds.gov = x.gov
                   left join d_visits   dv on dv.gov = x.gov
                   left join d_requests dr on dr.gov = x.gov
                  where coalesce(ds.n, 0) >= p.min_n
                     or coalesce(dv.n, 0) >= p.min_n
                     or coalesce(dr.n, 0) >= p.min_n
               )
             )
        from p, d_search_total st, d_visits_total vt, d_requests_total rt
    )
  );
$$;

comment on function public.public_market_stats(int, int, timestamptz) is
  'The public « marché en chiffres » page (0207): aggregates only, medians null under p_min_sample. Service role only.';

revoke execute on function public.public_market_stats(int, int, timestamptz) from public, anon, authenticated;
grant execute on function public.public_market_stats(int, int, timestamptz) to service_role;

notify pgrst, 'reload schema';
