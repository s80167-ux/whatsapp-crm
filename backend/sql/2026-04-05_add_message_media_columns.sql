alter table public.messages add column if not exists media_type text;
alter table public.messages add column if not exists media_mime_type text;
alter table public.messages add column if not exists media_file_name text;
alter table public.messages add column if not exists media_data_url text;