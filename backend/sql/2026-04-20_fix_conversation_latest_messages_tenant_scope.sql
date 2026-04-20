begin;

create or replace view public.conversation_latest_messages as
select distinct on (coalesce(m.whatsapp_account_id::text, 'no-account'), coalesce(nullif(m.phone, ''), nullif(m.chat_jid, '')))
  m.phone,
  m.chat_jid,
  m.last_message,
  m.last_message_at,
  m.last_direction,
  m.whatsapp_account_id,
  m.owner_user_id,
  m.organization_id,
  m.created_by,
  m.assigned_to
from (
  select
    messages.phone,
    messages.chat_jid,
    messages.message as last_message,
    messages.created_at as last_message_at,
    messages.direction as last_direction,
    messages.whatsapp_account_id,
    messages.owner_user_id,
    messages.organization_id,
    messages.created_by,
    messages.assigned_to
  from public.messages
) as m
order by
  coalesce(m.whatsapp_account_id::text, 'no-account'),
  coalesce(nullif(m.phone, ''), nullif(m.chat_jid, '')),
  m.last_message_at desc;

commit;
