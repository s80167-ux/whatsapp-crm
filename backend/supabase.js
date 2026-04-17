// Fetch customers with optional filters and pagination
async function getCustomers({ owner_user_id, whatsapp_account_id, phone, contact_id, contact_name, limit = 10, offset = 0 }) {
  // Cannot order by messages.created_at in PostgREST; fallback to updated_at only
  // If you want to sort by latest message, do it in frontend after fetching
  let query = supabase
    .from("customers")
    .select("*", { count: "exact" })
    .eq("owner_user_id", owner_user_id)
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit - 1);

  query = applyWhatsAppAccountFilter(query, whatsapp_account_id);

  let { data, error } = await query;
  if (isMissingColumnError(error, "customers.whatsapp_account_id")) {
    ({ data, error } = await supabase
      .from("customers")
      .select("*", { count: "exact" })
      .eq("owner_user_id", owner_user_id)
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1));
  }
  throwIfTenantSchemaError(error, "customers.owner_user_id");
  if (error) throw error;
  return (data || []).map(normalizeCustomerRecord);
}
// Fetch a customer by contact_id and owner_user_id
async function getCustomerByContactId(contact_id, owner_user_id, whatsappAccountId = null) {
  let query = supabase
    .from("customers")
    .select("*")
    .eq("owner_user_id", owner_user_id)
    .eq("contact_id", contact_id);
  query = applyWhatsAppAccountFilter(query, whatsappAccountId);
  const { data, error } = await query.maybeSingle();
  throwIfTenantSchemaError(error, "customers.owner_user_id");
  if (error) throw error;
  return data ? normalizeCustomerRecord(data) : null;
}

// Fetch messages by contact_id and owner_user_id
async function getMessagesByContactId(contact_id, owner_user_id, chat_jid = null, whatsappAccountId = null) {
  // Find the customer by contact_id
  let customerQuery = supabase
    .from("customers")
    .select("phone, chat_jid")
    .eq("owner_user_id", owner_user_id)
    .eq("contact_id", contact_id);
  customerQuery = applyWhatsAppAccountFilter(customerQuery, whatsappAccountId);
  const { data: customer, error: customerError } = await customerQuery.maybeSingle();
  throwIfTenantSchemaError(customerError, "customers.owner_user_id");
  if (customerError) throw customerError;
  if (!customer) return [];

  // Now fetch messages by phone and owner_user_id (optionally filter by chat_jid)
  let query = supabase
    .from("messages")
    .select("*")
    .eq("owner_user_id", owner_user_id)
    .eq("phone", customer.phone)
    .order("created_at", { ascending: false });
  if (chat_jid) query = query.eq("chat_jid", chat_jid);
  query = applyWhatsAppAccountFilter(query, whatsappAccountId);
  const { data: messages, error: msgError } = await query;
  throwIfTenantSchemaError(msgError, "messages.owner_user_id");
  if (msgError) throw msgError;
  return messages || [];
}
const { createClient } = require("@supabase/supabase-js");
const { getPhoneLookupValues, normalizePhone, resolveWhatsAppPhone } = require("./wa-identifiers");
const path = require("path");


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

const baseAuthDir = process.env.WHATSAPP_AUTH_DIR
  ? path.resolve(process.env.WHATSAPP_AUTH_DIR)
  : path.join(__dirname, "baileys_auth");

function isExplicitAbsoluteAuthDir(value) {
  const rawValue = String(value || "").trim();

  if (!rawValue) {
    return false;
  }

  return path.isAbsolute(rawValue) || /^[a-z]:[\\/]/i.test(rawValue) || rawValue.startsWith("\\\\");
}

function isAuthDirWithinRuntimeRoot(value) {
  const normalizedValue = String(value || "").trim();

  if (!normalizedValue) {
    return true;
  }

  const relativePath = path.relative(baseAuthDir, normalizedValue);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function normalizeWhatsAppAuthDir(value, accountId) {
  const rawValue = String(value || "").trim();

  if (!rawValue) {
    return rawValue;
  }

  if (isExplicitAbsoluteAuthDir(rawValue)) {
    return rawValue;
  }

  const pathTokens = rawValue.split(/[\\/]+/).filter(Boolean);
  const accountDirToken =
    [...pathTokens]
      .reverse()
      .find((token) => /^account-[0-9a-f-]{36}$/i.test(token) || /^[0-9a-f-]{36}$/i.test(token)) ||
    "";

  if (accountDirToken) {
    return path.join(baseAuthDir, accountDirToken);
  }

  if (accountId) {
    return path.join(baseAuthDir, `account-${accountId}`);
  }

  return rawValue;
}

function isRuntimeCompatibleWhatsAppAuthDir(value) {
  const normalizedValue = normalizeWhatsAppAuthDir(value);
  return isAuthDirWithinRuntimeRoot(normalizedValue);
}

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
    id: customer.id, // Always include UUID
    status: normalizeCustomerStatus(customer.status, customer.notes),
    ...(Object.prototype.hasOwnProperty.call(customer, "notes") ? { notes: stripStoredStatusMetadata(customer.notes) } : {}),
    ...(Object.prototype.hasOwnProperty.call(customer, "premise_address") ? { premise_address: customer.premise_address } : {}),
    ...(Object.prototype.hasOwnProperty.call(customer, "business_type") ? { business_type: customer.business_type } : {}),
    ...(Object.prototype.hasOwnProperty.call(customer, "age") ? { age: customer.age } : {}),
    ...(Object.prototype.hasOwnProperty.call(customer, "email_address") ? { email_address: customer.email_address } : {})
  };
}

function isCustomerStatusConstraintError(error) {
  return error?.code === "23514" && String(error?.message || "").toLowerCase().includes("status");
}

