-- Migration: Add new customer fields for CRM (premise_address, business_type, age, email_address)
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS premise_address text,
  ADD COLUMN IF NOT EXISTS business_type text,
  ADD COLUMN IF NOT EXISTS age integer,
  ADD COLUMN IF NOT EXISTS email_address text;
