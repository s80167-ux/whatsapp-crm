begin;

update public.customers c
set
  phone = public.normalize_whatsapp_phone(c.phone, c.chat_jid),
  updated_at = now()
where public.normalize_whatsapp_phone(c.phone, c.chat_jid) is not null
  and c.phone is distinct from public.normalize_whatsapp_phone(c.phone, c.chat_jid);

delete from public.customers c
where public.normalize_whatsapp_phone(c.phone, c.chat_jid) is null;

drop view if exists public.customer_canonical_profiles;

create view public.customer_canonical_profiles as
with customer_candidates as (
  select
    c.*,
    public.normalize_whatsapp_phone(c.phone, c.chat_jid) as canonical_phone,
    public.normalize_name_source(c.name_source) as normalized_name_source,
    public.contact_name_quality_score(c.contact_name, c.name_source, c.phone) as computed_quality_score,
    case
      when nullif(trim(coalesce(c.contact_name, '')), '') is not null
        and not public.is_generic_contact_name(c.contact_name, c.phone)
      then 1
      else 0
    end as has_real_name
  from public.customers c
  where public.normalize_whatsapp_phone(c.phone, c.chat_jid) is not null
),
ranked_customers as (
  select
    customer_candidates.*,
    row_number() over (
      partition by owner_user_id, canonical_phone
      order by
        has_real_name desc,
        computed_quality_score desc,
        coalesce(is_contact_anchor, false) desc,
        updated_at desc,
        id desc
    ) as row_rank,
    max(coalesce(unread_count, 0)) over (
      partition by owner_user_id, canonical_phone
    ) as merged_unread_count,
    count(*) over (
      partition by owner_user_id, canonical_phone
    ) as alias_count
  from customer_candidates
)
select
  id,
  owner_user_id,
  whatsapp_account_id,
  contact_id,
  canonical_phone as canonical_key,
  canonical_phone as phone,
  chat_jid,
  nullif(trim(coalesce(contact_name, '')), '') as contact_name,
  normalized_name_source as name_source,
  greatest(coalesce(quality_score, 0), computed_quality_score) as quality_score,
  coalesce(is_contact_anchor, false) or greatest(coalesce(quality_score, 0), computed_quality_score) >= 75 as is_contact_anchor,
  status,
  notes,
  profile_picture_url,
  about,
  merged_unread_count as unread_count,
  premise_address,
  business_type,
  age,
  email_address,
  alias_count,
  updated_at
from ranked_customers
where row_rank = 1;

create or replace function public.cleanup_contact_duplicates(p_owner_user_id uuid default null)
returns jsonb
language plpgsql
as $$
declare
  normalized_customers integer := 0;
  normalized_messages integer := 0;
  deleted_invalid_customers integer := 0;
  deleted_duplicate_customers integer := 0;
  deleted_duplicate_messages integer := 0;
begin
  update public.customers c
  set
    phone = public.normalize_whatsapp_phone(c.phone, c.chat_jid),
    updated_at = now()
  where public.normalize_whatsapp_phone(c.phone, c.chat_jid) is not null
    and c.phone is distinct from public.normalize_whatsapp_phone(c.phone, c.chat_jid)
    and (p_owner_user_id is null or c.owner_user_id = p_owner_user_id);

  get diagnostics normalized_customers = row_count;

  delete from public.customers c
  where public.normalize_whatsapp_phone(c.phone, c.chat_jid) is null
    and (p_owner_user_id is null or c.owner_user_id = p_owner_user_id);

  get diagnostics deleted_invalid_customers = row_count;

  update public.messages m
  set phone = public.normalize_whatsapp_phone(m.phone, m.chat_jid)
  where public.normalize_whatsapp_phone(m.phone, m.chat_jid) is not null
    and m.phone is distinct from public.normalize_whatsapp_phone(m.phone, m.chat_jid)
    and (p_owner_user_id is null or m.owner_user_id = p_owner_user_id);

  get diagnostics normalized_messages = row_count;

  with ranked_customers as (
    select
      c.id,
      row_number() over (
        partition by c.owner_user_id, public.normalize_whatsapp_phone(c.phone, c.chat_jid)
        order by
          case
            when nullif(trim(coalesce(c.contact_name, '')), '') is not null
              and not public.is_generic_contact_name(c.contact_name, c.phone)
            then 1
            else 0
          end desc,
          public.contact_name_quality_score(c.contact_name, c.name_source, c.phone) desc,
          coalesce(c.is_contact_anchor, false) desc,
          c.updated_at desc,
          c.id desc
      ) as row_rank
    from public.customers c
    where public.normalize_whatsapp_phone(c.phone, c.chat_jid) is not null
      and (p_owner_user_id is null or c.owner_user_id = p_owner_user_id)
  ),
  duplicate_customers as (
    select id
    from ranked_customers
    where row_rank > 1
  )
  delete from public.customers c
  using duplicate_customers d
  where c.id = d.id;

  get diagnostics deleted_duplicate_customers = row_count;

  with ranked_messages as (
    select
      m.id,
      row_number() over (
        partition by
          m.owner_user_id,
          coalesce(m.whatsapp_account_id, '00000000-0000-0000-0000-000000000000'::uuid),
          coalesce(
            nullif(trim(coalesce(m.wa_message_id, '')), ''),
            public.canonical_contact_key(m.phone, m.chat_jid) || '|' || coalesce(m.direction, '') || '|' || coalesce(m.message, '') || '|' || to_char(date_trunc('second', m.created_at), 'YYYY-MM-DD"T"HH24:MI:SS')
          )
        order by m.created_at asc, m.id asc
      ) as row_rank
    from public.messages m
    where p_owner_user_id is null or m.owner_user_id = p_owner_user_id
  ),
  duplicate_messages as (
    select id
    from ranked_messages
    where row_rank > 1
  )
  delete from public.messages m
  using duplicate_messages d
  where m.id = d.id;

  get diagnostics deleted_duplicate_messages = row_count;

  return jsonb_build_object(
    'success', true,
    'normalizedCustomers', normalized_customers,
    'normalizedMessages', normalized_messages,
    'deletedInvalidCustomers', deleted_invalid_customers,
    'deletedDuplicateCustomers', deleted_duplicate_customers,
    'deletedDuplicateMessages', deleted_duplicate_messages
  );
end;
$$;

commit;
