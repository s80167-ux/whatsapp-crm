const fs = require("fs/promises");
const path = require("path");

const authDir = process.env.WHATSAPP_AUTH_DIR
  ? path.resolve(process.env.WHATSAPP_AUTH_DIR)
  : path.join(__dirname, "baileys_auth");

const mappingCache = new Map();

function normalizePhone(rawPhone) {
  return String(rawPhone || "").replace(/\D/g, "");
}

function extractDigits(value) {
  const rawValue = String(value || "").trim();

  if (!rawValue) {
    return "";
  }

  const jidUser = rawValue.split("@")[0] || "";
  const deviceFreeValue = jidUser.split(":")[0] || "";
  return normalizePhone(deviceFreeValue);
}

async function readMappingFile(fileName) {
  if (mappingCache.has(fileName)) {
    return mappingCache.get(fileName);
  }

  try {
    const value = JSON.parse(await fs.readFile(path.join(authDir, fileName), "utf8"));
    mappingCache.set(fileName, value);
    return value;
  } catch {
    mappingCache.set(fileName, null);
    return null;
  }
}

async function resolvePhoneFromIdentifier(value) {
  const digits = extractDigits(value);

  if (!digits) {
    return null;
  }

  const reverseMappedPhone = await readMappingFile(`lid-mapping-${digits}_reverse.json`);
  return normalizePhone(reverseMappedPhone || digits) || null;
}

async function resolveLidFromPhone(value) {
  const digits = extractDigits(value);

  if (!digits) {
    return null;
  }

  return normalizePhone(await readMappingFile(`lid-mapping-${digits}.json`)) || null;
}

async function resolveWhatsAppPhone(primaryValue, chatJid) {
  const fromPrimary = await resolvePhoneFromIdentifier(primaryValue);

  if (fromPrimary) {
    return fromPrimary;
  }

  return resolvePhoneFromIdentifier(chatJid);
}

async function getPhoneLookupValues(value, chatJid) {
  const canonicalPhone = await resolveWhatsAppPhone(value, chatJid);
  const lookupValues = new Set();

  for (const candidate of [value, chatJid]) {
    const digits = extractDigits(candidate);

    if (digits) {
      lookupValues.add(digits);
    }
  }

  if (canonicalPhone) {
    lookupValues.add(canonicalPhone);

    const mappedLid = await resolveLidFromPhone(canonicalPhone);

    if (mappedLid) {
      lookupValues.add(mappedLid);
    }
  }

  return Array.from(lookupValues);
}

module.exports = {
  normalizePhone,
  extractDigits,
  resolvePhoneFromIdentifier,
  resolveLidFromPhone,
  resolveWhatsAppPhone,
  getPhoneLookupValues
};