-- ============================================================================
-- 0220 · A perceptual hash for every annonce photo
--
-- « Is this photo already on Mazed Immo under another annonce? » Prospection's
-- photo check (src/lib/prospection/photoCheck.server.ts) answers it with a
-- 64-bit perceptual hash of each photo (src/lib/photoHash.ts): the same picture
-- — resized, recompressed, a little brighter — has a hash that differs in a few
-- bits only.
--
--   listing_photo_hashes   one row per photo path, its annonce and its hash.
--   similar_photos()       the photos within a few bits of a hash, on other
--                          annonces: the service role asks it, nobody else.
--
-- /api/cron/photo-hashes hashes the photos that have none, a hundred a run,
-- nightly at 04:51 (after the sizes, 0216: it reads the small ones), with the
-- shared secret from the Vault (0158). Without pg_cron or the secret nothing
-- is scheduled, and this says so. The photo check hashes the photos it looks
-- at by itself.
--
-- Rollback: supabase/rollbacks/0220_photo_hashes.down.sql. Idempotent.
-- ============================================================================

create table if not exists public.listing_photo_hashes (
  storage_path text primary key,
  listing_id   uuid not null references public.listings(id) on delete cascade,
  dhash        bit(64) not null,
  created_at   timestamptz not null default now()
);

create index if not exists listing_photo_hashes_listing_idx on public.listing_photo_hashes (listing_id);

alter table public.listing_photo_hashes enable row level security;
revoke all on table public.listing_photo_hashes from anon, authenticated;
grant select, insert, update, delete on table public.listing_photo_hashes to service_role;

create or replace function public.similar_photos(p_hash bit(64), p_max int default 6, p_exclude uuid default null)
returns table (listing_id uuid, storage_path text, distance int)
language sql
stable
security definer
set search_path = public
as $$
  select h.listing_id, h.storage_path, bit_count(h.dhash # p_hash)::int as distance
    from public.listing_photo_hashes h
   where bit_count(h.dhash # p_hash) <= p_max
     and (p_exclude is null or h.listing_id <> p_exclude)
   order by distance, h.storage_path
   limit 10;
$$;

revoke execute on function public.similar_photos(bit, int, uuid) from public, anon, authenticated;
grant execute on function public.similar_photos(bit, int, uuid) to service_role;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice '0220: pg_cron missing — photo_hashes_http not scheduled.';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'photo_hashes_http') then
    perform cron.unschedule('photo_hashes_http');
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'cron_secret') then
    raise notice '0220: vault secret "cron_secret" not found — photo_hashes_http not scheduled. See the prerequisites at the top of 0158.';
    return;
  end if;
  perform cron.schedule('photo_hashes_http', '51 4 * * *',
    $cmd$select net.http_get(
      url := 'https://www.mazed.immo/api/cron/photo-hashes',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      timeout_milliseconds := 300000
    )$cmd$);
end $$;

notify pgrst, 'reload schema';
