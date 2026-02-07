-- Enforce per-user isolation for models and image objects

-- Models RLS
drop policy if exists "models_select_authenticated" on public.models;
drop policy if exists "models_insert_authenticated" on public.models;
drop policy if exists "models_update_authenticated" on public.models;
drop policy if exists "models_delete_authenticated" on public.models;

create policy "models_select_authenticated"
on public.models
for select
to authenticated
using ((select auth.uid()) = created_by);

create policy "models_insert_authenticated"
on public.models
for insert
to authenticated
with check ((select auth.uid()) = created_by);

create policy "models_update_authenticated"
on public.models
for update
to authenticated
using ((select auth.uid()) = created_by)
with check ((select auth.uid()) = created_by);

create policy "models_delete_authenticated"
on public.models
for delete
to authenticated
using ((select auth.uid()) = created_by);

-- Storage RLS (user can access only objects under "<uid>/..." prefix)
drop policy if exists "model_images_public_read" on storage.objects;
drop policy if exists "model_images_auth_insert" on storage.objects;
drop policy if exists "model_images_auth_update" on storage.objects;
drop policy if exists "model_images_auth_delete" on storage.objects;

create policy "model_images_public_read"
on storage.objects
for select
to public
using (
  bucket_id = 'model-images'
  and split_part(name, '/', 1) = (select auth.uid())::text
);

create policy "model_images_auth_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'model-images'
  and split_part(name, '/', 1) = (select auth.uid())::text
);

create policy "model_images_auth_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'model-images'
  and split_part(name, '/', 1) = (select auth.uid())::text
)
with check (
  bucket_id = 'model-images'
  and split_part(name, '/', 1) = (select auth.uid())::text
);

create policy "model_images_auth_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'model-images'
  and split_part(name, '/', 1) = (select auth.uid())::text
);
