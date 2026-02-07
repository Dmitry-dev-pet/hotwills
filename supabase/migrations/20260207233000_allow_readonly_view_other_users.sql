-- Allow authenticated users to view other users' catalogs (read-only).
-- Writes remain owner-scoped by auth.uid().

drop policy if exists "models_select_authenticated" on public.models;
create policy "models_select_authenticated"
on public.models
for select
to authenticated
using (true);
