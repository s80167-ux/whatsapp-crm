const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing Supabase environment variables.");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

function isMissingColumnError(error, columnName) {
  return error?.code === "42703" && String(error?.message || "").includes(columnName);
}

function isDuplicateCustomerPrimaryKeyError(error) {
  return error?.code === "23505" && String(error?.message || "").includes("customers_pkey");
}

function tenantSchemaError(error) {
  const wrappedError = new Error(
    "Database tenant isolation is not configured. Run backend/sql/tenant_isolation.sql in Supabase and backfill owner_user_id before using the dashboard."
  );
  wrappedError.status = 500;
  wrappedError.cause = error;
  return wrappedError;
}

function throwIfTenantSchemaError(error, columnName) {
  if (isMissingColumnError(error, columnName) || isDuplicateCustomerPrimaryKeyError(error)) {
    throw tenantSchemaError(error);
  }
}

async function saveMessage({ owner_user_id, phone, chat_jid, wa_message_id, message, direction, send_status }) {
  let query = supabase
    .from("messages")
    .insert({
      owner_user_id,
      phone,
      ...(chat_jid ? { chat_jid } : {}),
      ...(wa_message_id ? { wa_message_id } : {}),
      message,
      direction,
      ...(send_status ? { send_status } : {})
    })
    .select()
    .single();

  let { data, error } = await query;

  throwIfTenantSchemaError(error, "messages.owner_user_id");

  if (
    isMissingColumnError(error, "messages.chat_jid") ||
    isMissingColumnError(error, "messages.wa_message_id") ||
    isMissingColumnError(error, "messages.send_status")
  ) {
    ({ data, error } = await supabase
      .from("messages")
      .insert({
        owner_user_id,
        phone,
        message,
        direction
      })
      .select()
      .single());
  }

  throwIfTenantSchemaError(error, "messages.owner_user_id");

  if (error) {
    throw error;
  }

  return data;
}

async function updateOutgoingMessageStatus({ owner_user_id, phone, chat_jid, wa_message_id, send_status }) {
  if (!wa_message_id || !send_status) {
    return null;
  }

  let query = supabase
    .from("messages")
    .update({
      send_status
    })
    .eq("owner_user_id", owner_user_id)
    .eq("wa_message_id", wa_message_id)
    .eq("direction", "outgoing");

  if (phone) {
    query = query.eq("phone", phone);
  }

  let { data, error } = await query.select("*").limit(1).maybeSingle();

  throwIfTenantSchemaError(error, "messages.owner_user_id");

  if (isMissingColumnError(error, "messages.wa_message_id") || isMissingColumnError(error, "messages.send_status")) {
    return null;
  }

  if (error) {
    throw error;
  }

  if (data) {
    return data;
  }

  if (!chat_jid) {
    return null;
  }

  const lookup = await supabase
    .from("messages")
    .select("id")
    .eq("owner_user_id", owner_user_id)
    .eq("chat_jid", chat_jid)
    .eq("direction", "outgoing")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  throwIfTenantSchemaError(lookup.error, "messages.owner_user_id");

  if (isMissingColumnError(lookup.error, "messages.chat_jid")) {
    return null;
  }

  if (lookup.error) {
    throw lookup.error;
  }

  if (!lookup.data?.id) {
    return null;
  }

  const fallback = await supabase
    .from("messages")
    .update({
      send_status
    })
    .eq("owner_user_id", owner_user_id)
    .eq("id", lookup.data.id)
    .select("*")
    .maybeSingle();

  throwIfTenantSchemaError(fallback.error, "messages.owner_user_id");

  if (isMissingColumnError(fallback.error, "messages.send_status") || isMissingColumnError(fallback.error, "messages.chat_jid")) {
    return null;
  }

  if (fallback.error) {
    throw fallback.error;
  }

  return fallback.data;
}

async function getMessagesByPhone(phone, ownerUserId) {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("owner_user_id", ownerUserId)
    .eq("phone", phone)
    .order("created_at", { ascending: true });

  throwIfTenantSchemaError(error, "messages.owner_user_id");

  if (error) {
    throw error;
  }

  return data;
}

