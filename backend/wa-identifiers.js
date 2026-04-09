const fs = require("fs/promises");
const path = require("path");

const authDir = process.env.WHATSAPP_AUTH_DIR
  ? path.resolve(process.env.WHATSAPP_AUTH_DIR)
  : path.join(__dirname, "baileys_auth");

const mappingCache = new Map();

function normalizePhone(rawPhone) {
  return String(rawPhone || "").replace(/\D/g, "");
}

function normalizeCustomerPhone(rawPhone) {
  const digits = normalizePhone(rawPhone);

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

function getIdentifierMeta(value) {
  const rawValue = String(value || "").trim();

  if (!rawValue) {
    return {
      rawValue: "",
      server: "",
      digits: ""
    };
  }

  const [jidUser = "", server = ""] = rawValue.split("@");
  const deviceFreeValue = jidUser.split(":")[0] || "";

  return {
    rawValue,
    server: server.trim().toLowerCase(),
    digits: normalizePhone(deviceFreeValue)
  };
}

function extractDigits(value) {
  return getIdentifierMeta(value).digits;
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
  return normalizeCustomerPhone(reverseMappedPhone || digits);
}

async function resolveLidFromPhone(value) {
  const digits = normalizeCustomerPhone(value);

  if (!digits) {
    return null;
  }

  return normalizePhone(await readMappingFile(`lid-mapping-${digits}.json`)) || null;
}

async function resolveIdentifierCandidate(value) {
  const meta = getIdentifierMeta(value);

  if (!meta.digits) {
    return null;
  }

  const mappedPhone = await readMappingFile(`lid-mapping-${meta.digits}_reverse.json`);
  const canonicalPhone = normalizeCustomerPhone(mappedPhone || meta.digits);

  return {
    ...meta,
    canonicalPhone,
    isMapped: Boolean(mappedPhone),
    isDirectPhoneJid: meta.server === "s.whatsapp.net" || meta.server === "c.us",
    isLidJid: meta.server === "lid"
  };
}

async function resolveWhatsAppPhone(primaryValue, chatJid) {
  const [primaryCandidate, chatCandidate] = await Promise.all([
    resolveIdentifierCandidate(primaryValue),
    resolveIdentifierCandidate(chatJid)
  ]);

  const candidates = [primaryCandidate, chatCandidate].filter(Boolean);

  const mappedCandidate = candidates.find((candidate) => candidate.isMapped);

  if (mappedCandidate?.canonicalPhone) {
    return mappedCandidate.canonicalPhone;
  }

  const directPhoneCandidate = candidates.find((candidate) => candidate.isDirectPhoneJid);

  if (directPhoneCandidate?.canonicalPhone) {
    return directPhoneCandidate.canonicalPhone;
  }

  const nonLidCandidate = candidates.find((candidate) => !candidate.isLidJid);

  if (nonLidCandidate?.canonicalPhone) {
    return nonLidCandidate.canonicalPhone;
  }

  if (primaryCandidate?.canonicalPhone) {
    return primaryCandidate.canonicalPhone;
  }

  return chatCandidate?.canonicalPhone || null;
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
  normalizeCustomerPhone,
  extractDigits,
  resolvePhoneFromIdentifier,
  resolveLidFromPhone,
  resolveWhatsAppPhone,
  getPhoneLookupValues
};