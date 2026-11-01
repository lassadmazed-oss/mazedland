-- ============================================================================
-- 0206 · Statistiques, after review (PR #61): a guarded cast, a weighted
--        rate limit, the report cache pruned.
--
--   analytics_demand    `params->>'results'` was cast to int as is: one
--                       batch with results = "x" (any visitor can send one)
--                       made the function throw for every period holding
--                       the row. Cast only when the text is digits.
--   check_rate_limit_n  check_rate_limit (0196) counting p_n hits at once:
--                       /api/events sends batches of 1–25 events, and the
--                       cap is in events an hour, not in batches.
--   prune_site_events   also forgets Google's cached reports older than two
--                       days (analytics_cache grew forever).
--
-- Rollback: supabase/rollbacks/0206_analytics_fixes.down.sql. Idempotent.
-- ============================================================================

create or replace function public.analytics_demand(p_from timestamptz, p_to timestamptz, p_limit int default 10, p_fast_hours int default 24)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with s as (
    select lower(btrim(params->>'q')) as q,
           -- A browser's number, cast only when it is one: anything else is no result count.
           case when params->>'results' ~ '^[0-9]{1,9}$' then (params->>'results')::int end as results,
           case params->>'understood' when 'true' then true when 'false' then false else null end as understood
      from public.site_events
     where name = 'search' and created_at >= p_from and created_at < p_to
  ),
  lv as (
    select listing_id, count(*) as cnt
      from public.site_events
     where name = 'listing_view' and listing_id is not null and created_at >= p_from and created_at < p_to
     group by 1
  ),
  -- Before the site counted its own events, the per-viewer table is the only
  -- memory of what was opened: it ranks the annonces when the events are empty.
  cand as (
    select listing_id, cnt from lv
    union all
    select listing_id, sum(view_count) as cnt
      from public.listing_views
     where last_seen_at >= p_from and last_seen_at < p_to and not exists (select 1 from lv)
     group by 1
    order by cnt desc
    limit greatest(1, p_limit)
  ),
  av as (
    select shop_id, count(*) as cnt
      from public.site_events
     where name = 'agence_view' and shop_id is not null and created_at >= p_from and created_at < p_to
     group by 1
  ),
  shop_cand as (
    select shop_id, cnt from av
    union all
    select l.shop_id, count(*) as cnt
      from public.site_events e
      join public.listings l on l.id = e.listing_id
     where e.name = 'listing_view' and l.shop_id is not null and e.created_at >= p_from and e.created_at < p_to
       and not exists (select 1 from av)
     group by 1
    order by cnt desc
    limit greatest(1, p_limit)
  )
  select jsonb_build_object(
    'searches', (select count(*) from s),
    'searchers', (select count(distinct coalesce(user_id::text, visitor_key)) from public.site_events where name = 'search' and created_at >= p_from and created_at < p_to),
    'top_searches', (
      select coalesce(jsonb_agg(jsonb_build_object('q', q, 'n', n, 'avg_results', avg_results, 'zero', zero) order by n desc, q), '[]'::jsonb)
        from (select q, count(*) as n, round(avg(results)) as avg_results, count(*) filter (where results = 0) as zero
                from s where coalesce(q, '') <> '' group by q order by n desc, q limit greatest(1, p_limit)) x
    ),
    'zero_searches', (
      select coalesce(jsonb_agg(jsonb_build_object('q', q, 'n', n) order by n desc, q), '[]'::jsonb)
        from (select q, count(*) as n from s where coalesce(q, '') <> '' and results = 0 group by q order by n desc, q limit greatest(1, p_limit)) x
    ),
    'zero_total', (select count(*) from s where results = 0),
    'understood', jsonb_build_object(
      'yes',     (select count(*) from s where understood),
      'no',      (select count(*) from s where understood = false),
      'unknown', (select count(*) from s where understood is null)
    ),
    'catalogue_views', (select count(*) from public.site_events where name = 'catalogue_view' and created_at >= p_from and created_at < p_to),
    'filters', (
      select coalesce(jsonb_agg(jsonb_build_object('filter', f, 'n', n) order by n desc, f), '[]'::jsonb)
        from (select f, count(*) as n
                from public.site_events e,
                     jsonb_array_elements_text(case when jsonb_typeof(e.params->'filters') = 'array' then e.params->'filters' else '[]'::jsonb end) f
               where e.name = 'catalogue_view' and e.created_at >= p_from and e.created_at < p_to
               group by f) x
    ),
    'sorts', (
      select coalesce(jsonb_agg(jsonb_build_object('sort', srt, 'n', n) order by n desc, srt), '[]'::jsonb)
        from (select params->>'sort' as srt, count(*) as n from public.site_events
               where name = 'catalogue_view' and created_at >= p_from and created_at < p_to and coalesce(params->>'sort', '') <> ''
               group by 1) x
    ),
    'top_listings', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', l.id, 'title', l.title, 'reference', l.reference, 'status', l.status::text, 'deal', l.deal_type,
               'governorate', l.governorate, 'price', l.price, 'shop_id', l.shop_id,
               'views', c.cnt,
               'unique_viewers', (select count(*) from public.listing_views v where v.listing_id = l.id and v.last_seen_at >= p_from and v.last_seen_at < p_to),
               'reveals',   (select count(*) from public.contact_reveals r where r.listing_id = l.id and r.created_at >= p_from and r.created_at < p_to),
               'favourites',(select count(*) from public.watchlist w where w.listing_id = l.id and w.created_at >= p_from and w.created_at < p_to),
               'visits',    (select count(*) from public.visit_requests v where v.listing_id = l.id and v.created_at >= p_from and v.created_at < p_to)
             ) order by c.cnt desc, l.title), '[]'::jsonb)
        from cand c
        join public.listings l on l.id = c.listing_id
    ),
    'top_agences', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', sh.id, 'name', sh.name, 'slug', sh.slug, 'kind', sh.kind, 'governorate', sh.governorate, 'status', sh.status,
               'views', c.cnt,
               'contacts', (select count(*) from public.site_events e where e.name = 'agence_contact' and e.shop_id = sh.id and e.created_at >= p_from and e.created_at < p_to),
               'listings_online', (select count(*) from public.listings l where l.shop_id = sh.id and l.status = 'published'),
               'listing_views', (select count(*) from public.site_events e join public.listings l on l.id = e.listing_id
                                  where e.name = 'listing_view' and l.shop_id = sh.id and e.created_at >= p_from and e.created_at < p_to),
               'reveals', (select count(*) from public.contact_reveals r join public.listings l on l.id = r.listing_id
                            where l.shop_id = sh.id and r.created_at >= p_from and r.created_at < p_to),
               'visits', (select count(*) from public.visit_requests v where v.shop_id = sh.id and v.created_at >= p_from and v.created_at < p_to)
             ) order by c.cnt desc, sh.name), '[]'::jsonb)
        from shop_cand c
        join public.shops sh on sh.id = c.shop_id
    ),
    'visits', (
      select jsonb_build_object(
               'total',     count(*),
               'waiting',   count(*) filter (where status = 'requested'),
               'confirmed', count(*) filter (where status = 'confirmed'),
               'declined',  count(*) filter (where status = 'declined'),
               'cancelled', count(*) filter (where status = 'cancelled'),
               'done',      count(*) filter (where status = 'done'),
               'answered',  count(*) filter (where decided_at is not null),
               'fast',      count(*) filter (where decided_at is not null and decided_at - created_at <= make_interval(hours => greatest(1, p_fast_hours))),
               'late',      count(*) filter (where status = 'requested' and now() - created_at > make_interval(hours => greatest(1, p_fast_hours))),
               'avg_answer_hours',    round((avg(extract(epoch from (decided_at - created_at)) / 3600))::numeric, 1),
               'median_answer_hours', round((percentile_cont(0.5) within group (order by extract(epoch from (decided_at - created_at)) / 3600) filter (where decided_at is not null))::numeric, 1)
             )
        from public.visit_requests
       where created_at >= p_from and created_at < p_to
    ),
    'visits_by_agence', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', id, 'name', name, 'slug', slug, 'total', total, 'answered', answered, 'fast', fast, 'late', late, 'avg_hours', avg_hours
             ) order by total desc, name), '[]'::jsonb)
        from (
          select sh.id, sh.name, sh.slug,
                 count(*) as total,
                 count(*) filter (where v.decided_at is not null) as answered,
                 count(*) filter (where v.decided_at is not null and v.decided_at - v.created_at <= make_interval(hours => greatest(1, p_fast_hours))) as fast,
                 count(*) filter (where v.status = 'requested' and now() - v.created_at > make_interval(hours => greatest(1, p_fast_hours))) as late,
                 round((avg(extract(epoch from (v.decided_at - v.created_at)) / 3600))::numeric, 1) as avg_hours
            from public.visit_requests v
            join public.shops sh on sh.id = v.shop_id
           where v.created_at >= p_from and v.created_at < p_to and v.status <> 'cancelled'
           group by sh.id, sh.name, sh.slug
           order by total desc, sh.name
           limit greatest(1, p_limit)
        ) x
    ),
    'favourites', (select count(*) from public.watchlist where created_at >= p_from and created_at < p_to),
    'compare', jsonb_build_object(
      'adds',  (select count(*) from public.site_events where name = 'compare_add' and created_at >= p_from and created_at < p_to),
      'users', (select count(distinct coalesce(user_id::text, visitor_key)) from public.site_events where name = 'compare_add' and created_at >= p_from and created_at < p_to),
      'opens', (select count(*) from public.site_events where name = 'compare_open' and created_at >= p_from and created_at < p_to)
    ),
    'demandes', (select count(*) from public.property_requests where created_at >= p_from and created_at < p_to),
    'matches',  (select count(*) from public.matches where created_at >= p_from and created_at < p_to),
    'shares',   (select count(*) from public.site_events where name = 'share' and created_at >= p_from and created_at < p_to),
    'credit_simulator', jsonb_build_object(
      'opens', (select count(*) from public.site_events where name = 'credit_simulator_open' and created_at >= p_from and created_at < p_to),
      'uses',  (select count(*) from public.site_events where name = 'credit_simulator_use' and created_at >= p_from and created_at < p_to)
    )
  );
