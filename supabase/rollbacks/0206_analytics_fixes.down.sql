-- Rollback of 0206 · the weighted rate limit goes (only with code that calls
-- check_rate_limit again) and the nightly prune forgets the report cache no
-- more. analytics_demand keeps its guarded cast: strictly safer, nothing to
-- undo.

drop function if exists public.check_rate_limit_n(text, int, int, int);

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

notify pgrst, 'reload schema';
