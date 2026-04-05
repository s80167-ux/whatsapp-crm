alter table public.customer_sales_items
  add column if not exists message_id uuid references public.messages(id) on delete cascade;

create index if not exists customer_sales_items_owner_message_id_idx
on public.customer_sales_items (owner_user_id, message_id);