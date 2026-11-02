-- ============================================================================
-- 0204 · Statistiques: the site's own events, the Google report cache, and
--        the aggregations /admin/analytics reads.
--
-- Google Analytics (PR #46) is sampled, waits for the visitor's consent and
-- is a day late; the owner needs exact counts, per annonce and per agence.
-- So every meaningful interaction — a search, an annonce opened, a number
-- shown, a step of the publish form, a favourite — is also written here, by
-- the site itself (src/lib/analytics/events.ts → /api/events, and the server
-- helper for what only it knows).
--
--   site_events      one row per interaction. Append-only: no UPDATE, and a
--                    DELETE only from the retention job. No name, phone,
--                    e-mail or address, no raw IP or browser string: a
--                    visitor is a key that changes every day (or a random id
--                    the visitor who accepted analytics carries), a device
--                    class and a locale.
--   analytics_cache  Google's reports, reused for analytics_ga_cache_minutes.
--   analytics_*()    the page's numbers, aggregated here rather than in Node:
--                    the KPIs of a period, its days, its weeks, the
--                    marketplace, the demand, Pro & revenue, the accounts.
--                    Service role only; the page calls them with the admin
--                    client after requireAdmin('analytics').
--
-- The tables the site already keeps (listing_views, contact_reveals,
-- visit_requests, watchlist, property_requests, payments, invoices,
-- shop_subscriptions, activity_log, admin_audit) are read, not duplicated.
-- Days are Tunisian days (Africa/Tunis).
--
-- Rollback: supabase/rollbacks/0204_analytics.down.sql. Idempotent.
-- ============================================================================

-- ─── 1. site_events ─────────────────────────────────────────────────────────

create table if not exists public.site_events (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  name        text not null check (name ~ '^[a-z][a-z0-9_]{1,39}$'),
  listing_id  uuid,
  shop_id     uuid,
  user_id     uuid,
  -- 'u:<user id>' signed in, 'c:<random id>' a visitor who accepted analytics,
  -- 'a:<daily hash>' anyone else. Never an IP.
  visitor_key text check (visitor_key is null or char_length(visitor_key) between 3 and 64),
  locale      text check (locale is null or locale in ('fr', 'ar')),
  device      text not null default 'unknown' check (device in ('phone', 'tablet', 'desktop', 'unknown')),
  -- The page's path without its query string.
  path        text check (path is null or char_length(path) <= 200),
  params      jsonb not null default '{}'::jsonb
                check (jsonb_typeof(params) = 'object' and octet_length(params::text) <= 4000)
);
comment on table public.site_events is
  'The site''s own analytics events (0204). Append-only; pruned after analytics_events_days. No personal data.';

create index if not exists site_events_created_idx on public.site_events (created_at desc);
create index if not exists site_events_name_idx    on public.site_events (name, created_at desc);
create index if not exists site_events_listing_idx on public.site_events (listing_id, created_at desc) where listing_id is not null;
create index if not exists site_events_shop_idx    on public.site_events (shop_id, created_at desc) where shop_id is not null;
create index if not exists site_events_user_idx    on public.site_events (user_id, created_at desc) where user_id is not null;

alter table public.site_events enable row level security;
revoke all on table public.site_events from anon, authenticated;
grant all on table public.site_events to service_role;

drop policy if exists site_events_admin_read on public.site_events;
create policy site_events_admin_read on public.site_events
  for select to authenticated using (public.admin_can('analytics'));

-- Append-only, the retention job excepted (it sets app.events_prune for its
-- own transaction, the way the audit cleanup does).
create or replace function public._site_events_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'site_events rows are not edited';
  end if;
  if coalesce(current_setting('app.events_prune', true), '') <> 'on' then
    raise exception 'site_events rows are only removed by the retention job';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return null;
end;
$$;

drop trigger if exists site_events_append_only on public.site_events;
create trigger site_events_append_only
  before update or delete on public.site_events
  for each row execute function public._site_events_append_only();

drop trigger if exists site_events_no_truncate on public.site_events;
create trigger site_events_no_truncate
  before truncate on public.site_events
  for each statement execute function public._site_events_append_only();

-- ─── 2. Retention ───────────────────────────────────────────────────────────

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
  return v_n;
end;
$$;

revoke execute on function public.prune_site_events() from public, anon, authenticated;
grant execute on function public.prune_site_events() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'mazed-prune-site-events') then
    perform cron.unschedule('mazed-prune-site-events');
  end if;
  perform cron.schedule('mazed-prune-site-events', '35 3 * * *', 'select public.prune_site_events();');
