-- Allow authenticated users to delete legacy image objects that are still
-- referenced by their own model rows (image_file), even when path is not
-- user-scoped (<uid>/...).

drop policy if exists "model_images_auth_delete" on storage.objects;

create policy "model_images_auth_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'model-images'
  and (
    split_part(name, '/', 1) = (select auth.uid())::text
    or exists (
      select 1
      from public.models m
      where m.image_file = storage.objects.name
        and m.created_by = (select auth.uid())
    )
  )
);
