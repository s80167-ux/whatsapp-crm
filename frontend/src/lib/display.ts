function getJidMeta(value: string | null | undefined) {
  const raw = String(value || "").trim();

  if (!raw) {
    return {
      digits: "",
      server: ""
    };
  }

  const [user = "", server = ""] = raw.split("@");
  return {
    digits: user.split(":")[0]?.replace(/\D/g, "") || "",
    server: server.trim().toLowerCase()
  };
}

function normalizeDisplayPhone(phone: string | null | undefined) {
  const digits = String(phone || "").replace(/\D/g, "");

  if (!digits) {
    return null;
  }

  if (digits.startsWith("60")) {
    return digits;
  }

  if (digits.startsWith("6")) {
    return digits;
  }

  if (digits.startsWith("0")) {
    return `6${digits}`;
  }

  return null;
}

export function hasVerifiedPhone(phone: string | null | undefined, chatJid?: string | null | undefined) {
  const normalizedPhone = normalizeDisplayPhone(phone);

  if (!normalizedPhone) {
    return false;
  }

  const { digits, server } = getJidMeta(chatJid);

  if (server === "lid" && digits === normalizedPhone) {
    return false;
  }

  return true;
}

export function getResolvedPhone(phone: string | null | undefined, chatJid?: string | null | undefined) {
  const normalizedPhone = normalizeDisplayPhone(phone);

  if (normalizedPhone) {
    return normalizedPhone;
  }

  const normalizedChatJid = String(chatJid || "").trim();

  if (!normalizedChatJid) {
    return null;
  }

  const { digits: derivedPhone, server } = getJidMeta(normalizedChatJid);

  if (server === "lid") {
    return null;
  }

  return derivedPhone || null;
}

export function getConversationIdentifier(phone: string | null | undefined, chatJid?: string | null | undefined): string | null {
  const resolvedPhone = getResolvedPhone(phone, chatJid);

  if (resolvedPhone) {
    return resolvedPhone;
  }

  const normalizedChatJid = String(chatJid || "").trim();
  return normalizedChatJid || null;
}

export function getDisplayName(contactName: string | null | undefined, phone: string | null | undefined) {
  const normalizedName = contactName?.trim();

  if (normalizedName) {
    return normalizedName;
  }

  return phone || "Unknown contact";
}

export function getDisplayWhatsAppId(phone: string | null | undefined, chatJid?: string | null | undefined): string | null {
  const normalizedChatJid = String(chatJid || "").trim();

  if (normalizedChatJid) {
    return normalizedChatJid;
  }

  const resolvedPhone = getResolvedPhone(phone, chatJid);

  if (!resolvedPhone) {
    return null;
  }

  return `${resolvedPhone}@s.whatsapp.net`;
}

export function getDisplayPhone(phone: string | null | undefined, chatJid?: string | null | undefined): string | null {
  const normalized = normalizeDisplayPhone(phone);

  if (!normalized || !hasVerifiedPhone(normalized, chatJid)) {
    return null;
  }

  return `+${normalized}`;
}

export function formatPhoneDisplay(phone: string | null | undefined, chatJid?: string | null | undefined): string {
  return getDisplayPhone(phone, chatJid) || "Unavailable";
}

export function formatWhatsAppIdDisplay(phone: string | null | undefined, chatJid?: string | null | undefined): string {
  return getDisplayWhatsAppId(phone, chatJid) || "Unavailable";
}

export function getConversationSortTimestamp(conversation: {
  latestReceivedAt?: string | number | null;
  timestamp?: string | number | null;
  created_at?: string | number | null;
  updated_at?: string | number | null;
  last_message_at?: string | number | null;
  lastMessageAt?: string | number | null;
  lastMessage?: { created_at?: string | number | null } | string | null;
  last_message?: { created_at?: string | number | null } | string | null;
}): string | number {
  return (
    conversation?.timestamp ??
    conversation?.latestReceivedAt ??
    conversation?.last_message_at ??
    conversation?.lastMessageAt ??
    conversation?.created_at ??
    conversation?.updated_at ??
    (typeof conversation?.lastMessage === "object" ? conversation.lastMessage?.created_at : null) ??
    (typeof conversation?.last_message === "object" ? conversation.last_message?.created_at : null) ??
    ""
  );
}
