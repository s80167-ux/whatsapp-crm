create extension if not exists "pgcrypto";

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
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
alter table public.customers add column if not exists id uuid default gen_random_uuid();
alter table public.customers add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;
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

create unique index if not exists customers_owner_phone_idx
on public.customers (owner_user_id, phone);

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
