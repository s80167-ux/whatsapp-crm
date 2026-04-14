require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing Supabase environment variables.");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

function dedupeOwnerIds(...collections) {
  return Array.from(
    new Set(
      collections
        .flat()
        .map((row) => row?.owner_user_id)
        .filter(Boolean)
    )
  );
}

async function getExistingAccountByOwner(ownerUserId) {
  const { data, error } = await supabase
    .from("whatsapp_accounts")
    .select("*")
    .eq("owner_user_id", ownerUserId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data;
}

async function getProfileByOwner(ownerUserId) {
  const { data, error } = await supabase
    .from("whatsapp_profiles")
    .select("phone, username, profile_picture_url")
    .eq("owner_user_id", ownerUserId)
    .maybeSingle();

  if (error && error.code !== "42P01") {
    throw error;
  }

  return data;
}

async function ensureLegacyAccount(ownerUserId) {
  const existingAccount = await getExistingAccountByOwner(ownerUserId);

  if (existingAccount?.id) {
    return existingAccount;
  }

  const profile = await getProfileByOwner(ownerUserId);
  const authDir = `legacy/${ownerUserId}/default`;
  const payload = {
    owner_user_id: ownerUserId,
    account_phone: profile?.phone || null,
    display_name: profile?.username || null,
    profile_picture_url: profile?.profile_picture_url || null,
    auth_dir: authDir,
    connection_state: "disconnected",
    is_active: true,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("whatsapp_accounts")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function backfillTable({ table, ownerUserId, accountId }) {
  const { data: rows, error: lookupError } = await supabase
    .from(table)
    .select("id")
    .eq("owner_user_id", ownerUserId)
    .is("whatsapp_account_id", null);

  if (lookupError) {
    if (lookupError.code === "42P01") {
      return 0;
    }

    throw lookupError;
  }

  let updatedCount = 0;

  for (const row of rows || []) {
    const { error } = await supabase
      .from(table)
      .update({ whatsapp_account_id: accountId })
      .eq("id", row.id);

    if (error) {
      throw error;
    }

    updatedCount += 1;
  }

  return updatedCount;
}

async function main() {
  const [{ data: messageOwners, error: messageOwnersError }, { data: customerOwners, error: customerOwnersError }, { data: salesOwners, error: salesOwnersError }, { data: profileOwners, error: profileOwnersError }] = await Promise.all([
    supabase.from("messages").select("owner_user_id").not("owner_user_id", "is", null),
    supabase.from("customers").select("owner_user_id").not("owner_user_id", "is", null),
    supabase.from("customer_sales_items").select("owner_user_id").not("owner_user_id", "is", null),
    supabase.from("whatsapp_profiles").select("owner_user_id").not("owner_user_id", "is", null)
  ]);

  if (messageOwnersError) throw messageOwnersError;
  if (customerOwnersError) throw customerOwnersError;
  if (salesOwnersError && salesOwnersError.code !== "42P01") throw salesOwnersError;
  if (profileOwnersError && profileOwnersError.code !== "42P01") throw profileOwnersError;

  const ownerUserIds = dedupeOwnerIds(
    messageOwners || [],
    customerOwners || [],
    salesOwners || [],
    profileOwners || []
  );

  console.log(`Found ${ownerUserIds.length} owner(s) to backfill.`);

  for (const ownerUserId of ownerUserIds) {
    const account = await ensureLegacyAccount(ownerUserId);
    const messagesUpdated = await backfillTable({
      table: "messages",
      ownerUserId,
      accountId: account.id
    });
    const customersUpdated = await backfillTable({
      table: "customers",
      ownerUserId,
      accountId: account.id
    });
    const salesItemsUpdated = await backfillTable({
      table: "customer_sales_items",
      ownerUserId,
      accountId: account.id
    });

    console.log(
      JSON.stringify({
        owner_user_id: ownerUserId,
        whatsapp_account_id: account.id,
        messagesUpdated,
        customersUpdated,
        salesItemsUpdated
      })
    );
  }
}

main().catch((error) => {
  console.error("Failed to backfill WhatsApp accounts:", error);
  process.exitCode = 1;
});
