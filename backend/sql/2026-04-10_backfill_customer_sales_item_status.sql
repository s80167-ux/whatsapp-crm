begin;

with sales_item_matches as (
  select
    item.id as sales_item_id,
    coalesce(chat_customer.status, phone_customer.status, 'new_lead') as inferred_status,
    row_number() over (
      partition by item.id
      order by
        case when chat_customer.id is not null then 0 else 1 end,
        coalesce(chat_customer.updated_at, phone_customer.updated_at) desc,
        coalesce(chat_customer.id, phone_customer.id) desc
    ) as match_rank
  from public.customer_sales_items item
  left join public.customers chat_customer
    on chat_customer.owner_user_id = item.owner_user_id
   and item.chat_jid is not null
   and chat_customer.chat_jid = item.chat_jid
  left join public.customers phone_customer
    on phone_customer.owner_user_id = item.owner_user_id
   and phone_customer.phone = item.phone
),
best_matches as (
  select sales_item_id, inferred_status
  from sales_item_matches
  where match_rank = 1
)
update public.customer_sales_items item
set lead_status = best_match.inferred_status
from best_matches best_match
where item.id = best_match.sales_item_id;

commit;