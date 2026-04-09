create table if not exists public.active_sessions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  session_id text not null,
  updated_at timestamptz not null default now()
);

alter table public.active_sessions disable row level security;

create index if not exists active_sessions_updated_at_idx
on public.active_sessions (updated_at desc);