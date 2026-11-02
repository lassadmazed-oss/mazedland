-- ============================================================================
-- 0205 · A notification's SMS leaves at once, not on the next five-minute tick.
--
-- The SMS drain (/api/cron/notify-sms) only ran when pg_cron called it, every
-- five minutes (notify_sms_http): « votre annonce est publiée » or « paiement
-- accepté » reached the phone 20 s to 4 min 48 s after the event (measured
-- 2026-10-31), and the owner asked for them « في الحين ».
--
-- Now every INSERT into notifications pings the drain through pg_net, once
-- per statement (an INSERT … SELECT to all admins is one ping), when one of
-- the new rows is for someone who can get an SMS at all: a phone and SMS on,
-- the drain's own test (claim_smsable_notifications). Which kinds go out is
-- still decided by the drain (src/lib/sms-kinds.ts), so a ping for a kind it
-- does not send costs one empty run and sends nothing.
--
-- pg_net sends the request after the inserting transaction commits, so the
-- drain sees the row; overlapping pings claim disjoint rows (FOR UPDATE SKIP
-- LOCKED), so nothing goes twice. notify_sms_http stays every five minutes
-- for the retries and for any ping that was lost. A ping that cannot be
-- queued never fails the insert: the notification still reaches the bell,
-- and its SMS the next tick.
--
-- The bearer token is the Vault's cron_secret (0200), read at run time, as
-- the cron jobs do; without it the trigger does nothing. About 15–230
-- notifications a day (2026-10-26 → 11-01), so at most a few hundred pings.
--
-- Rollback: supabase/rollbacks/0205_sms_at_once.down.sql. Idempotent.
-- ============================================================================

create or replace function public.ping_sms_drain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  if not exists (
    select 1
      from new_rows n
      join public.profiles p on p.id = n.user_id
     where p.phone is not null
       and p.sms_notifications_enabled = true
  ) then
    return null;
  end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_secret is null then
    return null;
  end if;

  perform net.http_get(
    url := 'https://mazedland.vercel.app/api/cron/notify-sms',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 30000
  );
  return null;
exception when others then
  raise warning '0205 ping_sms_drain: %', sqlerrm;
  return null;
end;
$$;

revoke all on function public.ping_sms_drain() from public, anon, authenticated;

drop trigger if exists notifications_ping_sms on public.notifications;
create trigger notifications_ping_sms
  after insert on public.notifications
  referencing new table as new_rows
  for each statement
  execute function public.ping_sms_drain();
