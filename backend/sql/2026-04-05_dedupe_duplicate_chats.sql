begin;

with ranked_customers as (
  select
    id,
    owner_user_id,
    phone,
    chat_jid,
    contact_name,
    status,
    notes,
    profile_picture_url,
    about,
    unread_count,
    updated_at,
    row_number() over (
      partition by owner_user_id, chat_jid
      order by
        case
          when chat_jid like '%@lid' and split_part(chat_jid, '@', 1) = phone then 1
          else 0
        end,
        updated_at desc,
        id desc
    ) as row_rank
  from public.customers
  where chat_jid is not null
),
customer_survivors as (
  select *
  from ranked_customers
  where row_rank = 1
),
customer_duplicates as (
  select *
  from ranked_customers
  where row_rank > 1
),
merged_customer_values as (
  select
    survivor.id,
    coalesce(
      max(nullif(case when duplicate.phone <> split_part(duplicate.chat_jid, '@', 1) then duplicate.phone end, '')),
      nullif(case when survivor.phone <> split_part(survivor.chat_jid, '@', 1) then survivor.phone end, ''),
      survivor.phone
    ) as merged_phone,
    coalesce(max(nullif(duplicate.contact_name, '')), nullif(survivor.contact_name, ''), survivor.contact_name) as merged_contact_name,
    coalesce(max(nullif(duplicate.notes, '')), nullif(survivor.notes, ''), survivor.notes) as merged_notes,
    coalesce(max(duplicate.profile_picture_url), survivor.profile_picture_url) as merged_profile_picture_url,
    coalesce(max(duplicate.about), survivor.about) as merged_about,
    greatest(
      coalesce(survivor.unread_count, 0),
      coalesce(max(duplicate.unread_count), 0)
    ) as merged_unread_count,
    greatest(
      survivor.updated_at,
      coalesce(max(duplicate.updated_at), survivor.updated_at)
    ) as merged_updated_at
  from customer_survivors survivor
  left join customer_duplicates duplicate
    on duplicate.owner_user_id = survivor.owner_user_id
   and duplicate.chat_jid = survivor.chat_jid
  group by
    survivor.id,
    survivor.phone,
    survivor.chat_jid,
    survivor.contact_name,
    survivor.notes,
    survivor.profile_picture_url,
    survivor.about,
    survivor.unread_count,
    survivor.updated_at
),
updated_survivors as (
  update public.customers customer
  set
    phone = merged.merged_phone,
    contact_name = merged.merged_contact_name,
    notes = merged.merged_notes,
    profile_picture_url = merged.merged_profile_picture_url,
    about = merged.merged_about,
    unread_count = merged.merged_unread_count,
    updated_at = merged.merged_updated_at
  from merged_customer_values merged
  where customer.id = merged.id
  returning customer.id
)
delete from public.customers customer
using customer_duplicates duplicate
where customer.id = duplicate.id;

with ranked_messages as (
  select
    id,
    row_number() over (
      partition by owner_user_id, wa_message_id
      order by created_at asc, id asc
    ) as row_rank
  from public.messages
  where wa_message_id is not null
),
message_duplicates as (
  select id
  from ranked_messages
  where row_rank > 1
)
delete from public.messages message
using message_duplicates duplicate
where message.id = duplicate.id;

create unique index if not exists customers_owner_chat_jid_idx
on public.customers (owner_user_id, chat_jid)
where chat_jid is not null;

create unique index if not exists messages_owner_wa_message_id_idx
on public.messages (owner_user_id, wa_message_id)
where wa_message_id is not null;

commit;