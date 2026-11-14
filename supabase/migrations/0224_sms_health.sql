-- ============================================================================
-- 0224 · SMS health: the site knows when WinSMS is not delivering
--
-- On 2026-11-14 WinSMS answered « Successfully Send » to every message while its
-- own worker failed (« Fatal error … Connection refused »): the site marked as
-- sent SMS that never left — three owners' « your annonce is online », seller
-- notices, OTP codes. WinSMS has no per-message status call; its outbox
-- (get-inbox) is the only place the truth shows.
--
-- /api/cron/sms-health reads that outbox every ten minutes (when something was
-- sent, while the provider is down, and at least once an hour) and keeps the
-- verdict here: one row. While it says « down », sendSms refuses at once
-- (nothing is billed, nothing is marked sent), the notification drain does not
-- claim its rows, and the one-time-code route says the service is unavailable.
-- When WinSMS answers again, what failed in the meantime is sent again.
--
-- Service role only: RLS on, no policy.
--
-- Rollback: supabase/rollbacks/0224_sms_health.down.sql. Idempotent.
-- ============================================================================

create table if not exists public.sms_health (
  id              boolean primary key default true check (id),
  state           text not null default 'ok' check (state in ('ok', 'down')),
  since           timestamptz not null default now(),
  checked_at      timestamptz not null default now(),
  last_probe_at   timestamptz,
  -- The newest WinSMS outbox id whose failure was already looked into (re-sent or matched to nothing).
  last_requeue_id bigint not null default 0,
  note            text
);
alter table public.sms_health enable row level security;
revoke all on public.sms_health from anon, authenticated;

-- Last checked « a day ago »: the first run looks at the outbox whether or not anything was sent since.
insert into public.sms_health (id, checked_at) values (true, now() - interval '1 day') on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '0224: pg_cron missing — sms_health_http not scheduled.';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'sms_health_http') then
    perform cron.unschedule('sms_health_http');
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'cron_secret') then
    raise notice '0224: vault secret "cron_secret" not found — sms_health_http not scheduled. See the prerequisites at the top of 0158.';
    return;
  end if;
  perform cron.schedule('sms_health_http', '*/10 * * * *',
    $cmd$select net.http_get(
      url := 'https://www.mazed.immo/api/cron/sms-health',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      timeout_milliseconds := 60000
    )$cmd$);
end $$;
