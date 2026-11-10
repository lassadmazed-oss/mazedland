-- Rollback of 0216 · the nightly run that makes the missing sizes of the
-- annonce photos stops. The sizes already made stay, and saving an annonce
-- still makes those of its new photos (src/lib/photoSizes.server.ts).

do $$
begin
  if exists (select 1 from cron.job where jobname = 'photo_sizes_http') then
    perform cron.unschedule('photo_sizes_http');
  end if;
end $$;
