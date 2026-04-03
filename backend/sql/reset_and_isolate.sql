begin;

create extension if not exists "pgcrypto";

truncate table public.messages, public.customers;

alter table public.messages
  add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;

alter table public.customers
  add column if not exists id uuid default gen_random_uuid();

alter table public.customers
  add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;

update public.customers
set id = gen_random_uuid()
where id is null;

alter table public.customers drop constraint if exists customers_pkey;
alter table public.customers add primary key (id);

drop index if exists public.customers_owner_phone_idx;
create unique index customers_owner_phone_idx
on public.customers (owner_user_id, phone);

drop index if exists public.customers_owner_phone_lookup_idx;
create index customers_owner_phone_lookup_idx
on public.customers (owner_user_id, phone);

drop index if exists public.messages_owner_phone_created_at_idx;
create index messages_owner_phone_created_at_idx
on public.messages (owner_user_id, phone, created_at desc);

alter table public.messages
  alter column owner_user_id set not null;

alter table public.customers
  alter column owner_user_id set not null;

alter table public.customers
  alter column phone set not null;

commit;