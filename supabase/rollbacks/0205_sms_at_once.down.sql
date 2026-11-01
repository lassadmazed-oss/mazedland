-- Rollback of 0205 · notification SMS wait for the five-minute tick again
-- (notify_sms_http, untouched by 0205).

drop trigger if exists notifications_ping_sms on public.notifications;
drop function if exists public.ping_sms_drain();
