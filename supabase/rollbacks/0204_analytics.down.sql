-- Rollback of 0204 · the site's own events and the console's statistics.
-- What is lost: every site_events row (the exact counts per annonce and per
-- agence), the cached Google reports, and the nightly prune job. The page
-- /admin/analytics must be gone first (it calls these functions).

do $$
begin
  if exists (select 1 from cron.job where jobname = 'mazed-prune-site-events') then
    perform cron.unschedule('mazed-prune-site-events');
  end if;
end $$;

drop function if exists public.analytics_users(timestamptz, timestamptz);
drop function if exists public.analytics_pro(timestamptz, timestamptz);
drop function if exists public.analytics_demand(timestamptz, timestamptz, int, int);
drop function if exists public.analytics_marketplace(timestamptz, timestamptz, int);
drop function if exists public.analytics_weekly(timestamptz, int);
drop function if exists public.analytics_series(timestamptz, timestamptz);
drop function if exists public.analytics_kpis(timestamptz, timestamptz);
drop function if exists public._tn_day(timestamptz);
drop function if exists public.prune_site_events();

drop table if exists public.analytics_cache;

drop trigger if exists site_events_no_truncate on public.site_events;
drop trigger if exists site_events_append_only on public.site_events;
drop function if exists public._site_events_append_only();
drop table if exists public.site_events;

notify pgrst, 'reload schema';
