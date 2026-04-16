-- Remove invalid WhatsApp account rows that cannot represent a real connected session.
-- These rows usually have no usable phone number and show up in the UI as
-- "Phone unavailable - Offline".

begin;

delete from public.whatsapp_accounts
where account_phone is null
   or btrim(account_phone) = '';

commit;
