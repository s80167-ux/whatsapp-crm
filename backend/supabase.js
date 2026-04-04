const { createClient } = require("@supabase/supabase-js");
const { getPhoneLookupValues, resolveWhatsAppPhone } = require("./wa-identifiers");

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

const STATUS_NOTE_MARKER = "[[crm_status:";
const STATUS_NOTE_REGEX = /^\[\[crm_status:(new_lead|interested|processing|closed_won|closed_lost)\]\]\n?/;

function stripStoredStatusMetadata(notes) {
  if (typeof notes !== "string") {
    return "";
  }

  return notes.replace(STATUS_NOTE_REGEX, "");
}

function getEmbeddedStatus(notes) {
  if (typeof notes !== "string") {
    return null;
  }

  const match = notes.match(STATUS_NOTE_REGEX);
  return match ? match[1] : null;
}

function normalizeCustomerStatus(status, notes) {
  const embeddedStatus = getEmbeddedStatus(notes);

  if (embeddedStatus) {
    return embeddedStatus;
  }

  switch (status) {
    case "hot":
      return "processing";
    case "warm":
      return "interested";
    case "cold":
      return "closed_lost";
    case "new_lead":
    case "interested":
    case "processing":
    case "closed_won":
    case "closed_lost":
      return status;
    default:
      return "new_lead";
  }
}

function toLegacyCustomerStatus(status) {
  switch (status) {
    case "processing":
      return "hot";
    case "closed_lost":
      return "cold";
    case "new_lead":
    case "interested":
    case "closed_won":
    default:
      return "warm";
  }
}

function withStoredStatusMetadata(status, notes) {
  const sanitizedNotes = stripStoredStatusMetadata(notes);
  return `${STATUS_NOTE_MARKER}${status}]]\n${sanitizedNotes}`;
}

function normalizeCustomerRecord(customer) {
  if (!customer) {
    return customer;
  }

  return {
    ...customer,
    status: normalizeCustomerStatus(customer.status, customer.notes),
    ...(Object.prototype.hasOwnProperty.call(customer, "notes") ? { notes: stripStoredStatusMetadata(customer.notes) } : {})
  };
}

function isCustomerStatusConstraintError(error) {
  return error?.code === "23514" && String(error?.message || "").toLowerCase().includes("status");
}

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
  const lookupValues = await getPhoneLookupValues(phone);
  const resolvedPhone = await resolveWhatsAppPhone(phone);
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("owner_user_id", ownerUserId)
    .in("phone", lookupValues)
    .order("created_at", { ascending: true });

  throwIfTenantSchemaError(error, "messages.owner_user_id");

  if (error) {
    throw error;
  }

  return (data || []).map((item) => ({
    ...item,
    phone: resolvedPhone || item.phone
  }));
}

async function getConversations(ownerUserId) {
  let [{ data: messageRows, error: messageError }, { data: customerRows, error: customerError }] = await Promise.all([
    supabase
      .from("messages")
      .select("phone, chat_jid, message, created_at, direction")
      .eq("owner_user_id", ownerUserId)
      .order("created_at", { ascending: false }),
    supabase.from("customers").select("phone, chat_jid, status, contact_name, notes").eq("owner_user_id", ownerUserId)
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
      .select("phone, status, contact_name, notes")
      .eq("owner_user_id", ownerUserId));

    throwIfTenantSchemaError(customerError, "customers.owner_user_id");
  }

  if (messageError) {
    throw messageError;
  }

  if (customerError) {
    console.warn("Customers lookup failed while building conversations. Falling back to default status.", customerError.message);
  }

  const customerMap = new Map();
  const customerChatJidMap = new Map();

  for (const customer of customerRows || []) {
    const resolvedPhone = await resolveWhatsAppPhone(customer.phone, customer.chat_jid || null);

    if (resolvedPhone) {
      customerMap.set(resolvedPhone, {
        ...normalizeCustomerRecord(customer),
        phone: resolvedPhone
      });
    }

    if (customer.chat_jid) {
      customerChatJidMap.set(customer.chat_jid, {
        ...normalizeCustomerRecord(customer),
        phone: resolvedPhone || customer.phone
      });
    }
  }
  const seen = new Set();
  const conversations = [];

  for (const row of messageRows || []) {
    const resolvedPhone = await resolveWhatsAppPhone(row.phone, row.chat_jid || null);
    const matchedCustomer = customerMap.get(resolvedPhone) || customerChatJidMap.get(row.chat_jid) || null;

    if (!resolvedPhone || seen.has(resolvedPhone)) {
      continue;
    }

    seen.add(resolvedPhone);
    conversations.push({
      phone: resolvedPhone,
      chatJid: matchedCustomer?.chat_jid || row.chat_jid || null,
      contactName: matchedCustomer?.contact_name || null,
      lastMessage: row.message,
      timestamp: row.created_at,
      lastDirection: row.direction,
      status: matchedCustomer?.status || "new_lead"
    });
  }

  return conversations;
}

