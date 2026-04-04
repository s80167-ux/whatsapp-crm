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

export function hasVerifiedPhone(phone: string | null | undefined, chatJid?: string | null | undefined) {
  const normalizedPhone = String(phone || "").trim();

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
  const normalizedPhone = String(phone || "").trim();

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

export function getDisplayName(contactName: string | null | undefined, phone: string | null | undefined) {
  const normalizedName = contactName?.trim();

  if (normalizedName) {
    return normalizedName;
  }

  return phone || "Unknown contact";
}

export function getDisplayPhone(phone: string | null | undefined, chatJid?: string | null | undefined): string | null {
  const normalized = String(phone || "").trim();

  if (!normalized || !hasVerifiedPhone(normalized, chatJid)) {
    return null;
  }

  return normalized.startsWith("+") ? normalized : `+${normalized}`;
}

export function formatPhoneDisplay(phone: string | null | undefined, chatJid?: string | null | undefined): string {
  return getDisplayPhone(phone, chatJid) || "Unavailable";
}
