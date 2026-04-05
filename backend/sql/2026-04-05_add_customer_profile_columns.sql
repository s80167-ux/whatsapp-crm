-- Migration: 2026-04-05_add_customer_profile_columns.sql
-- Description: Adds profile_picture_url and about columns to the customers table for persistence.

ALTER TABLE public.customers
ADD COLUMN IF NOT EXISTS profile_picture_url text,
ADD COLUMN IF NOT EXISTS about text;
