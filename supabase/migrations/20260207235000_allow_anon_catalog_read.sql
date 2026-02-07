-- Allow anonymous users to view catalogs without authentication.
-- Write operations remain authenticated and owner-scoped.

grant usage on schema public to anon;
grant select on table public.models to anon;

drop policy if exists "models_select_authenticated" on public.models;
drop policy if exists "models_select_public" on public.models;

create policy "models_select_public"
on public.models
for select
to public
using (true);
