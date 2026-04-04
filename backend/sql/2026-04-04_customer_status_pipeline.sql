begin;

update public.customers
set status = case
  when status = 'hot' then 'processing'
  when status = 'warm' then 'interested'
  when status = 'cold' then 'closed_lost'
  else coalesce(status, 'new_lead')
end;

alter table public.customers
  alter column status set default 'new_lead';

alter table public.customers
  drop constraint if exists customers_status_check;

alter table public.customers
  add constraint customers_status_check
  check (status in ('new_lead', 'interested', 'processing', 'closed_won', 'closed_lost'));

commit;