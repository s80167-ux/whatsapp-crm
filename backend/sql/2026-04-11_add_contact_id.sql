-- Migration: Add unique, immutable contact_id to customers table
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS contact_id uuid DEFAULT gen_random_uuid();

-- Ensure contact_id is unique and never null
ALTER TABLE public.customers
  ALTER COLUMN contact_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS customers_owner_contact_id_idx
  ON public.customers (owner_user_id, contact_id);
