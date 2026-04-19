begin;

create extension if not exists "pgcrypto";

create or replace function public.set_current_timestamp_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active'
    check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.organizations disable row level security;

drop trigger if exists organizations_set_updated_at on public.organizations;

create trigger organizations_set_updated_at
before update on public.organizations
for each row
execute function public.set_current_timestamp_updated_at();

alter table public.profiles
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists role text not null default 'user'
    check (role in ('super_admin', 'admin', 'user', 'agent'));

alter table public.customers
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists assigned_to uuid references auth.users(id);

alter table public.messages
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists assigned_to uuid references auth.users(id);

alter table public.whatsapp_accounts
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists created_by uuid references auth.users(id);

alter table public.customer_sales_items
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists created_by uuid references auth.users(id),
  add column if not exists assigned_to uuid references auth.users(id);

alter table public.whatsapp_profiles
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists created_by uuid references auth.users(id);

alter table public.active_sessions
  add column if not exists organization_id uuid references public.organizations(id),
  add column if not exists created_by uuid references auth.users(id);

insert into public.organizations (name)
select 'Default Organization'
where not exists (
  select 1
  from public.organizations
  where lower(name) = lower('Default Organization')
);

update public.profiles
set
  organization_id = coalesce(
    profiles.organization_id,
    (
      select organizations.id
      from public.organizations
      where lower(organizations.name) = lower('Default Organization')
      order by organizations.created_at asc
      limit 1
    )
  ),
  role = coalesce(nullif(trim(profiles.role), ''), 'user'),
  updated_at = now()
where profiles.organization_id is null
   or profiles.role is null
   or trim(profiles.role) = '';

update public.customers customer_rows
set
  organization_id = coalesce(customer_rows.organization_id, profile_rows.organization_id),
  created_by = coalesce(customer_rows.created_by, customer_rows.owner_user_id),
  assigned_to = coalesce(customer_rows.assigned_to, customer_rows.owner_user_id),
  updated_at = now()
from public.profiles profile_rows
where profile_rows.id = customer_rows.owner_user_id
  and (
    customer_rows.organization_id is null
    or customer_rows.created_by is null
    or customer_rows.assigned_to is null
  );

update public.messages message_rows
set
  organization_id = coalesce(message_rows.organization_id, profile_rows.organization_id),
  created_by = coalesce(message_rows.created_by, message_rows.owner_user_id),
  assigned_to = coalesce(message_rows.assigned_to, message_rows.owner_user_id)
from public.profiles profile_rows
where profile_rows.id = message_rows.owner_user_id
  and (
    message_rows.organization_id is null
    or message_rows.created_by is null
    or message_rows.assigned_to is null
  );

update public.whatsapp_accounts account_rows
set
  organization_id = coalesce(account_rows.organization_id, profile_rows.organization_id),
  created_by = coalesce(account_rows.created_by, account_rows.owner_user_id),
  updated_at = now()
from public.profiles profile_rows
where profile_rows.id = account_rows.owner_user_id
  and (
    account_rows.organization_id is null
    or account_rows.created_by is null
  );

update public.customer_sales_items sales_rows
set
  organization_id = coalesce(sales_rows.organization_id, profile_rows.organization_id),
  created_by = coalesce(sales_rows.created_by, sales_rows.owner_user_id),
  assigned_to = coalesce(sales_rows.assigned_to, sales_rows.owner_user_id),
  updated_at = now()
from public.profiles profile_rows
where profile_rows.id = sales_rows.owner_user_id
  and (
    sales_rows.organization_id is null
    or sales_rows.created_by is null
    or sales_rows.assigned_to is null
  );

update public.whatsapp_profiles settings_rows
set
  organization_id = coalesce(settings_rows.organization_id, profile_rows.organization_id),
  created_by = coalesce(settings_rows.created_by, settings_rows.owner_user_id),
  updated_at = now()
from public.profiles profile_rows
where profile_rows.id = settings_rows.owner_user_id
  and (
    settings_rows.organization_id is null
    or settings_rows.created_by is null
  );

