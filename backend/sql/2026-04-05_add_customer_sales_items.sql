create extension if not exists "pgcrypto";

create table if not exists public.customer_sales_items (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  phone text not null,
  chat_jid text,
  product_type text not null,
  package_name text not null,
  price numeric(12,2) not null default 0 check (price >= 0),
  quantity integer not null default 1 check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customer_sales_items disable row level security;

create index if not exists customer_sales_items_owner_phone_created_at_idx
on public.customer_sales_items (owner_user_id, phone, created_at desc);

create index if not exists customer_sales_items_owner_chat_jid_created_at_idx
on public.customer_sales_items (owner_user_id, chat_jid, created_at desc);

create index if not exists customer_sales_items_owner_message_id_idx
on public.customer_sales_items (owner_user_id, message_id);