-- ============================================================================
-- 0223 · Prospection: the evening report to the owner
--
-- Every evening the site puts one notice in the bell of each admin who holds
-- the whole console, with what every member of the Prospection team did that
-- day (first messages, yeses, annonces online) and a link to the day's page
-- (/admin/prospection/rapport). It goes from the hour set in Réglages
-- (prospect_report_hour, Tunis time, 21 by default), once a day.
--
-- The job runs at minute 5 of every hour from 17:00 to 22:00 UTC (18:05 to
-- 23:05 in Tunisia): the route does nothing before the chosen hour and nothing
-- once the day's notice has gone, so the hour in Réglages needs no new
-- schedule. Called with the shared secret from the Vault, like the other
-- drains (0158); without the secret nothing is scheduled, and this says so.
--
-- Rollback: supabase/rollbacks/0223_prospection_report.down.sql. Idempotent.
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '0223: pg_cron missing — prospection_report_http not scheduled.';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'prospection_report_http') then
    perform cron.unschedule('prospection_report_http');
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'cron_secret') then
    raise notice '0223: vault secret "cron_secret" not found — prospection_report_http not scheduled. See the prerequisites at the top of 0158.';
    return;
  end if;
  perform cron.schedule('prospection_report_http', '5 17-22 * * *',
    $cmd$select net.http_get(
      url := 'https://www.mazed.immo/api/cron/prospection-report',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      timeout_milliseconds := 60000
    )$cmd$);
end $$;