$$;

-- Like check_rate_limit (0196), with p_n hits at once: refused when the
-- window already holds more than p_max - p_n, else p_n rows are written.
create or replace function public.check_rate_limit_n(
  p_key         text,
  p_max         int,
  p_window_secs int,
  p_n           int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_n     int := greatest(1, coalesce(p_n, 1));
begin
  perform pg_advisory_xact_lock(hashtext('rate_limit:' || p_key));
  delete from public.rate_limits
   where key = p_key and hit_at < now() - make_interval(secs => greatest(p_window_secs, 1));
  select count(*) into v_count
    from public.rate_limits
   where key = p_key and hit_at >= now() - make_interval(secs => greatest(p_window_secs, 1));
  if v_count + v_n > greatest(p_max, 1) then
    return true;
  end if;
  insert into public.rate_limits (key) select p_key from generate_series(1, v_n);
  return false;
end;
$$;

revoke execute on function public.check_rate_limit_n(text, int, int, int) from public, anon, authenticated;
grant execute on function public.check_rate_limit_n(text, int, int, int) to service_role;

-- The nightly prune forgets Google's reports too: the longest TTL is a day.
create or replace function public.prune_site_events()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days int := greatest(30, public.setting_days('analytics_events_days', 365));
  v_n    int := 0;
begin
  perform set_config('app.events_prune', 'on', true);
  delete from public.site_events where created_at < now() - make_interval(days => v_days);
  get diagnostics v_n = row_count;
  delete from public.analytics_cache where fetched_at < now() - interval '2 days';
  return v_n;
end;
$$;

revoke execute on function public.prune_site_events() from public, anon, authenticated;
grant execute on function public.prune_site_events() to service_role;

do $$
begin
  execute format('revoke execute on function %s from public, anon, authenticated', 'public.analytics_demand(timestamptz, timestamptz, int, int)');
  execute format('grant execute on function %s to service_role', 'public.analytics_demand(timestamptz, timestamptz, int, int)');
end $$;

notify pgrst, 'reload schema';
