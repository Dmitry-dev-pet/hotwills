-- One-time cleanup: purge catalog and storage objects for a specific owner
-- Requested by project owner.

begin;

delete from storage.objects
where bucket_id = 'model-images'
  and split_part(name, '/', 1) = '74d56612-ce01-45a8-878b-b5d3952eef4c';

delete from public.models
where created_by = '74d56612-ce01-45a8-878b-b5d3952eef4c'::uuid;

commit;
