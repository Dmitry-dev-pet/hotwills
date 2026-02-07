-- Extensions
create extension if not exists pgcrypto;

-- Main table
create table if not exists public.models (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  year text not null,
  code text not null,
  image_file text not null,
  source_link text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint models_image_file_not_blank check (char_length(trim(image_file)) > 0)
);

-- Helpful uniqueness for imported source
create unique index if not exists models_image_file_uidx on public.models (image_file);

-- Query indexes (Supabase/Postgres best practice)
create index if not exists models_code_idx on public.models (code);
create index if not exists models_year_idx on public.models (year);
create index if not exists models_created_by_idx on public.models (created_by);
create index if not exists models_name_lower_idx on public.models (lower(name));

-- updated_at trigger
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_models_updated_at on public.models;
create trigger trg_models_updated_at
before update on public.models
for each row execute function public.set_updated_at();

-- RLS
alter table public.models enable row level security;

-- Required grants for API roles (RLS still governs row access)
grant usage on schema public to anon;
grant select on table public.models to anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.models to authenticated;

drop policy if exists "models_select_public" on public.models;
drop policy if exists "models_select_authenticated" on public.models;
drop policy if exists "models_insert_authenticated" on public.models;
drop policy if exists "models_update_authenticated" on public.models;
drop policy if exists "models_delete_authenticated" on public.models;

-- Public read (anon + authenticated) for catalog viewing.
-- Writes are still user-scoped and authenticated-only.
create policy "models_select_public"
on public.models
for select
to public
using (true);

-- Insert only as self
create policy "models_insert_authenticated"
on public.models
for insert
to authenticated
with check ((select auth.uid()) = created_by);

-- Collaborative editing for signed-in users
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

-- Realtime support
alter table public.models replica identity full;
do $$
begin
  alter publication supabase_realtime add table public.models;
exception
  when duplicate_object then null;
end $$;

-- Storage bucket for images
insert into storage.buckets (id, name, public)
values ('model-images', 'model-images', true)
on conflict (id) do nothing;

-- Storage policies
drop policy if exists "model_images_public_read" on storage.objects;
drop policy if exists "model_images_auth_insert" on storage.objects;
drop policy if exists "model_images_auth_update" on storage.objects;
drop policy if exists "model_images_auth_delete" on storage.objects;

create policy "model_images_public_read"
on storage.objects
for select
to public
using (bucket_id = 'model-images');

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
