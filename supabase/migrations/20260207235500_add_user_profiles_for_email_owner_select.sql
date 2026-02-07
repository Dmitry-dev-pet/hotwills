-- Add public user profiles so owner catalogs can be selected by email.

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_profiles_email_nonempty check (char_length(trim(email)) > 0)
);

create unique index if not exists user_profiles_email_uidx on public.user_profiles (lower(email));

drop trigger if exists trg_user_profiles_updated_at on public.user_profiles;
create trigger trg_user_profiles_updated_at
before update on public.user_profiles
for each row execute function public.set_updated_at();

alter table public.user_profiles enable row level security;

grant select on table public.user_profiles to anon;
grant select, insert, update on table public.user_profiles to authenticated;

drop policy if exists "user_profiles_select_public" on public.user_profiles;
drop policy if exists "user_profiles_insert_own" on public.user_profiles;
drop policy if exists "user_profiles_update_own" on public.user_profiles;

create policy "user_profiles_select_public"
on public.user_profiles
for select
to public
using (true);

create policy "user_profiles_insert_own"
on public.user_profiles
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "user_profiles_update_own"
on public.user_profiles
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- Backfill known users.
insert into public.user_profiles (user_id, email)
select id, lower(email)
from auth.users
where email is not null and char_length(trim(email)) > 0
on conflict (user_id)
do update set
  email = excluded.email,
  updated_at = now();

-- Keep profile email synced with auth.users email.
create or replace function public.sync_user_profile_from_auth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is not null and char_length(trim(new.email)) > 0 then
    insert into public.user_profiles (user_id, email)
    values (new.id, lower(new.email))
    on conflict (user_id)
    do update set
      email = excluded.email,
      updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_auth_users_sync_profile on auth.users;
create trigger trg_auth_users_sync_profile
after insert or update of email on auth.users
for each row execute function public.sync_user_profile_from_auth();