end $$;

-- ─── 3. The Google report cache ─────────────────────────────────────────────

create table if not exists public.analytics_cache (
  key        text primary key check (char_length(key) between 1 and 200),
  value      jsonb not null,
  fetched_at timestamptz not null default now()
);
alter table public.analytics_cache enable row level security;
revoke all on table public.analytics_cache from anon, authenticated;
grant all on table public.analytics_cache to service_role;

-- ─── 4. Aggregations ────────────────────────────────────────────────────────

-- The owner's day for a moment: midnight in Tunis, not in Greenwich.
create or replace function public._tn_day(p timestamptz)
returns date
language sql
stable
as $$
  select (p at time zone 'Africa/Tunis')::date;
$$;

-- The figures of one period. Snapshot figures (annonces online, agences open)
-- are taken at p_to when it is in the past, so a previous period compares.
create or replace function public.analytics_kpis(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'page_views',     (select count(*) from public.site_events where name = 'page_view' and created_at >= p_from and created_at < p_to),
    'visitors',       (select count(distinct visitor_key) from public.site_events where name = 'page_view' and created_at >= p_from and created_at < p_to and visitor_key is not null),
    'listing_views',  (select count(*) from public.site_events where name = 'listing_view' and created_at >= p_from and created_at < p_to),
    'searches',       (select count(*) from public.site_events where name = 'search' and created_at >= p_from and created_at < p_to),
    'listings_online', case
        when p_to >= now() then (select count(*) from public.listings where status = 'published')
        else (select count(*) from public.listings
               where published_at is not null and published_at < p_to
                 and (expires_at is null or expires_at >= p_to)
                 and taken_down_at is null
                 and status in ('published', 'expired', 'sold', 'rented'))
      end,
    'listings_new',   (select count(*) from public.listings where created_at >= p_from and created_at < p_to),
    'publishes',      (select count(*) from public.listings where published_at >= p_from and published_at < p_to),
    'reveals',        (select count(*) from public.contact_reveals where created_at >= p_from and created_at < p_to),
    'visit_requests', (select count(*) from public.visit_requests where created_at >= p_from and created_at < p_to),
    'favourites',     (select count(*) from public.watchlist where created_at >= p_from and created_at < p_to),
    'demandes',       (select count(*) from public.property_requests where created_at >= p_from and created_at < p_to),
    'signups',        (select count(*) from public.profiles where created_at >= p_from and created_at < p_to),
    'agences_new',    (select count(*) from public.shops where created_at >= p_from and created_at < p_to),
    'agences_open',   (select count(*) from public.shops where status = 'approved' and created_at < p_to),
    'revenue',        (select coalesce(sum(amount), 0) from public.payments
                        where status = 'captured'
                          and coalesce(reviewed_at, updated_at) >= p_from and coalesce(reviewed_at, updated_at) < p_to),
    'paid_count',     (select count(*) from public.payments
                        where status = 'captured'
                          and coalesce(reviewed_at, updated_at) >= p_from and coalesce(reviewed_at, updated_at) < p_to)
  );
$$;

