-- Safety migration: explicitly ensure RLS is enabled on user data table.
alter table if exists public.models enable row level security;
