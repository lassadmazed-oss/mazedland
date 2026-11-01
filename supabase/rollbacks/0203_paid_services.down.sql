-- Rollback of 0203: the console page loses its table, the watchdog stops.
-- The SMS log goes with it. The Vault secrets winsms_api_key / winsms_sender_id
-- stay (remove them by hand if wanted: delete from vault.secrets where name in (...)).

do $$
begin
  if exists (select 1 from cron.job where jobname = 'mazed-services-watchdog') then
    perform cron.unschedule('mazed-services-watchdog');
  end if;
end $$;

drop function if exists public.services_watchdog();
drop function if exists public._services_setting(text, jsonb);
drop function if exists public.claim_service_alert(uuid, text, text, text, int);
drop table if exists public.services_watch;
drop table if exists public.paid_service_alerts;
drop table if exists public.paid_services;
drop function if exists public._touch_paid_services();
delete from public.cron_heartbeat where job = 'services_watch';

notify pgrst, 'reload schema';
