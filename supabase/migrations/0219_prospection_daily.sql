-- ============================================================================
-- 0219 · Prospection: the daily reminder and the clean-up of old leads
--
-- Every morning (08:05 in Tunisia) the site puts one notice in the bell of each
-- member of the Prospection team who has something waiting — owners to write
-- to again whose follow-up date has come, « oui » still without photos after
-- a day, annonces online whose SMS never left — and clears the post's text and
-- the poster's name from leads that ended long ago (Réglages →
-- prospect_keep_days). /api/cron/prospection-daily does both.
--
-- Called with the shared secret from the Vault, like the other drains (0158).
-- Without the secret nothing is scheduled, and this says so.
--
-- Rollback: supabase/rollbacks/0219_prospection_daily.down.sql. Idempotent.
-- ============================================================================

-- The follow-ups that have come due, for the board and the reminder.
create index if not exists prospect_leads_follow_up_idx
  on public.prospect_leads (follow_up_at)
  where follow_up_at is not null and status in ('to_contact', 'contacted');

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '0219: pg_cron missing — prospection_daily_http not scheduled.';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'prospection_daily_http') then
    perform cron.unschedule('prospection_daily_http');
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'cron_secret') then
    raise notice '0219: vault secret "cron_secret" not found — prospection_daily_http not scheduled. See the prerequisites at the top of 0158.';
    return;
  end if;
  perform cron.schedule('prospection_daily_http', '5 7 * * *',
    $cmd$select net.http_get(
      url := 'https://www.mazed.immo/api/cron/prospection-daily',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      timeout_milliseconds := 60000
    )$cmd$);
end $$;