function isMissingColumnError(error, columnName) {
  const errorMessage = String(error?.message || "");
  const lowerMessage = errorMessage.toLowerCase();
  const normalizedColumn = String(columnName || "");
  return (
    (error?.code === "42703" && errorMessage.includes(normalizedColumn)) ||
    (error?.code === "PGRST204" && errorMessage.includes(normalizedColumn)) ||
    // PostgREST schema cache / filter parsing can surface missing columns with varying codes.
    (normalizedColumn &&
      (lowerMessage.includes("could not find") || lowerMessage.includes("schema cache") || lowerMessage.includes("column")) &&
      errorMessage.includes(normalizedColumn))
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

function activeSessionsSchemaError(error) {
  const wrappedError = new Error(
    "Active dashboard sessions are not configured. Run backend/sql/2026-04-10_add_active_sessions.sql in Supabase before using single-session login."
  );
  wrappedError.status = 500;
  wrappedError.cause = error;
  return wrappedError;
}

function throwIfActiveSessionsSchemaError(error) {
  const errorMessage = String(error?.message || "");

  if (error?.code === "42P01" || errorMessage.includes("active_sessions")) {
    throw activeSessionsSchemaError(error);
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

function createEmptyStatusCounts() {
  return {
    new_lead: 0,
    interested: 0,
    processing: 0,
    closed_won: 0,
    closed_lost: 0
  };
}

function incrementStatusCount(statusCounts, status) {
  if (Object.prototype.hasOwnProperty.call(statusCounts, status)) {
    statusCounts[status] += 1;
  }
}

async function upsertProfileFromAuthUser(user) {
  const userId = String(user?.id || "").trim();

  if (!userId) {
    return null;
  }

  const email = String(user?.email || "").trim().toLowerCase() || null;
  const metadata = user?.user_metadata && typeof user.user_metadata === "object" ? user.user_metadata : {};
  const fullName =
    String(metadata.full_name || metadata.name || "").trim() || null;
  const avatarUrl = String(metadata.avatar_url || "").trim() || null;
  const lastSignInAt = user?.last_sign_in_at || null;

  const { data, error } = await supabase
    .from("profiles")
    .upsert(
      {
        id: userId,
        email,
        full_name: fullName,
        avatar_url: avatarUrl,
        last_sign_in_at: lastSignInAt,
        updated_at: new Date().toISOString()
      },
      { onConflict: "id" }
    )
    .select("id, email, full_name, avatar_url, last_sign_in_at")
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

async function getProfileByUserId(userId) {
  const normalizedUserId = String(userId || "").trim();

  if (!normalizedUserId) {
    return null;
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, avatar_url, last_sign_in_at, created_at, updated_at")
    .eq("id", normalizedUserId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

function applyWhatsAppAccountFilter(query, whatsappAccountId, columnName = "whatsapp_account_id") {
  if (!whatsappAccountId) {
    return query;
  }

  return query.eq(columnName, whatsappAccountId);
}

async function findMessageByWhatsAppId(owner_user_id, wa_message_id, whatsapp_account_id = null) {
  if (!owner_user_id || !wa_message_id) {
    return null;
  }

  let scopedQuery = supabase
    .from("messages")
    .select("*")
    .eq("owner_user_id", owner_user_id)
    .eq("wa_message_id", wa_message_id)
    .limit(1);

  scopedQuery = applyWhatsAppAccountFilter(scopedQuery, whatsapp_account_id);

  const scopedResult = await scopedQuery.maybeSingle();

  throwIfTenantSchemaError(scopedResult.error, "messages.owner_user_id");

  if (
    !isMissingColumnError(scopedResult.error, "messages.wa_message_id") &&
    !isMissingColumnError(scopedResult.error, "messages.whatsapp_account_id")
  ) {
    if (scopedResult.error) {
      throw scopedResult.error;
    }

    if (scopedResult.data) {
      return scopedResult.data;
    }
  }

  if (!whatsapp_account_id) {
    return null;
  }

  const unscopedResult = await supabase
    .from("messages")
    .select("*")
    .eq("owner_user_id", owner_user_id)
    .eq("wa_message_id", wa_message_id)
    .limit(1)
    .maybeSingle();

  throwIfTenantSchemaError(unscopedResult.error, "messages.owner_user_id");

  if (isMissingColumnError(unscopedResult.error, "messages.wa_message_id")) {
    return null;
  }

  if (unscopedResult.error) {
    throw unscopedResult.error;
  }

  return unscopedResult.data || null;
}

async function findExistingMessage({ owner_user_id, whatsapp_account_id, phone, chat_jid, wa_message_id, message, direction, created_at }) {
  if (wa_message_id) {
    const byWhatsAppId = await findMessageByWhatsAppId(owner_user_id, wa_message_id, whatsapp_account_id);
    if (byWhatsAppId) {
      return byWhatsAppId;
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

  fallbackQuery = applyWhatsAppAccountFilter(fallbackQuery, whatsapp_account_id);

  const fallback = await fallbackQuery.maybeSingle();

  throwIfTenantSchemaError(fallback.error, "messages.owner_user_id");

  if (
    isMissingColumnError(fallback.error, "messages.chat_jid") ||
    isMissingColumnError(fallback.error, "messages.whatsapp_account_id")
  ) {
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

async function findExistingCustomer({ owner_user_id, whatsapp_account_id, phone, chat_jid }) {
  if (chat_jid) {
    let byChatJidQuery = supabase
      .from("customers")
      .select("*")
      .eq("owner_user_id", owner_user_id)
      .eq("chat_jid", chat_jid)
      .order("updated_at", { ascending: false })
      .limit(1);

    byChatJidQuery = applyWhatsAppAccountFilter(byChatJidQuery, whatsapp_account_id);

    const byChatJid = await byChatJidQuery.maybeSingle();

    throwIfTenantSchemaError(byChatJid.error, "customers.owner_user_id");

    if (
      !isMissingColumnError(byChatJid.error, "customers.chat_jid") &&
      !isMissingColumnError(byChatJid.error, "customers.whatsapp_account_id")
    ) {
      if (byChatJid.error) {
        throw byChatJid.error;
      }

      if (byChatJid.data) {
        return byChatJid.data;
      }
    }
  }

  const lookupValues = await getPhoneLookupValues(phone, chat_jid || null);
  let existingQuery = supabase
    .from("customers")
    .select("*")
    .eq("owner_user_id", owner_user_id)
    .in("phone", lookupValues)
    .order("updated_at", { ascending: false })
    .limit(1);

  existingQuery = applyWhatsAppAccountFilter(existingQuery, whatsapp_account_id);

  const existing = await existingQuery.maybeSingle();

  throwIfTenantSchemaError(existing.error, "customers.owner_user_id");

  if (existing.error) {
    throw existing.error;
  }

  return existing.data || null;
}

async function findExistingCustomerByExactPhone({ owner_user_id, whatsapp_account_id, phone }) {
  const normalizedPhone = String(phone || "").trim();

  if (!normalizedPhone) {
    return null;
  }

  let existingQuery = supabase
    .from("customers")
    .select("*")
    .eq("owner_user_id", owner_user_id)
    .eq("phone", normalizedPhone)
    .order("updated_at", { ascending: false })
    .limit(1);

  existingQuery = applyWhatsAppAccountFilter(existingQuery, whatsapp_account_id);

  const existing = await existingQuery.maybeSingle();

  throwIfTenantSchemaError(existing.error, "customers.owner_user_id");

  if (existing.error) {
    throw existing.error;
  }

  return existing.data || null;
}

function mergeCustomerWritePayload({ primaryCustomer, secondaryCustomer, nextCustomer, chatJid }) {
  const mergedPhone = shouldPreserveExistingPhone(primaryCustomer?.phone, nextCustomer.phone, chatJid)
    ? primaryCustomer.phone
    : nextCustomer.phone;

  return {
    ...nextCustomer,
    phone: mergedPhone,
    chat_jid:
      nextCustomer.chat_jid !== undefined
        ? nextCustomer.chat_jid
        : primaryCustomer?.chat_jid || secondaryCustomer?.chat_jid || null,
    contact_name:
      nextCustomer.contact_name !== undefined
        ? nextCustomer.contact_name
        : primaryCustomer?.contact_name || secondaryCustomer?.contact_name || null,
    status:
      nextCustomer.status !== undefined
        ? nextCustomer.status
        : primaryCustomer?.status || secondaryCustomer?.status || "new_lead",
    notes:
      nextCustomer.notes !== undefined
        ? nextCustomer.notes
        : primaryCustomer?.notes || secondaryCustomer?.notes || "",
    profile_picture_url:
      nextCustomer.profile_picture_url !== undefined
        ? nextCustomer.profile_picture_url
        : primaryCustomer?.profile_picture_url || secondaryCustomer?.profile_picture_url || null,
    about:
      nextCustomer.about !== undefined
        ? nextCustomer.about
        : primaryCustomer?.about || secondaryCustomer?.about || null,
    unread_count:
      nextCustomer.unread_count !== undefined
        ? nextCustomer.unread_count
        : Math.max(primaryCustomer?.unread_count || 0, secondaryCustomer?.unread_count || 0)
  };
}

async function deleteCustomerById({ owner_user_id, customerId }) {
  if (!customerId) {
    return;
  }

  const { error } = await supabase
    .from("customers")
    .delete()
    .eq("owner_user_id", owner_user_id)
    .eq("id", customerId);

  throwIfTenantSchemaError(error, "customers.owner_user_id");

  if (error) {
    throw error;
  }
}

async function saveMessage({ owner_user_id, whatsapp_account_id, phone, chat_jid, wa_message_id, message, direction, send_status, created_at, media_type, media_mime_type, media_file_name, media_data_url }) {
  const existingMessage = await findExistingMessage({
    owner_user_id,
    whatsapp_account_id,
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
      ...(whatsapp_account_id ? { whatsapp_account_id } : {}),
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
    isMissingColumnError(error, "messages.whatsapp_account_id") ||
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
      whatsapp_account_id,
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

async function updateOutgoingMessageStatus({ owner_user_id, whatsapp_account_id, phone, chat_jid, wa_message_id, send_status, created_at }) {
  if (!wa_message_id || !send_status) {
    return null;
  }

  const updateFields = {
    send_status
  };

  if (created_at) {
    updateFields.created_at = created_at;
  }

  let query = supabase
    .from("messages")
    .update(updateFields)
    .eq("owner_user_id", owner_user_id)
    .eq("wa_message_id", wa_message_id)
    .eq("direction", "outgoing");

  query = applyWhatsAppAccountFilter(query, whatsapp_account_id);

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

  if (whatsapp_account_id) {
    const fallbackResult = await supabase
      .from("messages")
      .update(updateFields)
      .eq("owner_user_id", owner_user_id)
      .eq("wa_message_id", wa_message_id)
      .eq("direction", "outgoing")
      .select("*")
      .limit(1)
      .maybeSingle();

    throwIfTenantSchemaError(fallbackResult.error, "messages.owner_user_id");

    if (fallbackResult.error && !isMissingColumnError(fallbackResult.error, "messages.wa_message_id")) {
      throw fallbackResult.error;
    }

    if (fallbackResult.data) {
      return fallbackResult.data;
    }
  }

  return null;
}

async function getMessagesByPhone(phone, ownerUserId, chatJid, whatsappAccountId = null) {
  const lookupValues = await getPhoneLookupValues(phone, chatJid || null);
  const resolvedPhone = await resolveWhatsAppPhone(phone, chatJid || null);
  let data;
  let error;

  if (chatJid) {
    let byChatJidQuery = supabase
      .from("messages")
      .select("*")
      .eq("owner_user_id", ownerUserId)
      .eq("chat_jid", chatJid)
      .order("created_at", { ascending: true });
    byChatJidQuery = applyWhatsAppAccountFilter(byChatJidQuery, whatsappAccountId);

    let byPhoneQuery = lookupValues.length
      ? supabase
          .from("messages")
          .select("*")
          .eq("owner_user_id", ownerUserId)
          .in("phone", lookupValues)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [], error: null });

    if (lookupValues.length) {
      byPhoneQuery = applyWhatsAppAccountFilter(byPhoneQuery, whatsappAccountId);
    }

    let [byChatJid, byPhone] = await Promise.all([
      byChatJidQuery,
      byPhoneQuery
    ]);

    if (isMissingColumnError(byPhone.error, "messages.whatsapp_account_id")) {
      byPhone = await supabase
        .from("messages")
        .select("*")
        .eq("owner_user_id", ownerUserId)
        .in("phone", lookupValues)
        .order("created_at", { ascending: true });
    }

    if (
      isMissingColumnError(byChatJid.error, "messages.chat_jid") ||
      isMissingColumnError(byChatJid.error, "messages.whatsapp_account_id")
    ) {
      data = byPhone.data;
      error = byPhone.error;
    } else {
      data = Array.from(
        new Map(
          [...(byPhone.data || []), ...(byChatJid.data || [])].map((item) => [item.id, item])
        ).values()
      ).sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime());
      error = byChatJid.error || byPhone.error;
    }
  } else {
    if (!lookupValues.length) {
      return [];
    }

    let query = supabase
      .from("messages")
      .select("*")
      .eq("owner_user_id", ownerUserId)
      .in("phone", lookupValues)
      .order("created_at", { ascending: true });

    query = applyWhatsAppAccountFilter(query, whatsappAccountId);

    ({ data, error } = await query);

    if (isMissingColumnError(error, "messages.whatsapp_account_id")) {
      ({ data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("owner_user_id", ownerUserId)
        .in("phone", lookupValues)
        .order("created_at", { ascending: true }));
    }
  }

  throwIfTenantSchemaError(error, "messages.owner_user_id");

  if (error) {
    throw error;
  }

  return (data || []).map((item) => ({
    ...item,
    phone: resolvedPhone || item.phone
  }));
}

async function getConversationHistoryAnchor(phone, ownerUserId, chatJid, whatsappAccountId = null) {
  const lookupValues = await getPhoneLookupValues(phone, chatJid || null);
  let data;
  let error;

  if (chatJid) {
    let byChatJidQuery = supabase
      .from("messages")
      .select("id, phone, chat_jid, wa_message_id, direction, created_at")
      .eq("owner_user_id", ownerUserId)
      .eq("chat_jid", chatJid)
      .order("created_at", { ascending: true });
    byChatJidQuery = applyWhatsAppAccountFilter(byChatJidQuery, whatsappAccountId);

    let byPhoneQuery = lookupValues.length
      ? supabase
          .from("messages")
          .select("id, phone, chat_jid, wa_message_id, direction, created_at")
          .eq("owner_user_id", ownerUserId)
          .in("phone", lookupValues)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [], error: null });

    if (lookupValues.length) {
      byPhoneQuery = applyWhatsAppAccountFilter(byPhoneQuery, whatsappAccountId);
    }

    let [byChatJid, byPhone] = await Promise.all([byChatJidQuery, byPhoneQuery]);

    if (
      isMissingColumnError(byChatJid.error, "messages.chat_jid") ||
      isMissingColumnError(byChatJid.error, "messages.wa_message_id") ||
      isMissingColumnError(byChatJid.error, "messages.whatsapp_account_id")
    ) {
      byChatJid = { data: [], error: null };
    }

    if (
      isMissingColumnError(byPhone.error, "messages.wa_message_id") ||
      isMissingColumnError(byPhone.error, "messages.whatsapp_account_id")
    ) {
      byPhone = await supabase
        .from("messages")
        .select("id, phone, direction, created_at")
        .eq("owner_user_id", ownerUserId)
        .in("phone", lookupValues)
        .order("created_at", { ascending: true });
    }

    data = Array.from(
      new Map([...(byPhone.data || []), ...(byChatJid.data || [])].map((item) => [item.id, item])).values()
    ).sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime());
    error = byChatJid.error || byPhone.error;
  } else {
    if (!lookupValues.length) {
      return null;
    }

    let query = supabase
      .from("messages")
      .select("id, phone, chat_jid, wa_message_id, direction, created_at")
      .eq("owner_user_id", ownerUserId)
      .in("phone", lookupValues)
      .order("created_at", { ascending: true });
    query = applyWhatsAppAccountFilter(query, whatsappAccountId);

    ({ data, error } = await query);

    if (
      isMissingColumnError(error, "messages.chat_jid") ||
      isMissingColumnError(error, "messages.wa_message_id") ||
      isMissingColumnError(error, "messages.whatsapp_account_id")
    ) {
      ({ data, error } = await supabase
        .from("messages")
        .select("id, phone, direction, created_at")
        .eq("owner_user_id", ownerUserId)
        .in("phone", lookupValues)
        .order("created_at", { ascending: true }));
    }
  }

  throwIfTenantSchemaError(error, "messages.owner_user_id");

  if (error) {
    throw error;
  }

  const rows = Array.isArray(data) ? data : [];
  if (!rows.length) {
    return null;
  }

  const fetchableRow = rows.find((row) => row?.wa_message_id && row?.created_at) || null;
  const selectedRow = fetchableRow || rows[0];
  const resolvedPhone = await resolveWhatsAppPhone(selectedRow.phone, selectedRow.chat_jid || chatJid || null);

  return {
    ...selectedRow,
    phone: resolvedPhone || selectedRow.phone || phone || null,
    chat_jid: selectedRow.chat_jid || chatJid || null,
    wa_message_id: selectedRow.wa_message_id || null
  };
}

async function deleteMessage({ owner_user_id, message_id }) {
  const { data: existingMessage, error: lookupError } = await supabase
    .from("messages")
    .select("*")
    .eq("owner_user_id", owner_user_id)
    .eq("id", message_id)
    .maybeSingle();

  throwIfTenantSchemaError(lookupError, "messages.owner_user_id");

  if (lookupError) {
    throw lookupError;
  }

  if (!existingMessage) {
    const error = new Error("Message not found.");
    error.status = 404;
    throw error;
  }

  const { error } = await supabase
    .from("messages")
    .delete()
    .eq("owner_user_id", owner_user_id)
    .eq("id", message_id);

  throwIfTenantSchemaError(error, "messages.owner_user_id");

  if (error) {
    throw error;
  }

  return {
    ...existingMessage,
    phone: (await resolveWhatsAppPhone(existingMessage.phone, existingMessage.chat_jid || null)) || existingMessage.phone
  };
}

async function getConversations(ownerUserId, whatsappAccountId = null) {
  let messageQuery = supabase
    .from("messages")
    .select("phone, chat_jid, message, created_at, direction, whatsapp_account_id")
    .eq("owner_user_id", ownerUserId)
    .order("created_at", { ascending: false });
  let customerQuery = supabase
    .from("customers")
    .select("phone, chat_jid, status, contact_name, notes, unread_count, profile_picture_url, updated_at, whatsapp_account_id")
    .eq("owner_user_id", ownerUserId);
  let salesItemsQuery = supabase
    .from("customer_sales_items")
    .select("lead_status, phone, chat_jid")
    .eq("owner_user_id", ownerUserId);

  messageQuery = applyWhatsAppAccountFilter(messageQuery, whatsappAccountId);
  customerQuery = applyWhatsAppAccountFilter(customerQuery, whatsappAccountId);
  salesItemsQuery = applyWhatsAppAccountFilter(salesItemsQuery, whatsappAccountId);

  let [{ data: messageRows, error: messageError }, { data: customerRows, error: customerError }, { data: salesItemsRows, error: salesItemsError }] = await Promise.all([
    messageQuery,
    customerQuery,
    salesItemsQuery
  ]);

  throwIfTenantSchemaError(messageError, "messages.owner_user_id");
  throwIfTenantSchemaError(customerError, "customers.owner_user_id");
  throwIfSalesItemsSchemaError(salesItemsError);

  if (
    isMissingColumnError(messageError, "messages.chat_jid") ||
    isMissingColumnError(messageError, "messages.whatsapp_account_id")
  ) {
    ({ data: messageRows, error: messageError } = await supabase
      .from("messages")
      .select("phone, message, created_at, direction")
      .eq("owner_user_id", ownerUserId)
      .order("created_at", { ascending: false }));

    throwIfTenantSchemaError(messageError, "messages.owner_user_id");
  }

  if (
    isMissingColumnError(customerError, "customers.chat_jid") ||
    isMissingColumnError(customerError, "customers.profile_picture_url") ||
    isMissingColumnError(customerError, "customers.whatsapp_account_id")
  ) {
    ({ data: customerRows, error: customerError } = await supabase
      .from("customers")
      .select("phone, status, contact_name, notes, unread_count, updated_at")
      .eq("owner_user_id", ownerUserId));

    throwIfTenantSchemaError(customerError, "customers.owner_user_id");
  }

  if (
    isMissingColumnError(salesItemsError, "customer_sales_items.chat_jid") ||
    isMissingColumnError(salesItemsError, "customer_sales_items.whatsapp_account_id")
  ) {
    ({ data: salesItemsRows, error: salesItemsError } = await supabase
      .from("customer_sales_items")
      .select("lead_status, phone")
      .eq("owner_user_id", ownerUserId));
  }

  if (messageError) {
    throw messageError;
  }

  if (customerError) {
    console.warn("Customers lookup failed while building conversations. Falling back to default status.", customerError.message);
  }

  if (salesItemsError && isMissingColumnError(salesItemsError, "customer_sales_items.lead_status")) {
    salesItemsRows = null;
    salesItemsError = null;
  }

  if (salesItemsError) {
    throw salesItemsError;
  }

  let accountRows = [];
  const { data: loadedAccounts, error: accountError } = await supabase
    .from("whatsapp_accounts")
    .select("id, account_phone, display_name, connection_state")
    .eq("owner_user_id", ownerUserId);

  if (!accountError) {
    accountRows = loadedAccounts || [];
  }

  const accountMap = new Map(
    accountRows
      .filter((account) => account?.id)
      .map((account) => [account.id, account])
  );

  const customerMap = new Map();
  const customerChatJidMap = new Map();
  const statusCountsByPhone = new Map();
  const statusCountsByChatJid = new Map();
  const latestIncomingTimestampByPhone = new Map();
  const latestIncomingTimestampByChatJid = new Map();

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

  for (const row of salesItemsRows || []) {
    const resolvedPhone = await resolveWhatsAppPhone(row.phone, row.chat_jid || null);

    if (resolvedPhone) {
      const statusCounts = statusCountsByPhone.get(resolvedPhone) || createEmptyStatusCounts();
      incrementStatusCount(statusCounts, row.lead_status);
      statusCountsByPhone.set(resolvedPhone, statusCounts);
    }

    if (row.chat_jid) {
      const statusCounts = statusCountsByChatJid.get(row.chat_jid) || createEmptyStatusCounts();
      incrementStatusCount(statusCounts, row.lead_status);
      statusCountsByChatJid.set(row.chat_jid, statusCounts);
    }
  }

  for (const row of messageRows || []) {
    if (row.direction !== "incoming") {
      continue;
    }

    const resolvedPhone = await resolveWhatsAppPhone(row.phone, row.chat_jid || null);

    if (resolvedPhone && !latestIncomingTimestampByPhone.has(resolvedPhone)) {
      latestIncomingTimestampByPhone.set(resolvedPhone, row.created_at);
    }

    if (row.chat_jid && !latestIncomingTimestampByChatJid.has(row.chat_jid)) {
      latestIncomingTimestampByChatJid.set(row.chat_jid, row.created_at);
    }
  }

  const seen = new Set();
  const conversations = [];

  for (const row of messageRows || []) {
    const resolvedPhone = await resolveWhatsAppPhone(row.phone, row.chat_jid || null);
    const matchedCustomer = customerMap.get(resolvedPhone) || customerChatJidMap.get(row.chat_jid) || null;
    const conversationKey = resolvedPhone || row.chat_jid || matchedCustomer?.chat_jid || null;

    if (!conversationKey || seen.has(conversationKey)) {
      continue;
    }

    seen.add(conversationKey);
    const statusCounts =
      statusCountsByChatJid.get(matchedCustomer?.chat_jid || row.chat_jid || "") ||
      (resolvedPhone ? statusCountsByPhone.get(resolvedPhone) : null) ||
      createEmptyStatusCounts();
    const activeStatuses = Object.entries(statusCounts)
      .filter(([, count]) => count > 0)
      .map(([status]) => status);
    const sourceAccountId = matchedCustomer?.whatsapp_account_id || row.whatsapp_account_id || null;
    const sourceAccount = sourceAccountId ? accountMap.get(sourceAccountId) || null : null;

    conversations.push({
      phone: resolvedPhone || matchedCustomer?.phone || row.phone || "",
      chatJid: matchedCustomer?.chat_jid || row.chat_jid || null,
      whatsappAccountId: sourceAccountId,
      sourceAccountPhone: sourceAccount?.account_phone || null,
      sourceDisplayName: sourceAccount?.display_name || null,
      sourceConnectionState: sourceAccount?.connection_state || null,
      contactName: matchedCustomer?.contact_name || null,
      profilePictureUrl: matchedCustomer?.profile_picture_url || null,
      lastMessage: row.message,
      timestamp: row.created_at,
      latestReceivedAt:
        latestIncomingTimestampByChatJid.get(matchedCustomer?.chat_jid || row.chat_jid || "") ||
        (resolvedPhone ? latestIncomingTimestampByPhone.get(resolvedPhone) : null) ||
        null,
      lastDirection: row.direction,
      status: activeStatuses[0] || null,
      status_counts: statusCounts,
      unreadCount: matchedCustomer?.unread_count || 0
    });
  }

  for (const customer of customerRows || []) {
    const resolvedPhone = await resolveWhatsAppPhone(customer.phone, customer.chat_jid || null);
    const conversationKey = resolvedPhone || customer.chat_jid || customer.phone || null;

    if (!conversationKey || seen.has(conversationKey)) {
      continue;
    }

    seen.add(conversationKey);
    const statusCounts =
      statusCountsByChatJid.get(customer.chat_jid || "") ||
      (resolvedPhone ? statusCountsByPhone.get(resolvedPhone) : null) ||
      createEmptyStatusCounts();
    const activeStatuses = Object.entries(statusCounts)
      .filter(([, count]) => count > 0)
      .map(([status]) => status);
    const sourceAccountId = customer.whatsapp_account_id || null;
    const sourceAccount = sourceAccountId ? accountMap.get(sourceAccountId) || null : null;

    conversations.push({
      phone: resolvedPhone || customer.phone || "",
      chatJid: customer.chat_jid || null,
      whatsappAccountId: sourceAccountId,
      sourceAccountPhone: sourceAccount?.account_phone || null,
      sourceDisplayName: sourceAccount?.display_name || null,
      sourceConnectionState: sourceAccount?.connection_state || null,
      contactName: customer.contact_name || null,
      profilePictureUrl: customer.profile_picture_url || null,
      lastMessage: "No synced messages yet",
      timestamp: customer.updated_at || new Date().toISOString(),
      latestReceivedAt:
        latestIncomingTimestampByChatJid.get(customer.chat_jid || "") ||
        (resolvedPhone ? latestIncomingTimestampByPhone.get(resolvedPhone) : null) ||
        null,
      lastDirection: "incoming",
      status: activeStatuses[0] || null,
      status_counts: statusCounts,
      unreadCount: customer.unread_count || 0
    });
  }

  return conversations.sort((left, right) => {
    const leftTimestamp = new Date(left.timestamp || left.latestReceivedAt || 0).getTime();
    const rightTimestamp = new Date(right.timestamp || right.latestReceivedAt || 0).getTime();
    return rightTimestamp - leftTimestamp;
  });
}

async function getCustomerByPhone(phone, ownerUserId, chatJid, whatsappAccountId = null) {
  let data = null;
  let error = null;

  if (chatJid) {
    let query = supabase
      .from("customers")
      .select("*")
      .eq("owner_user_id", ownerUserId)
      .eq("chat_jid", chatJid)
      .order("updated_at", { ascending: false })
      .limit(1);
    query = applyWhatsAppAccountFilter(query, whatsappAccountId);
    ({ data, error } = await query.maybeSingle());

    throwIfTenantSchemaError(error, "customers.owner_user_id");

    if (
      !isMissingColumnError(error, "customers.chat_jid") &&
      !isMissingColumnError(error, "customers.whatsapp_account_id") &&
      (error || data)
    ) {
      if (error) {
        throw error;
      }

      const resolvedPhone = await resolveWhatsAppPhone(phone, data?.chat_jid || chatJid || null);

      const normalizedCustomer = normalizeCustomerRecord(
        data || {
          phone: resolvedPhone || phone,
          chat_jid: chatJid,
          contact_name: null,
          status: "new_lead",
          notes: ""
        }
      );

      return {
        ...normalizedCustomer,
        phone: resolvedPhone || normalizedCustomer.phone || phone,
        chat_jid: normalizedCustomer.chat_jid || chatJid || null
      };
    }
  }

  const lookupValues = await getPhoneLookupValues(phone, chatJid || null);
  let query = supabase
    .from("customers")
    .select("*")
    .eq("owner_user_id", ownerUserId)
    .in("phone", lookupValues)
    .order("updated_at", { ascending: false })
    .limit(1);
  query = applyWhatsAppAccountFilter(query, whatsappAccountId);
  ({ data, error } = await query.maybeSingle());

  if (isMissingColumnError(error, "customers.whatsapp_account_id")) {
    ({ data, error } = await supabase
      .from("customers")
      .select("*")
      .eq("owner_user_id", ownerUserId)
      .in("phone", lookupValues)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle());
  }

  throwIfTenantSchemaError(error, "customers.owner_user_id");

  if (error) {
    throw error;
  }

  const resolvedPhone = await resolveWhatsAppPhone(phone, data?.chat_jid || chatJid || null);

  const normalizedCustomer = normalizeCustomerRecord(
    data || {
      phone: resolvedPhone || phone,
      chat_jid: chatJid || null,
      contact_name: null,
      status: "new_lead",
      notes: ""
    }
  );

  return {
    ...normalizedCustomer,
    phone: resolvedPhone || normalizedCustomer.phone || phone,
    chat_jid: normalizedCustomer.chat_jid || chatJid || null
  };
}

async function getCustomerInsights(phone, ownerUserId, chatJid, whatsappAccountId = null) {
  const customer = await getCustomerByPhone(phone, ownerUserId, chatJid, whatsappAccountId);
  const scopedChatJid = customer?.chat_jid || chatJid || null;
  const lookupValues = await getPhoneLookupValues(phone, scopedChatJid);
  const canonicalPhone = await resolveWhatsAppPhone(phone, scopedChatJid);
  let messages;
  let error;

  if (scopedChatJid) {
    let byChatJidQuery = supabase
      .from("messages")
      .select("id, direction, created_at, message")
      .eq("owner_user_id", ownerUserId)
      .eq("chat_jid", scopedChatJid)
      .order("created_at", { ascending: false });
    byChatJidQuery = applyWhatsAppAccountFilter(byChatJidQuery, whatsappAccountId);

    let byPhoneQuery = supabase
      .from("messages")
      .select("id, direction, created_at, message")
      .eq("owner_user_id", ownerUserId)
      .in("phone", lookupValues)
      .order("created_at", { ascending: false });
    byPhoneQuery = applyWhatsAppAccountFilter(byPhoneQuery, whatsappAccountId);

    let [byChatJid, byPhone] = await Promise.all([
      byChatJidQuery,
      byPhoneQuery
    ]);

    if (isMissingColumnError(byPhone.error, "messages.whatsapp_account_id")) {
      byPhone = await supabase
        .from("messages")
        .select("id, direction, created_at, message")
        .eq("owner_user_id", ownerUserId)
        .in("phone", lookupValues)
        .order("created_at", { ascending: false });
    }

    if (
      isMissingColumnError(byChatJid.error, "messages.chat_jid") ||
      isMissingColumnError(byChatJid.error, "messages.whatsapp_account_id")
    ) {
      messages = byPhone.data;
      error = byPhone.error;
    } else {
      messages = Array.from(
        new Map(
          [...(byPhone.data || []), ...(byChatJid.data || [])].map((item) => [item.id, item])
        ).values()
      ).sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());
      error = byChatJid.error || byPhone.error;
    }
  } else {
    let query = supabase
      .from("messages")
      .select("id, direction, created_at, message")
      .eq("owner_user_id", ownerUserId)
      .in("phone", lookupValues)
      .order("created_at", { ascending: false });
    query = applyWhatsAppAccountFilter(query, whatsappAccountId);
    ({ data: messages, error } = await query);

    if (isMissingColumnError(error, "messages.whatsapp_account_id")) {
      ({ data: messages, error } = await supabase
        .from("messages")
        .select("id, direction, created_at, message")
        .eq("owner_user_id", ownerUserId)
        .in("phone", lookupValues)
        .order("created_at", { ascending: false }));
    }
  }

  throwIfTenantSchemaError(error, "messages.owner_user_id");

  if (error) {
    throw error;
  }

  let salesItemsStatusCounts = null;
  let salesItemsError = null;

  let salesItemsQuery = supabase
    .from("customer_sales_items")
    .select("lead_status, phone, chat_jid")
    .eq("owner_user_id", ownerUserId);
  salesItemsQuery = applyWhatsAppAccountFilter(salesItemsQuery, whatsappAccountId);
  ({ data: salesItemsStatusCounts, error: salesItemsError } = await salesItemsQuery);

  throwIfSalesItemsSchemaError(salesItemsError);

  if (salesItemsError && isMissingColumnError(salesItemsError, "customer_sales_items.lead_status")) {
    salesItemsStatusCounts = null;
    salesItemsError = null;
  }

  if (salesItemsError) {
    throw salesItemsError;
  }

  const rows = messages || [];
  const incomingCount = rows.filter((item) => item.direction === "incoming").length;
  const outgoingCount = rows.filter((item) => item.direction === "outgoing").length;
  const latestMessage = rows[0] || null;
  const statusCounts = createEmptyStatusCounts();

  if (salesItemsStatusCounts) {
    for (const row of salesItemsStatusCounts) {
      const rowResolvedPhone = await resolveWhatsAppPhone(row.phone, row.chat_jid || null);

      if (!canonicalPhone || rowResolvedPhone !== canonicalPhone) {
        continue;
      }

      if (Object.prototype.hasOwnProperty.call(statusCounts, row.lead_status)) {
        statusCounts[row.lead_status] += 1;
      }
    }
  } else {
    const { data: customerRows, error: customerRowsError } = await supabase
      .from("customers")
      .select("status, notes, phone, chat_jid")
      .eq("owner_user_id", ownerUserId);

    throwIfTenantSchemaError(customerRowsError, "customers.owner_user_id");

    if (customerRowsError) {
      throw customerRowsError;
    }

    for (const row of customerRows || []) {
      const rowResolvedPhone = await resolveWhatsAppPhone(row.phone, row.chat_jid || null);

      if (!canonicalPhone || rowResolvedPhone !== canonicalPhone) {
        continue;
      }

      const normalizedStatus = normalizeCustomerStatus(row.status, row.notes);

      if (Object.prototype.hasOwnProperty.call(statusCounts, normalizedStatus)) {
        statusCounts[normalizedStatus] += 1;
      }
    }
  }

  return {
    ...customer,
    profile_picture_url: customer.profile_picture_url || null,
    about: customer.about || null,
    status_counts: statusCounts,
    total_messages: rows.length,
    incoming_count: incomingCount,
    outgoing_count: outgoingCount,
    last_message_at: latestMessage?.created_at || null,
    last_message_preview: latestMessage?.message || null,
    last_direction: latestMessage?.direction || null
  };
}

async function clearConversationUnreadCount({ owner_user_id, whatsapp_account_id, phone, chat_jid }) {
  const existingCustomer = await findExistingCustomer({
    owner_user_id,
    whatsapp_account_id,
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

async function deleteConversation({ owner_user_id, whatsapp_account_id, phone, chat_jid }) {
  const lookupValues = await getPhoneLookupValues(phone, chat_jid || null);
  const targetChatJid = String(chat_jid || "").trim() || null;

  const [messageRowsByPhone, messageRowsByChatJid, customerRowsByPhone, customerRowsByChatJid] = await Promise.all([
    lookupValues.length
      ? applyWhatsAppAccountFilter(
          supabase
            .from("messages")
            .select("id")
            .eq("owner_user_id", owner_user_id)
            .in("phone", lookupValues),
          whatsapp_account_id
        )
      : Promise.resolve({ data: [], error: null }),
    targetChatJid
      ? applyWhatsAppAccountFilter(
          supabase
            .from("messages")
            .select("id")
            .eq("owner_user_id", owner_user_id)
            .eq("chat_jid", targetChatJid),
          whatsapp_account_id
        )
      : Promise.resolve({ data: [], error: null }),
    lookupValues.length
      ? applyWhatsAppAccountFilter(
          supabase
            .from("customers")
            .select("id")
            .eq("owner_user_id", owner_user_id)
            .in("phone", lookupValues),
          whatsapp_account_id
        )
      : Promise.resolve({ data: [], error: null }),
    targetChatJid
      ? applyWhatsAppAccountFilter(
          supabase
            .from("customers")
            .select("id")
            .eq("owner_user_id", owner_user_id)
            .eq("chat_jid", targetChatJid),
          whatsapp_account_id
        )
      : Promise.resolve({ data: [], error: null })
  ]);

  throwIfTenantSchemaError(messageRowsByPhone.error, "messages.owner_user_id");
  throwIfTenantSchemaError(customerRowsByPhone.error, "customers.owner_user_id");

  if (!isMissingColumnError(messageRowsByChatJid.error, "messages.chat_jid")) {
    throwIfTenantSchemaError(messageRowsByChatJid.error, "messages.owner_user_id");
  }

  if (!isMissingColumnError(customerRowsByChatJid.error, "customers.chat_jid")) {
    throwIfTenantSchemaError(customerRowsByChatJid.error, "customers.owner_user_id");
  }

  if (messageRowsByPhone.error) {
    throw messageRowsByPhone.error;
  }

  if (customerRowsByPhone.error) {
    throw customerRowsByPhone.error;
  }

  if (messageRowsByChatJid.error && !isMissingColumnError(messageRowsByChatJid.error, "messages.chat_jid")) {
    throw messageRowsByChatJid.error;
  }

  if (customerRowsByChatJid.error && !isMissingColumnError(customerRowsByChatJid.error, "customers.chat_jid")) {
    throw customerRowsByChatJid.error;
  }

  const messageIds = Array.from(
    new Set([
      ...(messageRowsByPhone.data || []).map((row) => row.id),
      ...(messageRowsByChatJid.data || []).map((row) => row.id)
    ].filter(Boolean))
  );

  const customerIds = Array.from(
    new Set([
      ...(customerRowsByPhone.data || []).map((row) => row.id),
      ...(customerRowsByChatJid.data || []).map((row) => row.id)
    ].filter(Boolean))
  );

  if (messageIds.length) {
    let deleteQuery = supabase
      .from("messages")
      .delete()
      .eq("owner_user_id", owner_user_id)
      .in("id", messageIds);

    deleteQuery = applyWhatsAppAccountFilter(deleteQuery, whatsapp_account_id);

    const { error } = await deleteQuery;

    throwIfTenantSchemaError(error, "messages.owner_user_id");

    if (error) {
      throw error;
    }
  }

  if (customerIds.length) {
    let deleteQuery = supabase
      .from("customers")
      .delete()
      .eq("owner_user_id", owner_user_id)
      .in("id", customerIds);

    deleteQuery = applyWhatsAppAccountFilter(deleteQuery, whatsapp_account_id);

    const { error } = await deleteQuery;

    throwIfTenantSchemaError(error, "customers.owner_user_id");

    if (error) {
      throw error;
    }
  }

  return {
    deletedMessages: messageIds.length,
    deletedCustomers: customerIds.length
  };
}

async function upsertCustomer({ owner_user_id, whatsapp_account_id, phone, chat_jid, contact_name, status, notes, profile_picture_url, about, unread_count, premise_address, business_type, age, email_address }) {
  const canonicalPhone = await resolveWhatsAppPhone(phone, chat_jid || null);
  const payload = {
    owner_user_id,
    ...(whatsapp_account_id ? { whatsapp_account_id } : {}),
    phone: canonicalPhone || phone,
    ...(chat_jid !== undefined ? { chat_jid } : {}),
    ...(contact_name !== undefined ? { contact_name } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(notes !== undefined ? { notes } : {}),
    ...(profile_picture_url !== undefined ? { profile_picture_url } : {}),
    ...(about !== undefined ? { about } : {}),
    ...(unread_count !== undefined ? { unread_count } : {}),
    ...(premise_address !== undefined ? { premise_address } : {}),
    ...(business_type !== undefined ? { business_type } : {}),
    ...(age !== undefined ? { age } : {}),
    ...(email_address !== undefined ? { email_address } : {}),
    updated_at: new Date().toISOString()
  };
  let writePayload = payload;

  let existingCustomer = await findExistingCustomer({
    owner_user_id,
    whatsapp_account_id,
    phone,
    chat_jid
  });

  const phoneOwnedCustomer = await findExistingCustomerByExactPhone({
    owner_user_id,
    whatsapp_account_id,
    phone: writePayload.phone
  });

  if (existingCustomer?.id && phoneOwnedCustomer?.id && existingCustomer.id !== phoneOwnedCustomer.id) {
    const primaryCustomer = phoneOwnedCustomer;
    const secondaryCustomer = existingCustomer;

    writePayload = mergeCustomerWritePayload({
      primaryCustomer,
      secondaryCustomer,
      nextCustomer: writePayload,
      chatJid: chat_jid
    });

    await deleteCustomerById({
      owner_user_id,
      customerId: secondaryCustomer.id
    });

    existingCustomer = primaryCustomer;
  } else if (!existingCustomer && phoneOwnedCustomer?.id) {
    existingCustomer = phoneOwnedCustomer;
  }

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

  if (
    isMissingColumnError(error, "customers.profile_picture_url") ||
    isMissingColumnError(error, "customers.about") ||
    isMissingColumnError(error, "customers.whatsapp_account_id")
  ) {
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

async function getCustomerOwnerIdsByPhone(phone, chatJid) {
  const lookupValues = await getPhoneLookupValues(phone, chatJid || null);
  const normalizedChatJid = String(chatJid || "").trim() || null;

  const customerByPhoneQuery = lookupValues.length
    ? supabase
        .from("customers")
        .select("owner_user_id")
        .in("phone", lookupValues)
        .not("owner_user_id", "is", null)
    : Promise.resolve({ data: [], error: null });

  const customerByChatQuery = normalizedChatJid
    ? supabase
        .from("customers")
        .select("owner_user_id")
        .eq("chat_jid", normalizedChatJid)
        .not("owner_user_id", "is", null)
    : Promise.resolve({ data: [], error: null });

  const messageByPhoneQuery = lookupValues.length
    ? supabase
        .from("messages")
        .select("owner_user_id")
        .in("phone", lookupValues)
        .not("owner_user_id", "is", null)
    : Promise.resolve({ data: [], error: null });

  const messageByChatQuery = normalizedChatJid
    ? supabase
        .from("messages")
        .select("owner_user_id")
        .eq("chat_jid", normalizedChatJid)
        .not("owner_user_id", "is", null)
    : Promise.resolve({ data: [], error: null });

  const [customerByPhone, customerByChat, messageByPhone, messageByChat] = await Promise.all([
    customerByPhoneQuery,
    customerByChatQuery,
    messageByPhoneQuery,
    messageByChatQuery
  ]);

  throwIfTenantSchemaError(customerByPhone.error, "customers.owner_user_id");
  throwIfTenantSchemaError(customerByChat.error, "customers.owner_user_id");
  throwIfTenantSchemaError(messageByPhone.error, "messages.owner_user_id");
  throwIfTenantSchemaError(messageByChat.error, "messages.owner_user_id");

  if (customerByPhone.error) {
    throw customerByPhone.error;
  }

  if (customerByChat.error) {
    throw customerByChat.error;
  }

  if (messageByPhone.error) {
    throw messageByPhone.error;
  }

  if (messageByChat.error) {
    throw messageByChat.error;
  }

  return Array.from(
    new Set(
      [
        ...(customerByPhone.data || []),
        ...(customerByChat.data || []),
        ...(messageByPhone.data || []),
        ...(messageByChat.data || [])
      ]
        .map((row) => row.owner_user_id)
        .filter(Boolean)
    )
  );
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

async function getWhatsAppAccounts(ownerUserId) {
  const { data, error } = await supabase
    .from("whatsapp_accounts")
    .select("*")
    .eq("owner_user_id", ownerUserId)
    .order("updated_at", { ascending: false });

  if (error && error.code !== "42P01") {
    throw error;
  }

  return data || [];
}

async function getWhatsAppAccountById(ownerUserId, accountId) {
  if (!ownerUserId || !accountId) {
    return null;
  }

  const { data, error } = await supabase
    .from("whatsapp_accounts")
    .select("*")
    .eq("owner_user_id", ownerUserId)
    .eq("id", accountId)
    .maybeSingle();

  if (error && error.code !== "42P01") {
    throw error;
  }

  return data || null;
}

function normalizeAccountPhoneForKey(phone) {
  return String(phone || "").replace(/\D/g, "");
}

async function cleanupStaleWhatsAppAccounts(ownerUserId) {
  if (!ownerUserId) {
    return {
      removedInvalidCount: 0,
      removedDuplicateCount: 0,
      removedIds: [],
      remainingCount: 0
    };
  }

  const accounts = (await getWhatsAppAccounts(ownerUserId)).filter((account) =>
    isRuntimeCompatibleWhatsAppAuthDir(account?.auth_dir)
  );
  const removedIds = new Set();

  for (const account of accounts) {
    const phoneKey = normalizeAccountPhoneForKey(account?.account_phone);
    if (!phoneKey && account?.connection_state !== "open") {
      removedIds.add(account.id);
    }
  }

  const removedIdList = Array.from(removedIds);

  if (removedIdList.length) {
    const { error } = await supabase
      .from("whatsapp_accounts")
      .delete()
      .eq("owner_user_id", ownerUserId)
      .in("id", removedIdList);

    if (error && error.code !== "42P01") {
      throw error;
    }
  }

  const invalidIds = accounts
    .filter((account) => {
      const phoneKey = normalizeAccountPhoneForKey(account?.account_phone);
      return !phoneKey && account?.connection_state !== "open" && removedIds.has(account.id);
    })
    .map((account) => account.id);

  return {
    removedInvalidCount: invalidIds.length,
    removedDuplicateCount: 0,
    removedIds: removedIdList,
    remainingCount: Math.max(accounts.length - removedIdList.length, 0)
  };
}

async function getLatestWhatsAppAccount(ownerUserId) {
  const { data, error } = await supabase
    .from("whatsapp_accounts")
    .select("*")
    .eq("owner_user_id", ownerUserId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error && error.code !== "42P01") {
    throw error;
  }

  return data || null;
}

async function upsertWhatsAppAccount({
  id,
  owner_user_id,
  account_phone,
  account_jid,
  display_name,
  profile_picture_url,
  auth_dir,
  connection_state,
  is_active,
  last_connected_at
}) {
  const now = new Date().toISOString();
  const normalizedAuthDir = auth_dir !== undefined ? normalizeWhatsAppAuthDir(auth_dir, id || null) : undefined;
  const candidates = [];

  if (id) {
    candidates.push(
      supabase
        .from("whatsapp_accounts")
        .select("*")
        .eq("owner_user_id", owner_user_id)
        .eq("id", id)
        .limit(1)
        .maybeSingle()
    );
  }

  if (normalizedAuthDir) {
    candidates.push(
      supabase
        .from("whatsapp_accounts")
        .select("*")
        .eq("owner_user_id", owner_user_id)
        .eq("auth_dir", normalizedAuthDir)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    );
  }

  const results = await Promise.all(candidates);
  const existingAccount = results.map((result) => result.data).find(Boolean) || null;
  const persistedAuthDir = auth_dir !== undefined
    ? normalizeWhatsAppAuthDir(auth_dir, id || existingAccount?.id || null)
    : undefined;
  const payload = {
    owner_user_id,
    ...(account_phone !== undefined ? { account_phone } : {}),
    ...(account_jid !== undefined ? { account_jid } : {}),
    ...(display_name !== undefined ? { display_name } : {}),
    ...(profile_picture_url !== undefined ? { profile_picture_url } : {}),
    ...(persistedAuthDir !== undefined ? { auth_dir: persistedAuthDir } : {}),
    ...(connection_state !== undefined ? { connection_state } : {}),
    ...(is_active !== undefined ? { is_active } : {}),
    ...(last_connected_at !== undefined ? { last_connected_at } : {}),
    updated_at: now
  };

  if (existingAccount?.id) {
    const { data, error } = await supabase
      .from("whatsapp_accounts")
      .update(payload)
      .eq("id", existingAccount.id)
      .select("*")
      .single();

    if (error && error.code !== "42P01") {
      throw error;
    }

    return data || existingAccount;
  }

  const { data, error } = await supabase
    .from("whatsapp_accounts")
    .insert(payload)
    .select("*")
    .single();

  if (error && error.code !== "42P01") {
    throw error;
  }

  return data || null;
}

async function getCustomerSalesItems(phone, ownerUserId, chatJid, whatsappAccountId = null) {
  const lookupValues = await getPhoneLookupValues(phone, chatJid || null);
  let data;
  let error;

  if (chatJid) {
    let byChatJidQuery = supabase
      .from("customer_sales_items")
      .select("id, message_id, phone, chat_jid, lead_status, product_type, package_name, price, quantity, created_at, updated_at")
      .eq("owner_user_id", ownerUserId)
      .eq("chat_jid", chatJid)
      .order("created_at", { ascending: false });
    byChatJidQuery = applyWhatsAppAccountFilter(byChatJidQuery, whatsappAccountId);

    let byPhoneQuery = supabase
      .from("customer_sales_items")
      .select("id, message_id, phone, chat_jid, lead_status, product_type, package_name, price, quantity, created_at, updated_at")
      .eq("owner_user_id", ownerUserId)
      .in("phone", lookupValues)
      .order("created_at", { ascending: false });
    byPhoneQuery = applyWhatsAppAccountFilter(byPhoneQuery, whatsappAccountId);

    const [byChatJid, byPhone] = await Promise.all([
      byChatJidQuery,
      byPhoneQuery
    ]);

    if (
      isMissingColumnError(byChatJid.error, "customer_sales_items.chat_jid") ||
      isMissingColumnError(byChatJid.error, "customer_sales_items.whatsapp_account_id")
    ) {
      data = byPhone.data;
      error = byPhone.error;
    } else {
      data = Array.from(
        new Map(
          [...(byPhone.data || []), ...(byChatJid.data || [])].map((item) => [item.id, item])
        ).values()
      ).sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime());
      error = byChatJid.error || byPhone.error;
    }
  } else {
    let query = supabase
      .from("customer_sales_items")
      .select("id, message_id, phone, chat_jid, lead_status, product_type, package_name, price, quantity, created_at, updated_at")
      .eq("owner_user_id", ownerUserId)
      .in("phone", lookupValues)
      .order("created_at", { ascending: false });
    query = applyWhatsAppAccountFilter(query, whatsappAccountId);
    ({ data, error } = await query);

    if (isMissingColumnError(error, "customer_sales_items.whatsapp_account_id")) {
      ({ data, error } = await supabase
        .from("customer_sales_items")
        .select("id, message_id, phone, chat_jid, lead_status, product_type, package_name, price, quantity, created_at, updated_at")
        .eq("owner_user_id", ownerUserId)
        .in("phone", lookupValues)
        .order("created_at", { ascending: false }));
    }
  }

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

async function getAllCustomerSalesItems(ownerUserId, whatsappAccountId = null) {
  let query = supabase
    .from("customer_sales_items")
    .select("id, message_id, phone, chat_jid, lead_status, product_type, package_name, price, quantity, created_at, updated_at")
    .eq("owner_user_id", ownerUserId)
    .order("created_at", { ascending: false });

  query = applyWhatsAppAccountFilter(query, whatsappAccountId);

  let { data, error } = await query;

  if (
    isMissingColumnError(error, "customer_sales_items.chat_jid") ||
    isMissingColumnError(error, "customer_sales_items.whatsapp_account_id")
  ) {
    ({ data, error } = await supabase
      .from("customer_sales_items")
      .select("id, message_id, phone, lead_status, product_type, package_name, price, quantity, created_at, updated_at")
      .eq("owner_user_id", ownerUserId)
      .order("created_at", { ascending: false }));
  }

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

async function getOwnedCustomerSalesItem(itemId, ownerUserId) {
  const { data, error } = await supabase
    .from("customer_sales_items")
    .select("id, phone, chat_jid")
    .eq("owner_user_id", ownerUserId)
    .eq("id", itemId)
    .maybeSingle();

  throwIfSalesItemsSchemaError(error);

  if (error) {
    throw error;
  }

  return data || null;
}

async function salesItemBelongsToCustomerConversation({ phone, chat_jid, salesItem }) {
  const targetChatJid = String(chat_jid || "").trim() || null;
  const itemChatJid = String(salesItem?.chat_jid || "").trim() || null;

  if (targetChatJid && itemChatJid) {
    return targetChatJid === itemChatJid;
  }

  const [targetLookupValues, itemLookupValues] = await Promise.all([
    getPhoneLookupValues(phone, targetChatJid),
    getPhoneLookupValues(salesItem?.phone, itemChatJid)
  ]);

  const targetIdentifiers = new Set(targetLookupValues.map((value) => normalizePhone(value)).filter(Boolean));

  for (const identifier of itemLookupValues.map((value) => normalizePhone(value)).filter(Boolean)) {
    if (targetIdentifiers.has(identifier)) {
      return true;
    }
  }

  const [canonicalPhone, itemPhone] = await Promise.all([
    resolveWhatsAppPhone(phone, targetChatJid),
    resolveWhatsAppPhone(salesItem?.phone, itemChatJid)
  ]);

  return Boolean(canonicalPhone && itemPhone && canonicalPhone === itemPhone);
}

async function messageBelongsToCustomerConversation({ phone, chat_jid, messageRecord }) {
  const targetChatJid = String(chat_jid || "").trim() || null;
  const messageChatJid = String(messageRecord?.chat_jid || "").trim() || null;

  if (targetChatJid && messageChatJid) {
    return targetChatJid === messageChatJid;
  }

  const [targetLookupValues, messageLookupValues] = await Promise.all([
    getPhoneLookupValues(phone, targetChatJid),
    getPhoneLookupValues(messageRecord?.phone, messageChatJid)
  ]);

  const targetIdentifiers = new Set(targetLookupValues.map((value) => normalizePhone(value)).filter(Boolean));

  for (const identifier of messageLookupValues.map((value) => normalizePhone(value)).filter(Boolean)) {
    if (targetIdentifiers.has(identifier)) {
      return true;
    }
  }

  const [canonicalPhone, messagePhone] = await Promise.all([
    resolveWhatsAppPhone(phone, targetChatJid),
    resolveWhatsAppPhone(messageRecord?.phone, messageChatJid)
  ]);

  return Boolean(canonicalPhone && messagePhone && canonicalPhone === messagePhone);
}

async function createCustomerSalesItem({ owner_user_id, whatsapp_account_id, message_id, phone, chat_jid, lead_status, product_type, package_name, price, quantity }) {
  const messageRecord = await getOwnedMessageRecord(message_id, owner_user_id);

  if (!messageRecord) {
    const error = new Error("Linked message was not found for this customer conversation.");
    error.status = 404;
    throw error;
  }

  const canonicalPhone = await resolveWhatsAppPhone(phone, chat_jid || null);

  const belongsToConversation = await messageBelongsToCustomerConversation({
    phone,
    chat_jid,
    messageRecord
  });

  if (!belongsToConversation) {
    const error = new Error("The selected message does not belong to this customer conversation.");
    error.status = 400;
    throw error;
  }

  const payload = {
    owner_user_id,
    ...(whatsapp_account_id ? { whatsapp_account_id } : {}),
    message_id,
    phone: canonicalPhone || phone,
    ...(chat_jid ? { chat_jid } : {}),
    ...(lead_status ? { lead_status } : {}),
    product_type: String(product_type || "").trim(),
    package_name: String(package_name || "").trim(),
    price: Number(price),
    quantity: Number(quantity),
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("customer_sales_items")
    .insert(payload)
    .select("id, message_id, phone, chat_jid, lead_status, product_type, package_name, price, quantity, created_at, updated_at")
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

async function updateCustomerSalesItem({ owner_user_id, whatsapp_account_id, item_id, phone, chat_jid, lead_status, product_type, package_name, price, quantity }) {
  const salesItem = await getOwnedCustomerSalesItem(item_id, owner_user_id);

  if (!salesItem) {
    const error = new Error("The selected sales lead item was not found for this customer conversation.");
    error.status = 404;
    throw error;
  }

  const belongsToConversation = await salesItemBelongsToCustomerConversation({
    phone,
    chat_jid,
    salesItem
  });

  if (!belongsToConversation) {
    const error = new Error("The selected sales lead item does not belong to this customer conversation.");
    error.status = 400;
    throw error;
  }

  const canonicalPhone = await resolveWhatsAppPhone(phone, chat_jid || null);
  const payload = {
    ...(whatsapp_account_id ? { whatsapp_account_id } : {}),
    phone: canonicalPhone || phone,
    ...(chat_jid ? { chat_jid } : {}),
    ...(lead_status ? { lead_status } : {}),
    product_type: String(product_type || "").trim(),
    package_name: String(package_name || "").trim(),
    price: Number(price),
    quantity: Number(quantity),
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("customer_sales_items")
    .update(payload)
    .eq("owner_user_id", owner_user_id)
    .eq("id", item_id)
    .select("id, message_id, phone, chat_jid, lead_status, product_type, package_name, price, quantity, created_at, updated_at")
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

async function getActiveDashboardSessionId(userId) {
  const { data, error } = await supabase
    .from("active_sessions")
    .select("session_id")
    .eq("user_id", userId)
    .maybeSingle();

  throwIfActiveSessionsSchemaError(error);

  if (error) {
    throw error;
  }

  return data?.session_id || null;
}

async function upsertActiveDashboardSession(userId, sessionId) {
  const { error } = await supabase.from("active_sessions").upsert(
    {
      user_id: userId,
      session_id: sessionId,
      updated_at: new Date().toISOString()
    },
    {
      onConflict: "user_id"
    }
  );

  throwIfActiveSessionsSchemaError(error);

  if (error) {
    throw error;
  }
}

async function deleteActiveDashboardSession(userId, sessionId) {
  if (!sessionId) {
    return;
  }

  const { error } = await supabase
    .from("active_sessions")
    .delete()
    .eq("user_id", userId)
    .eq("session_id", sessionId);

  throwIfActiveSessionsSchemaError(error);

  if (error) {
    throw error;
  }
}

module.exports = {
  supabase,
  saveMessage,
  updateOutgoingMessageStatus,
  deleteMessage,
  getMessagesByPhone,
  getConversationHistoryAnchor,
  getConversations,
  getCustomerByPhone,
  getCustomerInsights,
  clearConversationUnreadCount,
  deleteConversation,
  upsertCustomer,
  getCustomerOwnerIdsByPhone,
  getWhatsAppSettings,
  upsertWhatsAppProfile,
  getWhatsAppAccounts,
  getWhatsAppAccountById,
  cleanupStaleWhatsAppAccounts,
  getLatestWhatsAppAccount,
  upsertWhatsAppAccount,
  getCustomerSalesItems,
  getAllCustomerSalesItems,
  createCustomerSalesItem,
  updateCustomerSalesItem,
  getProfileByUserId,
  upsertProfileFromAuthUser,
  getActiveDashboardSessionId,
  upsertActiveDashboardSession,
  deleteActiveDashboardSession,
  getCustomerByContactId,
  getMessagesByContactId,
  getCustomers,
  supabase
};
