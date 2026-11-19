-- Rollback of 0225 · the photo bucket is listable and open to a browser's upload
-- again, and takes any image type, as it did before.

drop policy if exists "properties_public_read" on storage.objects;
create policy "properties_public_read"
on storage.objects for select
using (bucket_id = 'properties');

drop policy if exists "properties_owner_write" on storage.objects;
create policy "properties_owner_write"
on storage.objects for insert
with check (
  bucket_id = 'properties'
  and auth.uid() is not null
  and (storage.foldername(name))[1] = auth.uid()::text
);

update storage.buckets set allowed_mime_types = array['image/*'] where id = 'properties';
update storage.buckets set allowed_mime_types = array['image/*', 'application/pdf'] where id = 'receipts';
