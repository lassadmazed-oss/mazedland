-- Rollback of 0219 · the daily reminder of Prospection stops. The notices
-- already sent stay in the bell, and the clean-up of old leads no longer runs
-- (the route still answers if called by hand).

do $$
begin
  if exists (select 1 from cron.job where jobname = 'prospection_daily_http') then
    perform cron.unschedule('prospection_daily_http');
  end if;
end $$;

drop index if exists public.prospect_leads_follow_up_idx;
