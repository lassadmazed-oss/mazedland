-- ============================================================================
-- 0216 · The sizes of the annonce photos are made every night too.
--
-- Every annonce photo went through Supabase's resizer (/render/image), which
-- bills each distinct photo it resizes in a month: 100 free, then $5 a
-- thousand — up to $300 a month at 10 000 annonces. The pages now ask for
-- sizes made in advance (src/lib/photoSizes.ts): 384, 640, 1080 and 1600 px,
-- written next to the photo when its annonce is saved.
--
-- /api/cron/photo-sizes makes the ones that save missed, a hundred photos a
-- run. Scheduled after the sweep of abandoned uploads (0197, 04:23), so it
-- never sizes a photo about to go. Called with the shared secret from the
-- Vault, like the other drains (0158). Without the secret nothing is
-- scheduled, and this says so.
--
-- Rollback: supabase/rollbacks/0216_photo_sizes.down.sql (the nightly run
-- stops; the sizes already made stay, and saves still make new ones).
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '0216: pg_cron missing — photo_sizes_http not scheduled.';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'photo_sizes_http') then
    perform cron.unschedule('photo_sizes_http');
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'cron_secret') then
    raise notice '0216: vault secret "cron_secret" not found — photo_sizes_http not scheduled. See the prerequisites at the top of 0158.';
    return;
  end if;
  perform cron.schedule('photo_sizes_http', '41 4 * * *',
    $cmd$select net.http_get(
      url := 'https://www.mazed.immo/api/cron/photo-sizes',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      timeout_milliseconds := 300000
    )$cmd$);
end $$;
