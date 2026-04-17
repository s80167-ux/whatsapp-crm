begin;

alter table public.customers
  add column if not exists unread_count integer not null default 0,
  add column if not exists name_source text,
  add column if not exists quality_score integer not null default 0,
  add column if not exists is_contact_anchor boolean not null default false,
  add column if not exists profile_picture_url text,
  add column if not exists about text,
  add column if not exists contact_id uuid default gen_random_uuid(),
  add column if not exists premise_address text,
  add column if not exists business_type text,
  add column if not exists age integer,
  add column if not exists email_address text;

alter table public.customers
  alter column contact_id set default gen_random_uuid();

update public.customers
set contact_id = gen_random_uuid()
where contact_id is null;

alter table public.customers
  alter column contact_id set not null;

create unique index if not exists customers_owner_contact_id_idx
on public.customers (owner_user_id, contact_id);

create or replace function public.normalize_name_source(raw_source text)
returns text
language sql
immutable
as $$
  select case lower(trim(coalesce(raw_source, '')))
    when 'manual' then 'manual'
    when 'crm_manual' then 'manual'
    when 'verified_business' then 'verified_business'
    when 'verifiedbizname' then 'verified_business'
    when 'verified_biz_name' then 'verified_business'
    when 'contact' then 'contact'
    when 'wa_contact' then 'contact'
    when 'contact_message' then 'contact'
    when 'profile' then 'profile'
    when 'wa_profile' then 'profile'
    when 'profile_name' then 'profile'
    when 'pushname' then 'push_name'
    when 'push_name' then 'push_name'
    when 'history' then 'history_sync'
    when 'history_sync' then 'history_sync'
    else nullif(lower(trim(coalesce(raw_source, ''))), '')
  end;
$$;

create or replace function public.normalize_whatsapp_phone(raw_phone text, raw_chat_jid text default null)
returns text
language sql
immutable
as $$
  with parsed as (
    select
      nullif(regexp_replace(coalesce(raw_phone, ''), '\D', '', 'g'), '') as phone_digits,
      nullif(regexp_replace(split_part(coalesce(raw_chat_jid, ''), '@', 1), '\D', '', 'g'), '') as jid_digits,
      lower(trim(split_part(coalesce(raw_chat_jid, ''), '@', 2))) as jid_server
  ),
  resolved as (
    select
      case
        when phone_digits is not null then phone_digits
        when jid_server in ('s.whatsapp.net', 'c.us') then jid_digits
        else null
      end as raw_digits
    from parsed
  )
  select case
    when raw_digits is null then null
    when raw_digits like '60%' then raw_digits
    when raw_digits like '6%' then raw_digits
    when raw_digits like '0%' then '6' || raw_digits
    else raw_digits
  end
  from resolved;
$$;

create or replace function public.canonical_contact_key(raw_phone text, raw_chat_jid text default null)
returns text
language sql
immutable
as $$
  select coalesce(
    public.normalize_whatsapp_phone(raw_phone, raw_chat_jid),
    nullif(lower(trim(coalesce(raw_chat_jid, ''))), ''),
    nullif(lower(trim(coalesce(raw_phone, ''))), '')
  );
$$;

create or replace function public.is_generic_contact_name(raw_name text, raw_phone text default null)
returns boolean
language sql
immutable
as $$
  with normalized as (
    select
      nullif(trim(coalesce(raw_name, '')), '') as name_value,
      nullif(regexp_replace(coalesce(raw_phone, ''), '\D', '', 'g'), '') as phone_digits
  )
  select case
    when name_value is null then true
    when lower(name_value) in ('unknown', 'no name', 'whatsapp user', 'contact', 'user', 'null', 'undefined', 'n/a', '-') then true
    when regexp_replace(name_value, '\D', '', 'g') <> ''
      and length(regexp_replace(name_value, '\D', '', 'g')) >= 7
      and (
        regexp_replace(name_value, '\D', '', 'g') = coalesce(phone_digits, '')
        or length(regexp_replace(name_value, '\D', '', 'g')) >= 9
      ) then true
    else false
  end
  from normalized;
$$;

