export function getDisplayName(contactName: string | null | undefined, phone: string | null | undefined) {
  const normalizedName = contactName?.trim();

  if (normalizedName) {
    return normalizedName;
  }

  return phone || "Unknown contact";
}
