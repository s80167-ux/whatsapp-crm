create extension if not exists "pgcrypto";

alter table public.messages
  add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;

alter table public.customers
  add column if not exists id uuid default gen_random_uuid();

alter table public.customers
  add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;

update public.customers
set id = gen_random_uuid()
where id is null;

-- Backfill owner_user_id before switching to the isolated backend.
-- If you want to preserve existing data, replace the placeholder below with the intended owner user id.
-- Example:
-- update public.customers set owner_user_id = '00000000-0000-0000-0000-000000000000' where owner_user_id is null;
-- update public.messages set owner_user_id = '00000000-0000-0000-0000-000000000000' where owner_user_id is null;

alter table public.customers drop constraint if exists customers_pkey;
alter table public.customers add primary key (id);

create unique index if not exists customers_owner_phone_idx
on public.customers (owner_user_id, phone);

create index if not exists customers_owner_phone_lookup_idx
on public.customers (owner_user_id, phone);

create index if not exists messages_owner_phone_created_at_idx
on public.messages (owner_user_id, phone, created_at desc);