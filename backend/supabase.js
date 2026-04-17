// Fetch customers with optional filters and pagination
async function getConversations(ownerUserId, whatsappAccountId = null) {
  let messageQuery = supabase
    .from("conversation_latest_messages")
    .select("phone, chat_jid, last_message, last_message_at, last_direction, whatsapp_account_id")
    .eq("owner_user_id", ownerUserId)
    .order("last_message_at", { ascending: false });

  let customerQuery = supabase
    .from("customers")
    .select("phone, chat_jid, status, contact_name, unread_count, profile_picture_url, updated_at, whatsapp_account_id")
    .eq("owner_user_id", ownerUserId);

  messageQuery = applyWhatsAppAccountFilter(messageQuery, whatsappAccountId);
  customerQuery = applyWhatsAppAccountFilter(customerQuery, whatsappAccountId);

  const [
    { data: messageRows, error: messageError },
    { data: customerRows, error: customerError }
  ] = await Promise.all([messageQuery, customerQuery]);

  if (messageError) throw messageError;

  const customerMap = new Map();

  for (const customer of customerRows || []) {
    const key = `${customer.whatsapp_account_id || "no-account"}::${customer.phone}`;
    customerMap.set(key, normalizeCustomerRecord(customer));
  }

  const conversations = [];

  for (const row of messageRows || []) {
    const key = `${row.whatsapp_account_id || "no-account"}::${row.phone}`;

    const customer = customerMap.get(key);

    conversations.push({
      phone: row.phone,
      chatJid: row.chat_jid || null,
      whatsappAccountId: row.whatsapp_account_id || null,
      contactName: customer?.contact_name || null,
      profilePictureUrl: customer?.profile_picture_url || null,
      lastMessage: row.last_message,
      last_message_at: row.last_message_at,
      lastDirection: row.last_direction,
      unreadCount: customer?.unread_count || 0
    });
  }

  return conversations.sort((a, b) => {
    return new Date(b.last_message_at) - new Date(a.last_message_at);
  });
}