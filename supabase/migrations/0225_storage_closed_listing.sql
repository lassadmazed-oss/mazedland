-- ============================================================================
-- 0225 · Storage: the photo bucket is no longer listable, takes no upload from a
--        browser, and accepts raster images only
--
-- Security audit, 2026-11-14.
--
-- 1. `properties_public_read` let anyone — the public anon key is in every page —
--    LIST the `properties` bucket: every account's folder (their id), every file
--    of every draft, pending, rejected and taken-down annonce, with the exact
--    paths. A public bucket serves a file by its URL without any policy, so the
--    policy only added the listing. Verified live: POST
--    /storage/v1/object/list/properties with the anon key answered 200.
--
-- 2. `properties_owner_write` let any signed-in account upload straight into its
--    folder, around the server's route (/api/annonces/photo-url): no per-seller
--    ceiling, no suspension check, any file name. Nothing in the app uploads to
--    this bucket from the browser with the account's own session — photos go up
--    through a signed upload URL the server mints with the service role, which
--    needs no policy. (Receipts DO go up from the browser: that bucket's policy
--    stays.)
--
-- 3. `image/*` accepted `image/svg+xml`: a script served from the storage
--    domain. Raster formats only; the receipts bucket keeps its PDF.
--
-- Rollback: supabase/rollbacks/0225_storage_closed_listing.down.sql. Idempotent.
-- ============================================================================

drop policy if exists "properties_public_read" on storage.objects;
drop policy if exists "properties_owner_write" on storage.objects;

update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/heic', 'image/heif']
 where id = 'properties';

update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/heic', 'image/heif', 'application/pdf']
 where id = 'receipts';
