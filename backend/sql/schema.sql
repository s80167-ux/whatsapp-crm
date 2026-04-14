create extension if not exists "pgcrypto";

drop table if exists public.users cascade;

create table if not exists public.whatsapp_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  account_phone text,
  account_jid text,
  display_name text,
  profile_picture_url text,
  auth_dir text,
  connection_state text not null default 'disconnected',
  is_active boolean not null default true,
  last_connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.whatsapp_accounts disable row level security;

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  whatsapp_account_id uuid references public.whatsapp_accounts(id) on delete set null,
  phone text not null,
  chat_jid text,
  wa_message_id text,
  message text not null,
  media_type text,
  media_mime_type text,
  media_file_name text,
  media_data_url text,
  direction text not null check (direction in ('incoming', 'outgoing')),
  send_status text,
  created_at timestamptz not null default now()
);

alter table public.messages disable row level security;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  whatsapp_account_id uuid references public.whatsapp_accounts(id) on delete set null,
  phone text not null,
  chat_jid text,
  contact_name text,
  status text not null default 'new_lead' check (status in ('new_lead', 'interested', 'processing', 'closed_won', 'closed_lost')),
  notes text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.messages add column if not exists chat_jid text;
alter table public.messages add column if not exists wa_message_id text;
alter table public.messages add column if not exists send_status text;
alter table public.messages add column if not exists media_type text;
alter table public.messages add column if not exists media_mime_type text;
alter table public.messages add column if not exists media_file_name text;
alter table public.messages add column if not exists media_data_url text;
alter table public.messages add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;
alter table public.messages add column if not exists whatsapp_account_id uuid references public.whatsapp_accounts(id) on delete set null;
alter table public.customers add column if not exists id uuid default gen_random_uuid();
alter table public.customers add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;
alter table public.customers add column if not exists whatsapp_account_id uuid references public.whatsapp_accounts(id) on delete set null;
alter table public.customers add column if not exists chat_jid text;
alter table public.customers add column if not exists contact_name text;
alter table public.customers alter column status set default 'new_lead';
alter table public.customers drop constraint if exists customers_status_check;
alter table public.customers add constraint customers_status_check
  check (status in ('new_lead', 'interested', 'processing', 'closed_won', 'closed_lost'));

alter table public.customers disable row level security;

create index if not exists messages_phone_created_at_idx
on public.messages (phone, created_at desc);

create index if not exists messages_owner_phone_created_at_idx
on public.messages (owner_user_id, phone, created_at desc);

create index if not exists messages_owner_account_created_at_idx
on public.messages (owner_user_id, whatsapp_account_id, created_at desc);

create unique index if not exists customers_owner_phone_idx
on public.customers (owner_user_id, phone);

create index if not exists customers_owner_account_phone_idx
on public.customers (owner_user_id, whatsapp_account_id, phone);

create index if not exists customers_owner_account_chat_jid_idx
on public.customers (owner_user_id, whatsapp_account_id, chat_jid);

create unique index if not exists whatsapp_accounts_owner_phone_idx
on public.whatsapp_accounts (owner_user_id, account_phone)
where account_phone is not null;

create unique index if not exists whatsapp_accounts_owner_jid_idx
on public.whatsapp_accounts (owner_user_id, account_jid)
where account_jid is not null;

create index if not exists whatsapp_accounts_owner_updated_idx
on public.whatsapp_accounts (owner_user_id, updated_at desc);

create table if not exists public.whatsapp_profiles (
  owner_user_id uuid primary key references auth.users(id) on delete cascade,
  phone text,
  username text,
  profile_picture_url text,
  history_sync_days int not null default 7,
  updated_at timestamptz not null default now()
);

alter table public.whatsapp_profiles disable row level security;

create table if not exists public.active_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  session_id text not null,
  updated_at timestamptz not null default now()
);

alter table public.active_sessions disable row level security;

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