create or replace function public.contact_name_quality_score(raw_name text, raw_source text default null, raw_phone text default null)
returns integer
language sql
immutable
as $$
  with normalized as (
    select
      trim(coalesce(raw_name, '')) as name_value,
      public.normalize_name_source(raw_source) as source_value,
      public.is_generic_contact_name(raw_name, raw_phone) as is_generic
  )
  select case
    when name_value = '' or is_generic then 0
    else least(
      100,
      case source_value
        when 'manual' then 100
        when 'verified_business' then 90
        when 'contact' then 80
        when 'profile' then 75
        when 'history_sync' then 65
        when 'push_name' then 55
        else 45
      end
      + case when array_length(regexp_split_to_array(name_value, '\s+'), 1) >= 2 then 5 else 0 end
      + case when name_value ~ '[A-Z]' and name_value ~ '[a-z]' then 3 else 0 end
    )
  end
  from normalized;
$$;

drop view if exists public.conversation_latest_messages;
drop view if exists public.customer_canonical_profiles;

create view public.customer_canonical_profiles as
with customer_candidates as (
  select
    c.*,
    public.normalize_whatsapp_phone(c.phone, c.chat_jid) as canonical_phone,
    public.canonical_contact_key(c.phone, c.chat_jid) as canonical_key,
    public.normalize_name_source(c.name_source) as normalized_name_source,
    public.contact_name_quality_score(c.contact_name, c.name_source, c.phone) as computed_quality_score,
    case
      when nullif(trim(coalesce(c.contact_name, '')), '') is not null
        and not public.is_generic_contact_name(c.contact_name, c.phone)
      then 1
      else 0
    end as has_real_name
  from public.customers c
  where public.canonical_contact_key(c.phone, c.chat_jid) is not null
),
ranked_customers as (
  select
    customer_candidates.*,
    row_number() over (
      partition by owner_user_id, coalesce(whatsapp_account_id, '00000000-0000-0000-0000-000000000000'::uuid), canonical_key
      order by
        has_real_name desc,
        computed_quality_score desc,
        coalesce(is_contact_anchor, false) desc,
        updated_at desc,
        id desc
    ) as row_rank,
    max(coalesce(unread_count, 0)) over (
      partition by owner_user_id, coalesce(whatsapp_account_id, '00000000-0000-0000-0000-000000000000'::uuid), canonical_key
    ) as merged_unread_count,
    count(*) over (
      partition by owner_user_id, coalesce(whatsapp_account_id, '00000000-0000-0000-0000-000000000000'::uuid), canonical_key
    ) as alias_count
  from customer_candidates
)
select
  id,
  owner_user_id,
  whatsapp_account_id,
  contact_id,
  canonical_key,
  coalesce(canonical_phone, phone) as phone,
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

create view public.conversation_latest_messages as
with message_candidates as (
  select
    m.id,
    m.owner_user_id,
    m.whatsapp_account_id,
    m.chat_jid,
    m.wa_message_id,
    m.message as last_message,
    m.direction as last_direction,
    m.created_at as last_message_at,
    coalesce(public.normalize_whatsapp_phone(m.phone, m.chat_jid), m.phone) as canonical_phone,
    public.canonical_contact_key(m.phone, m.chat_jid) as canonical_key
  from public.messages m
  where public.canonical_contact_key(m.phone, m.chat_jid) is not null
),
ranked_messages as (
  select
    message_candidates.*,
    row_number() over (
      partition by owner_user_id, coalesce(whatsapp_account_id, '00000000-0000-0000-0000-000000000000'::uuid), canonical_key
      order by last_message_at desc, id desc
    ) as row_rank
  from message_candidates
)
select
  owner_user_id,
  whatsapp_account_id,
  canonical_key,
  canonical_phone as phone,
  chat_jid,
  last_message,
  last_message_at,
  last_direction
from ranked_messages
where row_rank = 1;

create or replace function public.cleanup_contact_duplicates(p_owner_user_id uuid default null)
returns jsonb
language plpgsql
as $$
declare
  normalized_customers integer := 0;
  normalized_messages integer := 0;
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
        partition by c.owner_user_id, coalesce(c.whatsapp_account_id, '00000000-0000-0000-0000-000000000000'::uuid), public.canonical_contact_key(c.phone, c.chat_jid)
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
    where public.canonical_contact_key(c.phone, c.chat_jid) is not null
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
    'deletedDuplicateCustomers', deleted_duplicate_customers,
    'deletedDuplicateMessages', deleted_duplicate_messages
  );
end;
$$;

commit;
