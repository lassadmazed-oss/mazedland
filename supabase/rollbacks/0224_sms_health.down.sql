-- Rollback of 0224 · the site stops watching WinSMS. sendSms no longer refuses
-- (the gate reads no row and lets the message through); notices already sent
-- stay in the bell.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'sms_health_http') then
    perform cron.unschedule('sms_health_http');
  end if;
end $$;

drop table if exists public.sms_health;
