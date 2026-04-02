import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  console.warn("Missing Supabase frontend environment variables.");
}

export const supabase = createClient(
  supabaseUrl || "https://kavumbilqekhzkzzxnhc.supabase.co",
  supabasePublishableKey || "missing-publishable-key"
);