-- The same figures, day by day (Tunisian days), for the charts.
create or replace function public.analytics_series(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with days as (
    select d::date as day
      from generate_series(public._tn_day(p_from), public._tn_day(p_to - interval '1 second'), interval '1 day') d
  ),
  ev as (
    select public._tn_day(created_at) as day,
           count(*) filter (where name = 'page_view')                         as page_views,
           count(distinct visitor_key) filter (where name = 'page_view')      as visitors,
           count(*) filter (where name = 'listing_view')                      as listing_views,
           count(*) filter (where name = 'search')                            as searches
      from public.site_events
     where created_at >= p_from and created_at < p_to
     group by 1
  ),
  ln as (select public._tn_day(created_at) as day, count(*) as n from public.listings where created_at >= p_from and created_at < p_to group by 1),
  pb as (select public._tn_day(published_at) as day, count(*) as n from public.listings where published_at >= p_from and published_at < p_to group by 1),
  rv as (select public._tn_day(created_at) as day, count(*) as n from public.contact_reveals where created_at >= p_from and created_at < p_to group by 1),
  vr as (select public._tn_day(created_at) as day, count(*) as n from public.visit_requests where created_at >= p_from and created_at < p_to group by 1),
  fv as (select public._tn_day(created_at) as day, count(*) as n from public.watchlist where created_at >= p_from and created_at < p_to group by 1),
  su as (select public._tn_day(created_at) as day, count(*) as n from public.profiles where created_at >= p_from and created_at < p_to group by 1),
  pay as (
    select public._tn_day(coalesce(reviewed_at, updated_at)) as day, sum(amount) as n
      from public.payments
     where status = 'captured' and coalesce(reviewed_at, updated_at) >= p_from and coalesce(reviewed_at, updated_at) < p_to
     group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'day',            to_char(d.day, 'YYYY-MM-DD'),
           'page_views',     coalesce(ev.page_views, 0),
           'visitors',       coalesce(ev.visitors, 0),
           'listing_views',  coalesce(ev.listing_views, 0),
           'searches',       coalesce(ev.searches, 0),
           'listings_new',   coalesce(ln.n, 0),
           'publishes',      coalesce(pb.n, 0),
           'reveals',        coalesce(rv.n, 0),
           'visit_requests', coalesce(vr.n, 0),
           'favourites',     coalesce(fv.n, 0),
           'signups',        coalesce(su.n, 0),
           'revenue',        coalesce(pay.n, 0)
         ) order by d.day), '[]'::jsonb)
    from days d
    left join ev  on ev.day  = d.day
    left join ln  on ln.day  = d.day
    left join pb  on pb.day  = d.day
    left join rv  on rv.day  = d.day
    left join vr  on vr.day  = d.day
    left join fv  on fv.day  = d.day
    left join su  on su.day  = d.day
    left join pay on pay.day = d.day;
$$;

-- The last p_weeks blocks of seven days ending at p_to, oldest first: the
-- baseline the insights compare the latest week with.
create or replace function public.analytics_weekly(p_to timestamptz, p_weeks int default 9)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(
           public.analytics_kpis(p_to - (i + 1) * interval '7 days', p_to - i * interval '7 days')
           || jsonb_build_object('from', p_to - (i + 1) * interval '7 days', 'to', p_to - i * interval '7 days')
           order by i desc), '[]'::jsonb)
    from generate_series(0, greatest(1, least(p_weeks, 26)) - 1) i;
$$;

-- The marketplace: what is online, where, at what price, how it got there.
create or replace function public.analytics_marketplace(p_from timestamptz, p_to timestamptz, p_expiring_days int default 7)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
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
$$;

