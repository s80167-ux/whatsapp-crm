begin;

create extension if not exists "pgcrypto";

create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text,
  role text not null
    check (role in ('admin', 'user', 'agent')),
  invite_code text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invited_by uuid references auth.users(id),
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.organization_invitations disable row level security;

drop trigger if exists organization_invitations_set_updated_at on public.organization_invitations;

create trigger organization_invitations_set_updated_at
before update on public.organization_invitations
for each row
execute function public.set_current_timestamp_updated_at();

create index if not exists organization_invitations_org_status_idx
on public.organization_invitations (organization_id, status, created_at desc);

create index if not exists organization_invitations_email_idx
on public.organization_invitations (email);

create index if not exists organization_invitations_invited_by_idx
on public.organization_invitations (invited_by);

commit;
