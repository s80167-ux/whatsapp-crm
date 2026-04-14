create extension if not exists "pgcrypto";

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

alter table public.messages
  add column if not exists whatsapp_account_id uuid references public.whatsapp_accounts(id) on delete set null;

alter table public.customers
  add column if not exists whatsapp_account_id uuid references public.whatsapp_accounts(id) on delete set null;

alter table public.customer_sales_items
  add column if not exists whatsapp_account_id uuid references public.whatsapp_accounts(id) on delete set null;

create unique index if not exists whatsapp_accounts_owner_phone_idx
on public.whatsapp_accounts (owner_user_id, account_phone)
where account_phone is not null;

create unique index if not exists whatsapp_accounts_owner_jid_idx
on public.whatsapp_accounts (owner_user_id, account_jid)
where account_jid is not null;

create index if not exists whatsapp_accounts_owner_updated_idx
on public.whatsapp_accounts (owner_user_id, updated_at desc);

create index if not exists messages_owner_account_created_at_idx
on public.messages (owner_user_id, whatsapp_account_id, created_at desc);

create index if not exists customers_owner_account_phone_idx
on public.customers (owner_user_id, whatsapp_account_id, phone);

create index if not exists customers_owner_account_chat_jid_idx
on public.customers (owner_user_id, whatsapp_account_id, chat_jid);

create index if not exists customer_sales_items_owner_account_created_at_idx
on public.customer_sales_items (owner_user_id, whatsapp_account_id, created_at desc);
