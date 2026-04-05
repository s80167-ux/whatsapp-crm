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
  const errorMessage = String(error?.message || "");
  return (
    (error?.code === "42703" && errorMessage.includes(columnName)) ||
    (error?.code === "PGRST204" && errorMessage.includes(columnName))
  );
}

function isDuplicateCustomerPrimaryKeyError(error) {
  return error?.code === "23505" && String(error?.message || "").includes("customers_pkey");
}

function isDuplicateConstraintError(error, constraintName) {
  return error?.code === "23505" && String(error?.message || "").includes(constraintName);
}

function getJidMeta(value) {
  const rawValue = String(value || "").trim();

  if (!rawValue) {
    return {
      digits: "",
      server: ""
    };
  }

  const [user = "", server = ""] = rawValue.split("@");
  return {
    digits: user.split(":")[0]?.replace(/\D/g, "") || "",
    server: server.trim().toLowerCase()
  };
}

function shouldPreserveExistingPhone(existingPhone, nextPhone, chatJid) {
  const normalizedExistingPhone = String(existingPhone || "").trim();
  const normalizedNextPhone = String(nextPhone || "").trim();
  const { digits, server } = getJidMeta(chatJid);

  return Boolean(
    normalizedExistingPhone &&
    normalizedNextPhone &&
    server === "lid" &&
    digits &&
    normalizedNextPhone === digits &&
    normalizedExistingPhone !== normalizedNextPhone
  );
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

function salesItemsSchemaError(error) {
  const wrappedError = new Error(
    "Sales lead items are not configured. Run backend/sql/2026-04-05_add_customer_sales_items.sql in Supabase before using lead registration."
  );
  wrappedError.status = 500;
  wrappedError.cause = error;
  return wrappedError;
}

function throwIfSalesItemsSchemaError(error) {
  const errorMessage = String(error?.message || "");

  if (error?.code === "42P01" || errorMessage.includes("customer_sales_items")) {
    throw salesItemsSchemaError(error);
  }
}

function hasCustomerChanges(existingCustomer, nextCustomer) {
  return Object.entries(nextCustomer).some(([key, value]) => {
    if (key === "updated_at") {
      return false;
    }

    return existingCustomer?.[key] !== value;
  });
}

async function findExistingMessage({ owner_user_id, phone, chat_jid, wa_message_id, message, direction, created_at }) {
  if (wa_message_id) {
    const byWhatsAppId = await supabase
      .from("messages")
      .select("*")
      .eq("owner_user_id", owner_user_id)
      .eq("wa_message_id", wa_message_id)
      .limit(1)
      .maybeSingle();

    throwIfTenantSchemaError(byWhatsAppId.error, "messages.owner_user_id");

    if (!isMissingColumnError(byWhatsAppId.error, "messages.wa_message_id")) {
      if (byWhatsAppId.error) {
        throw byWhatsAppId.error;
      }

      if (byWhatsAppId.data) {
        return byWhatsAppId.data;
      }
    }
  }

  if (!created_at) {
    return null;
  }

  let fallbackQuery = supabase
    .from("messages")
    .select("*")
    .eq("owner_user_id", owner_user_id)
    .eq("phone", phone)
    .eq("message", message)
    .eq("direction", direction)
    .eq("created_at", created_at)
    .limit(1);

  if (chat_jid) {
    fallbackQuery = fallbackQuery.eq("chat_jid", chat_jid);
  }

  const fallback = await fallbackQuery.maybeSingle();

  throwIfTenantSchemaError(fallback.error, "messages.owner_user_id");

  if (isMissingColumnError(fallback.error, "messages.chat_jid")) {
    fallbackQuery = supabase
      .from("messages")
      .select("*")
      .eq("owner_user_id", owner_user_id)
      .eq("phone", phone)
      .eq("message", message)
      .eq("direction", direction)
      .eq("created_at", created_at)
      .limit(1);

    const noChatJidFallback = await fallbackQuery.maybeSingle();

    throwIfTenantSchemaError(noChatJidFallback.error, "messages.owner_user_id");

    if (noChatJidFallback.error) {
      throw noChatJidFallback.error;
    }

    return noChatJidFallback.data || null;
  }

  if (fallback.error) {
    throw fallback.error;
  }

  return fallback.data || null;
}

async function findExistingCustomer({ owner_user_id, phone, chat_jid }) {
  if (chat_jid) {
    const byChatJid = await supabase
      .from("customers")
      .select("*")
      .eq("owner_user_id", owner_user_id)
      .eq("chat_jid", chat_jid)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    throwIfTenantSchemaError(byChatJid.error, "customers.owner_user_id");

    if (!isMissingColumnError(byChatJid.error, "customers.chat_jid")) {
      if (byChatJid.error) {
        throw byChatJid.error;
      }

      if (byChatJid.data) {
        return byChatJid.data;
      }
    }
  }

  const lookupValues = await getPhoneLookupValues(phone, chat_jid || null);
  const existing = await supabase
    .from("customers")
    .select("*")
    .eq("owner_user_id", owner_user_id)
    .in("phone", lookupValues)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  throwIfTenantSchemaError(existing.error, "customers.owner_user_id");

  if (existing.error) {
    throw existing.error;
  }

  return existing.data || null;
}

async function saveMessage({ owner_user_id, phone, chat_jid, wa_message_id, message, direction, send_status, created_at, media_type, media_mime_type, media_file_name, media_data_url }) {
  const existingMessage = await findExistingMessage({
    owner_user_id,
    phone,
    chat_jid,
    wa_message_id,
    message,
    direction,
    created_at
  });

  if (existingMessage) {
    return existingMessage;
  }

  let query = supabase
    .from("messages")
    .insert({
      owner_user_id,
      phone,
      ...(chat_jid ? { chat_jid } : {}),
      ...(wa_message_id ? { wa_message_id } : {}),
      message,
      ...(media_type ? { media_type } : {}),
      ...(media_mime_type ? { media_mime_type } : {}),
      ...(media_file_name ? { media_file_name } : {}),
      ...(media_data_url ? { media_data_url } : {}),
      direction,
      ...(send_status ? { send_status } : {}),
      ...(created_at ? { created_at } : {})
    })
    .select()
    .single();

  let { data, error } = await query;

  throwIfTenantSchemaError(error, "messages.owner_user_id");

  if (
    isMissingColumnError(error, "messages.chat_jid") ||
    isMissingColumnError(error, "messages.wa_message_id") ||
    isMissingColumnError(error, "messages.send_status") ||
    isMissingColumnError(error, "messages.media_type") ||
    isMissingColumnError(error, "messages.media_mime_type") ||
    isMissingColumnError(error, "messages.media_file_name") ||
    isMissingColumnError(error, "messages.media_data_url")
  ) {
    ({ data, error } = await supabase
      .from("messages")
      .insert({
        owner_user_id,
        phone,
        message,
        direction,
        ...(created_at ? { created_at } : {})
      })
      .select()
      .single());
  }

  throwIfTenantSchemaError(error, "messages.owner_user_id");

  if (isDuplicateConstraintError(error, "messages_owner_wa_message_id_idx") && wa_message_id) {
    const duplicate = await findExistingMessage({
      owner_user_id,
      phone,
      chat_jid,
      wa_message_id,
      message,
      direction,
      created_at
    });

    if (duplicate) {
      return duplicate;
    }
  }

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
    supabase.from("customers").select("phone, chat_jid, status, contact_name, notes, unread_count, profile_picture_url").eq("owner_user_id", ownerUserId)
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

  if (isMissingColumnError(customerError, "customers.chat_jid") || isMissingColumnError(customerError, "customers.profile_picture_url")) {
    ({ data: customerRows, error: customerError } = await supabase
      .from("customers")
      .select("phone, status, contact_name, notes, unread_count")
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
      profilePictureUrl: matchedCustomer?.profile_picture_url || null,
      lastMessage: row.message,
      timestamp: row.created_at,
      lastDirection: row.direction,
      status: matchedCustomer?.status || "new_lead",
      unreadCount: matchedCustomer?.unread_count || 0
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
  const lookupValues = await getPhoneLookupValues(phone, customer?.chat_jid || null);
  const { data: messages, error } = await supabase
    .from("messages")
    .select("direction, created_at, message")
    .eq("owner_user_id", ownerUserId)
    .in("phone", lookupValues)
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
    profile_picture_url: customer.profile_picture_url || null,
    about: customer.about || null,
    total_messages: rows.length,
    incoming_count: incomingCount,
    outgoing_count: outgoingCount,
    last_message_at: latestMessage?.created_at || null,
    last_message_preview: latestMessage?.message || null,
    last_direction: latestMessage?.direction || null
  };
}

async function clearConversationUnreadCount({ owner_user_id, phone, chat_jid }) {
  const existingCustomer = await findExistingCustomer({
    owner_user_id,
    phone,
    chat_jid
  });

  if (!existingCustomer) {
    return null;
  }

  const { data, error } = await supabase
    .from("customers")
    .update({
      unread_count: 0,
      updated_at: new Date().toISOString()
    })
    .eq("id", existingCustomer.id)
    .select("*")
    .single();

  throwIfTenantSchemaError(error, "customers.owner_user_id");

  if (isMissingColumnError(error, "customers.unread_count")) {
    return normalizeCustomerRecord(existingCustomer);
  }

  if (error) {
    throw error;
  }

  return normalizeCustomerRecord(data);
}

async function upsertCustomer({ owner_user_id, phone, chat_jid, contact_name, status, notes, profile_picture_url, about, unread_count }) {
  const canonicalPhone = await resolveWhatsAppPhone(phone, chat_jid || null);
  const payload = {
    owner_user_id,
    phone: canonicalPhone || phone,
    ...(chat_jid !== undefined ? { chat_jid } : {}),
    ...(contact_name !== undefined ? { contact_name } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(notes !== undefined ? { notes } : {}),
    ...(profile_picture_url !== undefined ? { profile_picture_url } : {}),
    ...(about !== undefined ? { about } : {}),
    ...(unread_count !== undefined ? { unread_count } : {}),
    updated_at: new Date().toISOString()
  };
  let writePayload = payload;

  const existingCustomer = await findExistingCustomer({
    owner_user_id,
    phone,
    chat_jid
  });

  if (shouldPreserveExistingPhone(existingCustomer?.phone, writePayload.phone, chat_jid)) {
    writePayload = {
      ...writePayload,
      phone: existingCustomer.phone
    };
  }

  let data;
  let error;

  if (existingCustomer?.id) {
    if (!hasCustomerChanges(existingCustomer, writePayload)) {
      return normalizeCustomerRecord(existingCustomer);
    }

    ({ data, error } = await supabase
      .from("customers")
      .update(writePayload)
      .eq("id", existingCustomer.id)
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

    if (existingCustomer?.id) {
      ({ data, error } = await supabase
        .from("customers")
        .update(writePayload)
        .eq("id", existingCustomer.id)
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

  if (isMissingColumnError(error, "customers.profile_picture_url") || isMissingColumnError(error, "customers.about")) {
    const { profile_picture_url: _p, about: _a, ...fallbackPayload } = writePayload;
    writePayload = fallbackPayload;

    if (existingCustomer?.id) {
      ({ data, error } = await supabase
        .from("customers")
        .update(writePayload)
        .eq("id", existingCustomer.id)
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

  if (isMissingColumnError(error, "customers.unread_count")) {
    const { unread_count: _uc, ...fallbackPayload } = writePayload;
    writePayload = fallbackPayload;

    if (existingCustomer?.id) {
      ({ data, error } = await supabase
        .from("customers")
        .update(writePayload)
        .eq("id", existingCustomer.id)
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

    if (existingCustomer?.id) {
      ({ data, error } = await supabase
        .from("customers")
        .update(legacyPayload)
        .eq("id", existingCustomer.id)
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

  if (
    isDuplicateConstraintError(error, "customers_owner_phone_idx") ||
    isDuplicateConstraintError(error, "customers_owner_chat_jid_idx")
  ) {
    const duplicate = await findExistingCustomer({
      owner_user_id,
      phone: writePayload.phone,
      chat_jid
    });

    if (duplicate?.id) {
      ({ data, error } = await supabase
        .from("customers")
        .update(writePayload)
        .eq("id", duplicate.id)
        .select("*")
        .single());
    }
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

async function getWhatsAppSettings(ownerUserId) {
  const { data, error } = await supabase
    .from("whatsapp_profiles")
    .select("history_sync_days")
    .eq("owner_user_id", ownerUserId)
    .maybeSingle();

  if (error && error.code !== "42P01") {
    console.error("Failed to fetch WhatsApp settings:", error);
  }

  return { history_sync_days: data?.history_sync_days ?? 7 };
}

async function upsertWhatsAppProfile({ owner_user_id, phone, username, profile_picture_url, history_sync_days }) {
  const payload = {
    owner_user_id,
    ...(phone !== undefined ? { phone } : {}),
    ...(username !== undefined ? { username } : {}),
    ...(profile_picture_url !== undefined ? { profile_picture_url } : {}),
    ...(history_sync_days !== undefined ? { history_sync_days } : {}),
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("whatsapp_profiles")
    .upsert(payload, { onConflict: "owner_user_id" })
    .select()
    .single();

  if (error && error.code !== "42P01") {
    throw error;
  }

  return data;
}

async function getCustomerSalesItems(phone, ownerUserId, chatJid) {
  const lookupValues = await getPhoneLookupValues(phone, chatJid || null);
  const { data, error } = await supabase
    .from("customer_sales_items")
    .select("id, message_id, phone, chat_jid, product_type, package_name, price, quantity, created_at, updated_at")
    .eq("owner_user_id", ownerUserId)
    .in("phone", lookupValues)
    .order("created_at", { ascending: false });

  throwIfSalesItemsSchemaError(error);

  if (error) {
    throw error;
  }

  return Promise.all(
    (data || []).map(async (item) => ({
      ...item,
      phone: (await resolveWhatsAppPhone(item.phone, item.chat_jid || null)) || item.phone
    }))
  );
}

async function getOwnedMessageRecord(messageId, ownerUserId) {
  const { data, error } = await supabase
    .from("messages")
    .select("id, phone, chat_jid")
    .eq("owner_user_id", ownerUserId)
    .eq("id", messageId)
    .maybeSingle();

  throwIfTenantSchemaError(error, "messages.owner_user_id");

  if (error) {
    throw error;
  }

  return data || null;
}

async function createCustomerSalesItem({ owner_user_id, message_id, phone, chat_jid, product_type, package_name, price, quantity }) {
  const messageRecord = await getOwnedMessageRecord(message_id, owner_user_id);

  if (!messageRecord) {
    const error = new Error("Linked message was not found for this customer conversation.");
    error.status = 404;
    throw error;
  }

  const canonicalPhone = await resolveWhatsAppPhone(phone, chat_jid || null);
  const messagePhone = (await resolveWhatsAppPhone(messageRecord.phone, messageRecord.chat_jid || null)) || messageRecord.phone;

  if ((canonicalPhone || phone) !== messagePhone) {
    const error = new Error("The selected message does not belong to this customer conversation.");
    error.status = 400;
    throw error;
  }

  const payload = {
    owner_user_id,
    message_id,
    phone: canonicalPhone || phone,
    ...(chat_jid ? { chat_jid } : {}),
    product_type: String(product_type || "").trim(),
    package_name: String(package_name || "").trim(),
    price: Number(price),
    quantity: Number(quantity),
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("customer_sales_items")
    .insert(payload)
    .select("id, message_id, phone, chat_jid, product_type, package_name, price, quantity, created_at, updated_at")
    .single();

  throwIfSalesItemsSchemaError(error);

  if (error) {
    throw error;
  }

  return {
    ...data,
    phone: (await resolveWhatsAppPhone(data.phone, data.chat_jid || null)) || data.phone
  };
}

module.exports = {
  supabase,
  saveMessage,
  updateOutgoingMessageStatus,
  getMessagesByPhone,
  getConversations,
  getCustomerByPhone,
  getCustomerInsights,
  clearConversationUnreadCount,
  upsertCustomer,
  getCustomerOwnerIdsByPhone,
  getWhatsAppSettings,
  upsertWhatsAppProfile,
  getCustomerSalesItems,
  createCustomerSalesItem,
  supabase
};
