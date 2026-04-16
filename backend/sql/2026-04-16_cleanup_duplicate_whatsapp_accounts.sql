-- Remove stale WhatsApp account rows so only the latest row per owner/phone remains.
-- This helps clean up abandoned connection attempts and duplicate inbox sources.

begin;

delete from public.whatsapp_accounts
where id in (
  select id
  from (
    select
      id,
      row_number() over (
        partition by owner_user_id, regexp_replace(coalesce(account_phone, ''), '\D', '', 'g')
        order by
          case when connection_state = 'open' then 0 else 1 end,
          coalesce(last_connected_at, updated_at, created_at) desc,
          updated_at desc,
          created_at desc
      ) as row_num
    from public.whatsapp_accounts
    where coalesce(btrim(account_phone), '') <> ''
  ) ranked
  where row_num > 1
);

delete from public.whatsapp_accounts
where coalesce(btrim(account_phone), '') = ''
  and coalesce(connection_state, '') <> 'open';

commit;
