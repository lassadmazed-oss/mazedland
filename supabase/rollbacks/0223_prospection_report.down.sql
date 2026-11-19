-- Rollback of 0223 · the evening report of Prospection stops. The notices
-- already sent stay in the bell (the route still answers if called by hand).

do $$
begin
  if exists (select 1 from cron.job where jobname = 'prospection_report_http') then
    perform cron.unschedule('prospection_report_http');
  end if;
end $$;
