-- Rollback of 0220 · the nightly hashing stops and the hashes go. The photo
-- check of Prospection then finds no duplicates (it still reads each photo).

do $$
begin
  if exists (select 1 from cron.job where jobname = 'photo_hashes_http') then
    perform cron.unschedule('photo_hashes_http');
  end if;
end $$;

drop function if exists public.similar_photos(bit, int, uuid);
drop table if exists public.listing_photo_hashes;

notify pgrst, 'reload schema';