update public.active_sessions session_rows
set
  organization_id = coalesce(session_rows.organization_id, profile_rows.organization_id),
  created_by = coalesce(session_rows.created_by, session_rows.user_id),
  updated_at = now()
from public.profiles profile_rows
where profile_rows.id = session_rows.user_id
  and (
    session_rows.organization_id is null
    or session_rows.created_by is null
  );

create index if not exists profiles_organization_id_idx
on public.profiles (organization_id);

create index if not exists profiles_role_idx
on public.profiles (role);

create index if not exists customers_org_updated_idx
on public.customers (organization_id, updated_at desc);

create index if not exists customers_org_created_by_idx
on public.customers (organization_id, created_by);

create index if not exists customers_org_assigned_to_idx
on public.customers (organization_id, assigned_to);

create index if not exists messages_org_created_at_idx
on public.messages (organization_id, created_at desc);

create index if not exists messages_org_created_by_idx
on public.messages (organization_id, created_by);

create index if not exists messages_org_assigned_to_idx
on public.messages (organization_id, assigned_to);

create index if not exists whatsapp_accounts_org_updated_idx
on public.whatsapp_accounts (organization_id, updated_at desc);

create index if not exists whatsapp_accounts_org_created_by_idx
on public.whatsapp_accounts (organization_id, created_by);

create index if not exists customer_sales_items_org_created_at_idx
on public.customer_sales_items (organization_id, created_at desc);

create index if not exists customer_sales_items_org_created_by_idx
on public.customer_sales_items (organization_id, created_by);

create index if not exists customer_sales_items_org_assigned_to_idx
on public.customer_sales_items (organization_id, assigned_to);

create index if not exists whatsapp_profiles_org_created_by_idx
on public.whatsapp_profiles (organization_id, created_by);

create index if not exists active_sessions_org_created_by_idx
on public.active_sessions (organization_id, created_by);

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
      partition by
        coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
        owner_user_id,
        coalesce(whatsapp_account_id, '00000000-0000-0000-0000-000000000000'::uuid),
        canonical_key
      order by
        has_real_name desc,
        computed_quality_score desc,
        coalesce(is_contact_anchor, false) desc,
        updated_at desc,
        id desc
    ) as row_rank,
    max(coalesce(unread_count, 0)) over (
      partition by
        coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
        owner_user_id,
        coalesce(whatsapp_account_id, '00000000-0000-0000-0000-000000000000'::uuid),
        canonical_key
    ) as merged_unread_count,
    count(*) over (
      partition by
        coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
        owner_user_id,
        coalesce(whatsapp_account_id, '00000000-0000-0000-0000-000000000000'::uuid),
        canonical_key
    ) as alias_count
  from customer_candidates
)
select
  id,
  organization_id,
  created_by,
  assigned_to,
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
    m.organization_id,
    m.created_by,
    m.assigned_to,
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
      partition by
        coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
        owner_user_id,
        coalesce(whatsapp_account_id, '00000000-0000-0000-0000-000000000000'::uuid),
        canonical_key
      order by last_message_at desc, id desc
    ) as row_rank
  from message_candidates
)
select
  organization_id,
  created_by,
  assigned_to,
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
        partition by
          coalesce(c.organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
          c.owner_user_id,
          coalesce(c.whatsapp_account_id, '00000000-0000-0000-0000-000000000000'::uuid),
          public.canonical_contact_key(c.phone, c.chat_jid)
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
          coalesce(m.organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
          m.owner_user_id,
          coalesce(m.whatsapp_account_id, '00000000-0000-0000-0000-000000000000'::uuid),
          coalesce(
            nullif(trim(coalesce(m.wa_message_id, '')), ''),
            public.canonical_contact_key(m.phone, m.chat_jid) || '|' || coalesce(m.direction, '') || '|' || coalesce(m.message, '') || '|' || to_char(date_trunc('second', m.created_at), 'YYYY-MM-DD\"T\"HH24:MI:SS')
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