-- The demand: what people search, open, ask for — and how fast agences answer.
create or replace function public.analytics_demand(p_from timestamptz, p_to timestamptz, p_limit int default 10, p_fast_hours int default 24)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with s as (
    select lower(btrim(params->>'q')) as q,
           nullif(params->>'results', '')::int as results,
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

-- Pro & revenue: the agences by plan, the money in, the documents, the offers.
create or replace function public.analytics_pro(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'by_plan', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'slug', p.slug, 'name_fr', p.name_fr, 'name_ar', p.name_ar, 'price', p.price, 'duration_days', p.duration_days,
               'quota', p.listing_quota, 'agences', x.n, 'offered', x.offered
             ) order by p.sort_order, p.price), '[]'::jsonb)
        from public.products p
        join lateral (
          select count(distinct s.shop_id) as n,
                 count(distinct s.shop_id) filter (where s.payment_id is null) as offered
            from public.shop_subscriptions s
           where s.product_id = p.id and s.status = 'active' and s.starts_at <= now() and s.ends_at > now()
        ) x on true
       where p.kind = 'subscription'
    ),
    'no_plan', (
      select count(*) from public.shops s
       where s.status = 'approved'
         and not exists (select 1 from public.shop_subscriptions b
                          where b.shop_id = s.id and b.status = 'active' and b.starts_at <= now() and b.ends_at > now())
    ),
    'agences', jsonb_build_object(
      'approved',  (select count(*) from public.shops where status = 'approved'),
      'pending',   (select count(*) from public.shops where status = 'pending'),
      'suspended', (select count(*) from public.shops where status = 'suspended'),
      'rejected',  (select count(*) from public.shops where status = 'rejected'),
      'verified',  (select count(*) from public.shops where verified_at is not null and status = 'approved'),
      'new',       (select count(*) from public.shops where created_at >= p_from and created_at < p_to),
      'by_kind',   (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (select kind, count(*) as n from public.shops where status = 'approved' group by 1) k)
    ),
    'mrr', (
      select coalesce(round(sum(p.price * 30.0 / greatest(coalesce(p.duration_days, 30), 1))::numeric, 0), 0)
        from public.shop_subscriptions s
        join public.products p on p.id = s.product_id
       where s.status = 'active' and s.starts_at <= now() and s.ends_at > now() and s.payment_id is not null
    ),
    'mrr_offered', (
      select coalesce(round(sum(p.price * 30.0 / greatest(coalesce(p.duration_days, 30), 1))::numeric, 0), 0)
        from public.shop_subscriptions s
        join public.products p on p.id = s.product_id
       where s.status = 'active' and s.starts_at <= now() and s.ends_at > now() and s.payment_id is null
    ),
    'ending_soon', (
      select count(distinct s.shop_id) from public.shop_subscriptions s
       where s.status = 'active' and s.ends_at > now() and s.ends_at < now() + interval '14 days'
         and not exists (select 1 from public.shop_subscriptions n where n.shop_id = s.shop_id and n.status = 'active' and n.starts_at >= s.ends_at)
    ),
    'payments', (
      select coalesce(jsonb_agg(jsonb_build_object('status', status, 'n', n, 'amount', amount) order by status), '[]'::jsonb)
        from (
          select status::text as status, count(*) as n, coalesce(sum(amount), 0) as amount
            from public.payments
           where kind in ('listing_fee', 'listing_pack', 'subscription', 'promo', 'badge', 'renewal')
             and ((status in ('pending', 'pending_review', 'failed', 'authorized') and created_at >= p_from and created_at < p_to)
               or (status in ('captured', 'refunded') and coalesce(reviewed_at, updated_at) >= p_from and coalesce(reviewed_at, updated_at) < p_to))
           group by 1
        ) x
    ),
    'pending_now', (
      select jsonb_build_object('n', count(*), 'amount', coalesce(sum(amount), 0))
        from public.payments
       where status = 'pending_review' and kind in ('listing_fee', 'listing_pack', 'subscription', 'promo', 'badge', 'renewal')
    ),
    'revenue_by_kind', (
      select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'n', n, 'amount', amount) order by amount desc), '[]'::jsonb)
        from (select kind::text as kind, count(*) as n, sum(amount) as amount
                from public.payments
               where status = 'captured' and coalesce(reviewed_at, updated_at) >= p_from and coalesce(reviewed_at, updated_at) < p_to
               group by 1) x
    ),
    'revenue_by_provider', (
      select coalesce(jsonb_agg(jsonb_build_object('provider', provider, 'n', n, 'amount', amount) order by amount desc), '[]'::jsonb)
        from (select provider::text as provider, count(*) as n, sum(amount) as amount
                from public.payments
               where status = 'captured' and coalesce(reviewed_at, updated_at) >= p_from and coalesce(reviewed_at, updated_at) < p_to
               group by 1) x
    ),
    'invoices', (
      select jsonb_build_object(
               'invoices',            count(*) filter (where doc_type in ('invoice', 'receipt')),
               'invoices_amount',     coalesce(sum(amount_ttc) filter (where doc_type in ('invoice', 'receipt')), 0),
               'credit_notes',        count(*) filter (where doc_type = 'credit_note'),
               'credit_notes_amount', coalesce(sum(amount_ttc) filter (where doc_type = 'credit_note'), 0)
             )
        from public.invoices
       where issued_at >= p_from and issued_at < p_to
    ),
    'plan_changes', (
      select coalesce(jsonb_agg(jsonb_build_object('slug', p.slug, 'name_fr', p.name_fr, 'name_ar', p.name_ar, 'paid', x.paid, 'offered', x.offered) order by p.sort_order), '[]'::jsonb)
        from public.products p
        join lateral (
          select count(*) filter (where s.payment_id is not null) as paid,
                 count(*) filter (where s.payment_id is null) as offered
            from public.shop_subscriptions s
           where s.product_id = p.id and s.created_at >= p_from and s.created_at < p_to
        ) x on true
       where p.kind = 'subscription' and (x.paid > 0 or x.offered > 0)
    ),
    'offers', (select count(*) from public.shop_subscriptions where payment_id is null and granted_by is not null and created_at >= p_from and created_at < p_to),
    'imports', (
      select jsonb_build_object('files', count(*), 'rows', coalesce(sum(nullif(metadata->>'count', '')::int), 0))
        from public.activity_log
       where type = 'action' and action = 'shop.import' and created_at >= p_from and created_at < p_to
    ),
    'social', (
      select coalesce(jsonb_agg(jsonb_build_object('status', status, 'n', n) order by status), '[]'::jsonb)
        from (select status, count(*) as n from public.social_publication_requests where created_at >= p_from and created_at < p_to group by 1) x
    ),
    'social_revenue', (select coalesce(sum(price_tnd), 0) from public.social_publication_requests where created_at >= p_from and created_at < p_to and status = 'published'),
    'ai', (
      select jsonb_build_object('calls', count(*), 'failed', count(*) filter (where not ok), 'cost_usd', coalesce(round(sum(cost_usd)::numeric, 2), 0))
        from public.ai_calls where created_at >= p_from and created_at < p_to
    )
  );
