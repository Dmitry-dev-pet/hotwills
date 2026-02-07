-- Ensure privileges exist for RLS-protected table access from authenticated clients.
grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.models to authenticated;

-- Keep writes user-scoped, but allow public read of objects in public bucket.
drop policy if exists "model_images_public_read" on storage.objects;
create policy "model_images_public_read"
on storage.objects
for select
to public
using (bucket_id = 'model-images');