async function getCustomerByPhone(phone, ownerUserId) {
  const lookupValues = await getPhoneLookupValues(phone);
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .eq("owner_user_id", ownerUserId)
    .in("phone", lookupValues)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  throwIfTenantSchemaError(error, "customers.owner_user_id");

  if (error) {
    throw error;
  }

  const resolvedPhone = await resolveWhatsAppPhone(phone, data?.chat_jid || null);

  return normalizeCustomerRecord(
    data || {
      phone: resolvedPhone || phone,
      chat_jid: null,
      contact_name: null,
      status: "new_lead",
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
  const canonicalPhone = await resolveWhatsAppPhone(phone, chat_jid || null);
  const payload = {
    owner_user_id,
    phone: canonicalPhone || phone,
    ...(chat_jid !== undefined ? { chat_jid } : {}),
    ...(contact_name !== undefined ? { contact_name } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(notes !== undefined ? { notes } : {}),
    updated_at: new Date().toISOString()
  };
  let writePayload = payload;

  const lookupValues = await getPhoneLookupValues(phone, chat_jid || null);
  const existing = await supabase
    .from("customers")
    .select("id")
    .eq("owner_user_id", owner_user_id)
    .in("phone", lookupValues)
    .limit(1)
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
      .update(writePayload)
      .eq("id", existing.data.id)
      .select("*")
      .single());
  } else {
    ({ data, error } = await supabase
      .from("customers")
      .insert(writePayload)
      .select("*")
      .single());
  }

  throwIfTenantSchemaError(error, "customers.owner_user_id");

  if (isMissingColumnError(error, "customers.chat_jid")) {
    const { chat_jid: _ignored, ...fallbackPayload } = writePayload;
    writePayload = fallbackPayload;

    if (existing.data?.id) {
      ({ data, error } = await supabase
        .from("customers")
        .update(writePayload)
        .eq("id", existing.data.id)
        .select("*")
        .single());
    } else {
      ({ data, error } = await supabase
        .from("customers")
        .insert(writePayload)
        .select("*")
        .single());
    }

    throwIfTenantSchemaError(error, "customers.owner_user_id");
  }

  if (isCustomerStatusConstraintError(error) && status !== undefined) {
    const legacyPayload = {
      ...writePayload,
      status: toLegacyCustomerStatus(status),
      notes: withStoredStatusMetadata(status, notes)
    };

    if (existing.data?.id) {
      ({ data, error } = await supabase
        .from("customers")
        .update(legacyPayload)
        .eq("id", existing.data.id)
        .select("*")
        .single());
    } else {
      ({ data, error } = await supabase
        .from("customers")
        .insert(legacyPayload)
        .select("*")
        .single());
    }

    throwIfTenantSchemaError(error, "customers.owner_user_id");
  }

  if (error) {
    throw error;
  }

  return normalizeCustomerRecord(data);
}

async function getCustomerOwnerIdsByPhone(phone) {
  const lookupValues = await getPhoneLookupValues(phone);
  const { data, error } = await supabase
    .from("customers")
    .select("owner_user_id")
    .in("phone", lookupValues)
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
