create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  last_sign_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles disable row level security;

create unique index if not exists profiles_email_lower_idx
on public.profiles (lower(email))
where email is not null;

create or replace function public.sync_profile_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    email,
    full_name,
    avatar_url,
    last_sign_in_at,
    created_at,
    updated_at
  )
  values (
    new.id,
    nullif(lower(trim(new.email)), ''),
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'name'), '')
    ),
    nullif(trim(new.raw_user_meta_data ->> 'avatar_url'), ''),
    new.last_sign_in_at,
    coalesce(new.created_at, now()),
    now()
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = excluded.full_name,
    avatar_url = excluded.avatar_url,
    last_sign_in_at = excluded.last_sign_in_at,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists sync_profile_from_auth_user on auth.users;

create trigger sync_profile_from_auth_user
after insert or update of email, raw_user_meta_data, last_sign_in_at
on auth.users
for each row
execute function public.sync_profile_from_auth_user();

insert into public.profiles (
  id,
  email,
  full_name,
  avatar_url,
  last_sign_in_at,
  created_at,
  updated_at
)
select
  users.id,
  nullif(lower(trim(users.email)), ''),
  coalesce(
    nullif(trim(users.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(users.raw_user_meta_data ->> 'name'), '')
  ),
  nullif(trim(users.raw_user_meta_data ->> 'avatar_url'), ''),
  users.last_sign_in_at,
  coalesce(users.created_at, now()),
  now()
from auth.users as users
on conflict (id) do update
set
  email = excluded.email,
  full_name = excluded.full_name,
  avatar_url = excluded.avatar_url,
  last_sign_in_at = excluded.last_sign_in_at,
  updated_at = now();