async function getConversations(ownerUserId) {
  let [{ data: messageRows, error: messageError }, { data: customerRows, error: customerError }] = await Promise.all([
    supabase
      .from("messages")
      .select("phone, chat_jid, message, created_at, direction")
      .eq("owner_user_id", ownerUserId)
      .order("created_at", { ascending: false }),
    supabase.from("customers").select("phone, chat_jid, status, contact_name").eq("owner_user_id", ownerUserId)
  ]);

  throwIfTenantSchemaError(messageError, "messages.owner_user_id");
  throwIfTenantSchemaError(customerError, "customers.owner_user_id");

  if (isMissingColumnError(messageError, "messages.chat_jid")) {
    ({ data: messageRows, error: messageError } = await supabase
      .from("messages")
      .select("phone, message, created_at, direction")
      .eq("owner_user_id", ownerUserId)
      .order("created_at", { ascending: false }));

    throwIfTenantSchemaError(messageError, "messages.owner_user_id");
  }

  if (isMissingColumnError(customerError, "customers.chat_jid")) {
    ({ data: customerRows, error: customerError } = await supabase
      .from("customers")
      .select("phone, status, contact_name")
      .eq("owner_user_id", ownerUserId));

    throwIfTenantSchemaError(customerError, "customers.owner_user_id");
  }

  if (messageError) {
    throw messageError;
  }

  if (customerError) {
    console.warn("Customers lookup failed while building conversations. Falling back to default status.", customerError.message);
  }

  const customerMap = new Map((customerRows || []).map((customer) => [customer.phone, customer]));
  const seen = new Set();
  const conversations = [];

  for (const row of messageRows || []) {
    if (seen.has(row.phone)) {
      continue;
    }

    seen.add(row.phone);
    conversations.push({
      phone: row.phone,
      chatJid: customerMap.get(row.phone)?.chat_jid || row.chat_jid || null,
      contactName: customerMap.get(row.phone)?.contact_name || null,
      lastMessage: row.message,
      timestamp: row.created_at,
      lastDirection: row.direction,
      status: customerMap.get(row.phone)?.status || "warm"
    });
  }

  return conversations;
}

async function getCustomerByPhone(phone, ownerUserId) {
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .eq("owner_user_id", ownerUserId)
    .eq("phone", phone)
    .maybeSingle();

  throwIfTenantSchemaError(error, "customers.owner_user_id");

  if (error) {
    throw error;
  }

  return (
    data || {
      phone,
      chat_jid: null,
      contact_name: null,
      status: "warm",
      notes: ""
    }
  );
}

async function getCustomerInsights(phone, ownerUserId) {
  const customer = await getCustomerByPhone(phone, ownerUserId);
  const { data: messages, error } = await supabase
    .from("messages")
    .select("direction, created_at, message")
    .eq("owner_user_id", ownerUserId)
    .eq("phone", phone)
    .order("created_at", { ascending: false });

  throwIfTenantSchemaError(error, "messages.owner_user_id");

  if (error) {
    throw error;
  }

  const rows = messages || [];
  const incomingCount = rows.filter((item) => item.direction === "incoming").length;
  const outgoingCount = rows.filter((item) => item.direction === "outgoing").length;
  const latestMessage = rows[0] || null;

  return {
    ...customer,
    total_messages: rows.length,
    incoming_count: incomingCount,
    outgoing_count: outgoingCount,
    last_message_at: latestMessage?.created_at || null,
    last_message_preview: latestMessage?.message || null,
    last_direction: latestMessage?.direction || null
  };
}

async function upsertCustomer({ owner_user_id, phone, chat_jid, contact_name, status, notes }) {
  const payload = {
    owner_user_id,
    phone,
    ...(chat_jid !== undefined ? { chat_jid } : {}),
    ...(contact_name !== undefined ? { contact_name } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(notes !== undefined ? { notes } : {}),
    updated_at: new Date().toISOString()
  };

  const existing = await supabase
    .from("customers")
    .select("id")
    .eq("owner_user_id", owner_user_id)
    .eq("phone", phone)
    .maybeSingle();

  throwIfTenantSchemaError(existing.error, "customers.owner_user_id");

  if (existing.error) {
    throw existing.error;
  }

  let data;
  let error;

  if (existing.data?.id) {
    ({ data, error } = await supabase
      .from("customers")
      .update(payload)
      .eq("id", existing.data.id)
      .select("*")
      .single());
  } else {
    ({ data, error } = await supabase
      .from("customers")
      .insert(payload)
      .select("*")
      .single());
  }

  throwIfTenantSchemaError(error, "customers.owner_user_id");

  if (isMissingColumnError(error, "customers.chat_jid")) {
    const { chat_jid: _ignored, ...fallbackPayload } = payload;

    if (existing.data?.id) {
      ({ data, error } = await supabase
        .from("customers")
        .update(fallbackPayload)
        .eq("id", existing.data.id)
        .select("*")
        .single());
    } else {
      ({ data, error } = await supabase
        .from("customers")
        .insert(fallbackPayload)
        .select("*")
        .single());
    }

    throwIfTenantSchemaError(error, "customers.owner_user_id");
  }

  if (error) {
    throw error;
  }

  return data;
}

async function getCustomerOwnerIdsByPhone(phone) {
  const { data, error } = await supabase
    .from("customers")
    .select("owner_user_id")
    .eq("phone", phone)
    .not("owner_user_id", "is", null);

  throwIfTenantSchemaError(error, "customers.owner_user_id");

  if (error) {
    throw error;
  }

  return (data || []).map((row) => row.owner_user_id).filter(Boolean);
}

module.exports = {
  supabase,
  saveMessage,
  updateOutgoingMessageStatus,
  getMessagesByPhone,
  getConversations,
  getCustomerByPhone,
  getCustomerInsights,
  upsertCustomer,
  getCustomerOwnerIdsByPhone
};