$$;

-- The accounts: who signs up, from where, and whether they come back.
create or replace function public.analytics_users(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with activity as (
    select user_id, created_at from public.activity_log
     where type = 'page_view' and user_id is not null and created_at >= p_to - interval '70 days' and created_at < p_to
    union all
    select user_id, created_at from public.site_events
     where user_id is not null and created_at >= p_to - interval '70 days' and created_at < p_to
  ),
  cohorts as (
    select i, p_to - (i + 1) * interval '7 days' as c_from, p_to - i * interval '7 days' as c_to
      from generate_series(0, 7) i
  ),
  per_user as (
    select u.id, u.created_at,
           exists (select 1 from activity a where a.user_id = u.id
                     and a.created_at >= u.created_at + interval '7 days' and a.created_at < u.created_at + interval '14 days') as w1,
           exists (select 1 from activity a where a.user_id = u.id
                     and a.created_at >= u.created_at + interval '28 days' and a.created_at < u.created_at + interval '35 days') as w4
      from public.profiles u
     where u.created_at >= p_to - interval '56 days' and u.created_at < p_to
  )
  select jsonb_build_object(
    'signups', (select count(*) from public.profiles where created_at >= p_from and created_at < p_to),
    'signups_by_day', (
      select coalesce(jsonb_agg(jsonb_build_object('day', to_char(day, 'YYYY-MM-DD'), 'fr', fr, 'ar', ar, 'other', other) order by day), '[]'::jsonb)
        from (select public._tn_day(created_at) as day,
                     count(*) filter (where language = 'fr') as fr,
                     count(*) filter (where language = 'ar') as ar,
                     count(*) filter (where language not in ('fr', 'ar')) as other
                from public.profiles where created_at >= p_from and created_at < p_to group by 1) x
    ),
    'by_locale', (
      select coalesce(jsonb_object_agg(language, n), '{}'::jsonb)
        from (select language, count(*) as n from public.profiles where created_at >= p_from and created_at < p_to group by 1) x
    ),
    'by_role', (
      select coalesce(jsonb_object_agg(role, n), '{}'::jsonb)
        from (select role::text as role, count(*) as n from public.profiles where created_at >= p_from and created_at < p_to group by 1) x
    ),
    'by_device', (
      select coalesce(jsonb_object_agg(device, n), '{}'::jsonb)
        from (select device, count(*) as n from public.site_events where name = 'sign_up' and created_at >= p_from and created_at < p_to group by 1) x
    ),
    'logins', (select count(*) from public.site_events where name = 'login' and created_at >= p_from and created_at < p_to),
    'active', jsonb_build_object(
      'period', (select count(distinct user_id) from activity where created_at >= p_from and created_at < p_to),
      'd7',     (select count(distinct user_id) from activity where created_at >= p_to - interval '7 days' and created_at < p_to),
      'd30',    (select count(distinct user_id) from activity where created_at >= p_to - interval '30 days' and created_at < p_to)
    ),
    'accounts_total', (select count(*) from public.profiles where deleted_at is null),
    'deleted', (select count(*) from public.profiles where deleted_at >= p_from and deleted_at < p_to),
    'cohorts', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'from', to_char(public._tn_day(x.c_from), 'YYYY-MM-DD'), 'to', to_char(public._tn_day(x.c_to - interval '1 second'), 'YYYY-MM-DD'),
               'size', x.size, 'w1', x.w1, 'w4', x.w4
             ) order by x.i desc), '[]'::jsonb)
        from (
          select c.i, c.c_from, c.c_to,
                 count(pu.id) as size,
                 case when c.c_to + interval '14 days' <= now() then count(*) filter (where pu.w1) else null end as w1,
                 case when c.c_to + interval '35 days' <= now() then count(*) filter (where pu.w4) else null end as w4
            from cohorts c
            left join per_user pu on pu.created_at >= c.c_from and pu.created_at < c.c_to
           group by c.i, c.c_from, c.c_to
        ) x
    ),
    'consent', jsonb_build_object(
      'granted', (select count(*) from public.site_events where name = 'consent' and params->>'answer' = 'granted' and created_at >= p_from and created_at < p_to),
      'denied',  (select count(*) from public.site_events where name = 'consent' and params->>'answer' = 'denied' and created_at >= p_from and created_at < p_to)
    ),
    'install', jsonb_build_object(
      'shown', (select count(*) from public.site_events where name = 'install_shown' and created_at >= p_from and created_at < p_to),
      'click', (select count(*) from public.site_events where name = 'install_click' and created_at >= p_from and created_at < p_to),
      'done',  (select count(*) from public.site_events where name = 'install_done' and created_at >= p_from and created_at < p_to)
    ),
    'language_switches', (select count(*) from public.site_events where name = 'language_switch' and created_at >= p_from and created_at < p_to),
    'errors', jsonb_build_object(
      'not_found', (select count(*) from public.site_events where name = 'not_found' and created_at >= p_from and created_at < p_to),
      'client',    (select count(*) from public.activity_log where type = 'error' and created_at >= p_from and created_at < p_to),
      'uploads',   (select count(*) from public.site_events where name = 'upload_failed' and created_at >= p_from and created_at < p_to)
    ),
    'by_locale_events', (
      select coalesce(jsonb_object_agg(locale, n), '{}'::jsonb)
        from (select coalesce(locale, 'unknown') as locale, count(*) as n from public.site_events
               where name = 'page_view' and created_at >= p_from and created_at < p_to group by 1) x
    ),
    'by_device_events', (
      select coalesce(jsonb_object_agg(device, n), '{}'::jsonb)
        from (select device, count(*) as n from public.site_events
               where name = 'page_view' and created_at >= p_from and created_at < p_to group by 1) x
    )
  );
$$;

-- Service role only: the page calls them after requireAdmin('analytics').
do $$
declare
  f text;
begin
  foreach f in array array[
    'public._tn_day(timestamptz)',
    'public.analytics_kpis(timestamptz, timestamptz)',
    'public.analytics_series(timestamptz, timestamptz)',
    'public.analytics_weekly(timestamptz, int)',
    'public.analytics_marketplace(timestamptz, timestamptz, int)',
    'public.analytics_demand(timestamptz, timestamptz, int, int)',
    'public.analytics_pro(timestamptz, timestamptz)',
    'public.analytics_users(timestamptz, timestamptz)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
