-- One-time cleanup of orphan image objects in model-images bucket.
-- Remove only objects that are not referenced by any models.image_file.

delete from storage.objects o
where o.bucket_id = 'model-images'
  and not exists (
    select 1
    from public.models m
    where m.image_file = o.name
  );
