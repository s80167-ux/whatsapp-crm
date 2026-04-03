create extension if not exists "pgcrypto";

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  phone text not null,
  chat_jid text,
  wa_message_id text,
  message text not null,
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
  status text not null default 'warm' check (status in ('hot', 'warm', 'cold')),
  notes text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.messages add column if not exists chat_jid text;
alter table public.messages add column if not exists wa_message_id text;
alter table public.messages add column if not exists send_status text;
alter table public.messages add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;
alter table public.customers add column if not exists id uuid default gen_random_uuid();
alter table public.customers add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;
alter table public.customers add column if not exists chat_jid text;
alter table public.customers add column if not exists contact_name text;

alter table public.customers disable row level security;

create index if not exists messages_phone_created_at_idx
on public.messages (phone, created_at desc);

create index if not exists messages_owner_phone_created_at_idx
on public.messages (owner_user_id, phone, created_at desc);

create unique index if not exists customers_owner_phone_idx
on public.customers (owner_user_id, phone);
