begin;

alter table public.customer_sales_items
  add column if not exists lead_status text not null default 'new_lead';

alter table public.customer_sales_items
  add column if not exists whatsapp_account_id uuid references public.whatsapp_accounts(id) on delete set null;

alter table public.customer_sales_items
  drop constraint if exists customer_sales_items_lead_status_check;

alter table public.customer_sales_items
  add constraint customer_sales_items_lead_status_check
  check (lead_status in ('new_lead', 'interested', 'processing', 'closed_won', 'closed_lost'));

create index if not exists customer_sales_items_owner_lead_status_idx
on public.customer_sales_items (owner_user_id, lead_status);

create index if not exists customer_sales_items_owner_account_created_at_idx
on public.customer_sales_items (owner_user_id, whatsapp_account_id, created_at desc);

commit;
