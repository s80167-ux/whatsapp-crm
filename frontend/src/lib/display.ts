export function getResolvedPhone(phone: string | null | undefined, chatJid?: string | null | undefined) {
  const normalizedPhone = String(phone || "").trim();

  if (normalizedPhone) {
    return normalizedPhone;
  }

  const normalizedChatJid = String(chatJid || "").trim();

  if (!normalizedChatJid) {
    return null;
  }

  const derivedPhone = normalizedChatJid.split("@")[0]?.replace(/\D/g, "") || "";
  return derivedPhone || null;
}

export function getDisplayName(contactName: string | null | undefined, phone: string | null | undefined) {
  const normalizedName = contactName?.trim();

  if (normalizedName) {
    return normalizedName;
  }

  return phone || "Unknown contact";
}
