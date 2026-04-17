const { Boom } = require("@hapi/boom");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const QRCode = require("qrcode");
const {
  saveMessage,
  updateOutgoingMessageStatus,
  upsertCustomer,
  upsertWhatsAppAccount,
  getWhatsAppAccounts,
  getWhatsAppAccountById,
  getWhatsAppSettings,
  upsertWhatsAppProfile
} = require("./supabase");
const {
  normalizePhone,
  normalizeCustomerPhone,
  resolveWhatsAppPhone,
  extractDigits
} = require("./wa-identifiers");

let baileysModulePromise = null;
const sessions = new Map();

const baseAuthDir = process.env.WHATSAPP_AUTH_DIR
  ? path.resolve(process.env.WHATSAPP_AUTH_DIR)
  : path.join(__dirname, "baileys_auth");
const HISTORY_CHATS_FILE = "hist_chats.json";
const HISTORY_CONTACTS_FILE = "hist_contacts.json";
const HISTORY_MESSAGES_FILE = "hist_messages.json";
const HISTORY_CACHE_MAX_MESSAGES = 5000;
const CONNECTING_RECOVERY_TIMEOUT_MS = 25000;
const MAX_CONNECTING_TIMEOUTS_BEFORE_AUTH_RESET = 3;

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

function withTimeout(promise, timeoutMs, fallbackValue) {
  return Promise.race([
    promise,
    new Promise((resolve) => {
      setTimeout(() => resolve(fallbackValue), timeoutMs);
    })
  ]);
}

function createQuietBaileysLogger() {
  const logger = {
    level: "error",
    child() {
      return logger;
    },
    trace() {},
    debug() {},
    info() {},
    warn() {},
    error(...args) {
      if (!args.length) {
        return;
      }

      const joined = args
        .map((value) => {
          if (value instanceof Error) {
            return value.message;
          }

          if (typeof value === "string") {
            return value;
          }

          if (value && typeof value === "object") {
            return value.msg || value.message || "";
          }

          return "";
        })
        .filter(Boolean)
        .join(" ");

      const noisyPatterns = [
        "failed to send initial passive iq",
        "failed to check/upload pre-keys during initialization",
        "failed to run digest after login",
        "connection errored",
        "buffer timeout reached, auto-flushing",
        "timed out waiting for message"
      ];

      if (noisyPatterns.some((pattern) => joined.toLowerCase().includes(pattern))) {
        return;
      }

      console.error("[baileys]", ...args);
    },
    fatal(...args) {
      logger.error(...args);
    }
  };

  return logger;
}

async function readHistoryCacheFile(session, fileName, fallbackValue) {
  try {
    const filePath = path.join(session.authDir, fileName);
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallbackValue;
  }
}

async function writeHistoryCacheFile(session, fileName, value) {
  try {
    await fs.writeFile(path.join(session.authDir, fileName), JSON.stringify(value, null, 2));
  } catch (error) {
    console.warn(`Failed to write ${fileName} for ${session.accountId}:`, error?.message || error);
  }
}

function getHistoryMessageCacheKey(message) {
  const remoteJid = String(message?.key?.remoteJid || "").trim();
  const messageId = String(message?.key?.id || "").trim();
  const timestamp = extractMessageTimestampSeconds(message?.messageTimestamp) || 0;
  return `${remoteJid}:${messageId}:${timestamp}`;
}

async function cacheHistoryMessages(session, messages, cutoffSecs) {
  const existingMessages = await readHistoryCacheFile(session, HISTORY_MESSAGES_FILE, []);
  const messageMap = new Map();

  for (const message of Array.isArray(existingMessages) ? existingMessages : []) {
    const timestampSeconds = extractMessageTimestampSeconds(message?.messageTimestamp);
    if (timestampSeconds < cutoffSecs) {
      continue;
    }

    messageMap.set(getHistoryMessageCacheKey(message), message);
  }

  for (const message of Array.isArray(messages) ? messages : []) {
    const timestampSeconds = extractMessageTimestampSeconds(message?.messageTimestamp);
    if (timestampSeconds < cutoffSecs) {
      continue;
    }

    messageMap.set(getHistoryMessageCacheKey(message), message);
  }

  const nextMessages = Array.from(messageMap.values())
    .sort(
      (left, right) =>
        extractMessageTimestampSeconds(left?.messageTimestamp) -
        extractMessageTimestampSeconds(right?.messageTimestamp)
    )
    .slice(-HISTORY_CACHE_MAX_MESSAGES);

  await writeHistoryCacheFile(session, HISTORY_MESSAGES_FILE, nextMessages);
}

async function loadBaileys() {
  if (!baileysModulePromise) {
    baileysModulePromise = import("@whiskeysockets/baileys").then((module) => ({
      makeWASocket: module.default,
      useMultiFileAuthState: module.useMultiFileAuthState,
      fetchLatestBaileysVersion: module.fetchLatestBaileysVersion,
      downloadMediaMessage: module.downloadMediaMessage,
      DisconnectReason: module.DisconnectReason,
      ALL_WA_PATCH_NAMES: module.ALL_WA_PATCH_NAMES
    }));
  }

  return baileysModulePromise;
}

function defaultStatus(state = "disconnected", qrData = null) {
  return {
    connected: state === "open",
    state,
    hasQr: Boolean(qrData)
  };
}

function shouldAutoInitializeAccount(account) {
  if (!isRuntimeCompatibleWhatsAppAccount(account)) {
    return false;
  }

  const state = String(account?.connection_state || "").trim().toLowerCase();
  return ["open", "qr", "connecting", "disconnecting"].includes(state);
}

function normalizeStoredAuthDir(configuredDir, accountId) {
  const rawValue = String(configuredDir || "").trim();

  if (!rawValue) {
    return null;
  }

  if (isExplicitAbsoluteAuthDir(rawValue)) {
    return rawValue;
  }

  const pathTokens = rawValue.split(/[\\/]+/).filter(Boolean);
  const lastToken = pathTokens[pathTokens.length - 1] || "";
  const accountDirToken =
    [...pathTokens]
      .reverse()
      .find((token) => /^account-[0-9a-f-]{36}$/i.test(token) || /^[0-9a-f-]{36}$/i.test(token)) ||
    "";

  const preferredToken = accountDirToken || lastToken;

  if (/^account-[0-9a-f-]{36}$/i.test(preferredToken) || /^[0-9a-f-]{36}$/i.test(preferredToken)) {
    return path.join(baseAuthDir, preferredToken);
  }

  if (path.isAbsolute(rawValue)) {
    return rawValue;
  }

  if (/^[a-z]:/i.test(rawValue)) {
    return rawValue;
  }

  if (accountId) {
    return path.join(baseAuthDir, `account-${accountId}`);
  }

  return path.join(baseAuthDir, preferredToken);
}

function isRuntimeCompatibleAuthDir(configuredDir) {
  const normalizedConfiguredDir = normalizeStoredAuthDir(configuredDir, null);
  return isAuthDirWithinRuntimeRoot(normalizedConfiguredDir);
}

function isRuntimeCompatibleWhatsAppAccount(account) {
  return isRuntimeCompatibleAuthDir(account?.auth_dir);
}

function getSessionAuthDir(account) {
  const configuredDir = String(account?.auth_dir || "").trim();
  const normalizedConfiguredDir = normalizeStoredAuthDir(configuredDir, String(account?.id || "").trim() || null);
  return normalizedConfiguredDir || path.join(baseAuthDir, `account-${String(account?.id || crypto.randomUUID())}`);
}

function getOrCreateSessionFromAccount(account) {
  const accountId = String(account?.id || "").trim();

  if (!accountId) {
    throw new Error("WhatsApp account id is required.");
  }

  const existingSession = sessions.get(accountId);
  if (existingSession) {
    existingSession.ownerUserId = account.owner_user_id || existingSession.ownerUserId;
    existingSession.authDir = getSessionAuthDir(account);
    existingSession.account = {
      ...(existingSession.account || {}),
      ...account,
      auth_dir: getSessionAuthDir(account)
    };
    return existingSession;
  }

  const session = {
    accountId,
    ownerUserId: account.owner_user_id || null,
    account: {
      ...account,
      auth_dir: getSessionAuthDir(account)
    },
    authDir: getSessionAuthDir(account),
    sock: null,
    qrData: null,
    connectionState: String(account?.connection_state || "disconnected"),
    manualDisconnectRequested: false,
    historySyncObserved: false,
    pendingHistorySyncRequests: new Set(),
    reconnectTimer: null,
    fallbackSyncTimer: null,
    connectingRecoveryTimer: null,
    consecutiveConnectingTimeouts: 0,
    initializingPromise: null
  };

  sessions.set(accountId, session);
  return session;
}

function clearReconnectTimer(session) {
  if (session.reconnectTimer) {
    clearTimeout(session.reconnectTimer);
    session.reconnectTimer = null;
  }
}

function clearFallbackSyncTimer(session) {
  if (session.fallbackSyncTimer) {
    clearTimeout(session.fallbackSyncTimer);
    session.fallbackSyncTimer = null;
  }
}

function clearConnectingRecoveryTimer(session) {
  if (session.connectingRecoveryTimer) {
    clearTimeout(session.connectingRecoveryTimer);
    session.connectingRecoveryTimer = null;
  }
}

function shouldIgnoreQrDowngrade(session) {
  const currentState = String(session.connectionState || "").trim().toLowerCase();
  if (currentState === "open" && session.sock) {
    return true;
  }

  return false;
}

function safelyRunSocketTask(label, task) {
  Promise.resolve()
    .then(task)
    .catch((error) => {
      console.error(`WhatsApp socket task failed (${label}):`, error?.message || error);
    });
}

async function disposeSession(session, options = {}) {
  if (!session) {
    return;
  }

  clearReconnectTimer(session);
  clearFallbackSyncTimer(session);
  clearConnectingRecoveryTimer(session);
  for (const request of session.pendingHistorySyncRequests || []) {
    clearTimeout(request.timeout);
    request.resolve({
      matched: false,
      matchedMessages: 0,
      matchedChats: 0,
      matchedContacts: 0,
      timedOut: false,
      cancelled: true,
      syncType: null
    });
  }
  if (session.pendingHistorySyncRequests?.clear) {
    session.pendingHistorySyncRequests.clear();
  }
  session.manualDisconnectRequested = true;
  session.qrData = null;
  session.connectionState = options.connectionState || "disconnected";

  const currentSock = session.sock;
  session.sock = null;

  try {
    if (currentSock?.end) {
      currentSock.end(undefined);
    }
  } catch (error) {
    console.warn("Failed to end stale WhatsApp session cleanly:", error.message);
  }

  sessions.delete(session.accountId);
}

async function removeWhatsAppSessions(accountIds = []) {
  for (const accountId of accountIds) {
    const normalizedAccountId = String(accountId || "").trim();
    if (!normalizedAccountId) {
      continue;
    }

    const session = sessions.get(normalizedAccountId);
    await disposeSession(session);
  }
}

async function resetAuthState(session) {
  await fs.rm(session.authDir, { recursive: true, force: true });
  await fs.mkdir(session.authDir, { recursive: true });
}

async function syncSessionAccountState(session, updates = {}) {
  if (!session.ownerUserId) {
    return session.account || null;
  }

  const nextAccount = await upsertWhatsAppAccount({
    id: session.accountId,
    owner_user_id: session.ownerUserId,
    account_phone: updates.account_phone !== undefined ? updates.account_phone : session.account?.account_phone,
    account_jid: updates.account_jid !== undefined ? updates.account_jid : session.account?.account_jid,
    display_name: updates.display_name !== undefined ? updates.display_name : session.account?.display_name,
    profile_picture_url:
      updates.profile_picture_url !== undefined ? updates.profile_picture_url : session.account?.profile_picture_url,
    auth_dir: session.authDir,
    connection_state: updates.connection_state !== undefined ? updates.connection_state : session.connectionState,
    is_active: updates.is_active !== undefined ? updates.is_active : session.account?.is_active ?? true,
    last_connected_at:
      updates.last_connected_at !== undefined ? updates.last_connected_at : session.account?.last_connected_at
  });

  if (nextAccount) {
    session.account = nextAccount;
    session.accountId = nextAccount.id;
    sessions.set(nextAccount.id, session);
  }

  return nextAccount || session.account || null;
}

async function resolveAccount(ownerUserId, requestedAccountId = null, options = {}) {
  const normalizedOwnerId = String(ownerUserId || "").trim();
  const normalizedAccountId = String(requestedAccountId || "").trim() || null;

  if (!normalizedOwnerId) {
    return null;
  }

  if (normalizedAccountId) {
    const account = await getWhatsAppAccountById(normalizedOwnerId, normalizedAccountId);
    return isRuntimeCompatibleWhatsAppAccount(account) ? account : null;
  }

  const accounts = await getWhatsAppAccounts(normalizedOwnerId);
  const compatibleAccounts = accounts.filter((account) => isRuntimeCompatibleWhatsAppAccount(account));
  const openAccount =
    compatibleAccounts.find((account) => String(account.connection_state || "").trim().toLowerCase() === "open") || null;

  return openAccount || compatibleAccounts[0] || null;
}

async function ensureSession(ownerUserId, accountId, options = {}) {
  const account = await resolveAccount(ownerUserId, accountId, options);

  if (!account) {
    return null;
  }

  const session = getOrCreateSessionFromAccount(account);

  if (options.initialize !== false) {
    await initializeWhatsApp(ownerUserId, session.accountId);
  }

  return session;
}

async function createWhatsAppConnection(ownerUserId) {
  const normalizedOwnerId = String(ownerUserId || "").trim();

  if (!normalizedOwnerId) {
    throw new Error("Owner user id is required to create a WhatsApp connection.");
  }

  const authDir = path.join(baseAuthDir, `account-${crypto.randomUUID()}`);
  const account = await upsertWhatsAppAccount({
    owner_user_id: normalizedOwnerId,
    display_name: "New connection",
    auth_dir: authDir,
    connection_state: "connecting",
    is_active: true
  });

  if (!account?.id) {
    throw new Error("Failed to create a WhatsApp connection record.");
  }

  await initializeWhatsApp(normalizedOwnerId, account.id);
  return await getWhatsAppAccountById(normalizedOwnerId, account.id);
}

function isStickerMimeType(mimeType) {
  return String(mimeType || "").trim().toLowerCase() === "image/webp";
}

function isStickerFileName(fileName) {
  return /\.webp$/i.test(String(fileName || "").trim());
}

function extractIncomingText(message) {
  if (!message) return "";

  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    message.buttonsResponseMessage?.selectedDisplayText ||
    message.listResponseMessage?.title ||
    message.templateButtonReplyMessage?.selectedDisplayText ||
    ""
  );
}

function extractMessageContent(message) {
  if (!message) {
    return null;
  }

  let content = message;
  let changed = true;

  while (content && changed) {
    changed = false;

    const unwrappedContent =
      content.deviceSentMessage?.message ||
      content.ephemeralMessage?.message ||
      content.viewOnceMessage?.message ||
      content.viewOnceMessageV2?.message ||
      content.viewOnceMessageV2Extension?.message ||
      content.documentWithCaptionMessage?.message ||
      content.editedMessage?.message ||
      null;

    if (unwrappedContent && unwrappedContent !== content) {
      content = unwrappedContent;
      changed = true;
    }
  }

  return content;
}

function buildIncomingMessagePreview(message) {
  const content = extractMessageContent(message);
  const text = extractIncomingText(content).trim();

  if (text) {
    return text;
  }

  if (!content) {
    return "";
  }

  if (content.imageMessage) return "[Image]";
  if (content.videoMessage) return "[Video]";

  if (content.documentMessage) {
    const fileName = String(content.documentMessage.fileName || "").trim();
    return fileName ? `[Document] ${fileName}` : "[Document]";
  }

  if (content.audioMessage) {
    return content.audioMessage.ptt ? "[Voice note]" : "[Audio]";
  }

  if (content.stickerMessage) return "[Sticker]";
  if (content.contactMessage || content.contactsArrayMessage) return "[Contact]";

  if (content.locationMessage || content.liveLocationMessage) {
    const location = content.locationMessage || content.liveLocationMessage;
    const name = String(location?.name || location?.address || "").trim();
    return name ? `[Location] ${name}` : "[Location]";
  }

  if (content.pollCreationMessage || content.pollCreationMessageV2 || content.pollCreationMessageV3) {
    return "[Poll]";
  }

  return "";
}

async function extractIncomingMedia(session, message) {
  const content = extractMessageContent(message);
  if (!session.sock) {
    return null;
  }

  let mediaMessage = null;
  let mediaType = null;

  if (content?.imageMessage) {
    mediaMessage = content.imageMessage;
    mediaType = "image";
  } else if (content?.videoMessage) {
    mediaMessage = content.videoMessage;
    mediaType = "video";
  } else if (content?.documentMessage) {
    mediaMessage = content.documentMessage;
    mediaType = "document";
  } else if (content?.stickerMessage) {
    mediaMessage = content.stickerMessage;
    mediaType = "sticker";
  }

  if (!mediaMessage || !mediaType) {
    return null;
  }

  try {
    const { downloadMediaMessage } = await loadBaileys();
    const buffer = await downloadMediaMessage(
      { message: content },
      "buffer",
      {},
      { reuploadRequest: session.sock.updateMediaMessage }
    );

    if (!buffer || !buffer.length) {
      return null;
    }

    const fallbackMimeType =
      mediaType === "image"
        ? "image/jpeg"
        : mediaType === "video"
          ? "video/mp4"
          : mediaType === "sticker"
            ? "image/webp"
            : "application/octet-stream";
    const mimeType = String(mediaMessage.mimetype || fallbackMimeType).trim() || fallbackMimeType;
    return {
      media_type: mediaType,
      media_mime_type: mimeType,
      media_file_name:
        String(mediaMessage.fileName || "").trim() || (mediaType === "sticker" ? "sticker.webp" : null),
      media_data_url: `data:${mimeType};base64,${buffer.toString("base64")}`
    };
  } catch (error) {
    console.warn(`Failed to download incoming ${mediaType} media for ${session.accountId}:`, error?.message || error);
    return null;
  }
}

function extractContactIdentity(msg) {
  const candidates = [
    { value: msg?.verifiedBizName, source: "verified_business" },
    { value: msg?.message?.contactMessage?.displayName, source: "contact" },
    { value: msg?.message?.contactsArrayMessage?.displayName, source: "contact" },
    { value: msg?.pushName, source: "push_name" }
  ];

  for (const candidate of candidates) {
    const normalized = String(candidate?.value || "").trim();
    if (normalized) {
      return {
        name: normalized,
        source: candidate.source
      };
    }
  }

  return {
    name: null,
    source: null
  };
}

function extractMessageTimestampSeconds(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  if (value && typeof value === "object") {
    if (typeof value.toNumber === "function") {
      const parsed = value.toNumber();
      return Number.isFinite(parsed) ? parsed : 0;
    }

    if (typeof value.low === "number") {
      return Number.isFinite(value.low) ? value.low : 0;
    }
  }

  return 0;
}

function settleHistorySyncRequest(session, request, result) {
  if (!request || request.settled) {
    return;
  }

  request.settled = true;
  clearTimeout(request.timeout);
  session.pendingHistorySyncRequests?.delete(request);
  request.resolve(result);
}

function registerHistorySyncRequest(session, target, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const request = {
      target,
      resolve,
      settled: false,
      timeout: setTimeout(() => {
        settleHistorySyncRequest(session, request, {
          matched: false,
          matchedMessages: 0,
          matchedChats: 0,
          matchedContacts: 0,
          timedOut: true,
          cancelled: false,
          syncType: null
        });
      }, timeoutMs)
    };

    session.pendingHistorySyncRequests.add(request);
  });
}

async function historyEntryMatchesTarget(target, jidValue) {
  const normalizedJid = String(jidValue || "").trim();

  if (!normalizedJid) {
    return false;
  }

  if (target.chatJid && normalizedJid === target.chatJid) {
    return true;
  }

  if (!target.phone) {
    return false;
  }

  const resolvedPhone = await resolveWhatsAppPhone(normalizedJid, normalizedJid);
  return Boolean(resolvedPhone && resolvedPhone === target.phone);
}

async function collectHistorySyncMatchStats(target, payload) {
  const stats = {
    matched: false,
    matchedMessages: 0,
    matchedChats: 0,
    matchedContacts: 0
  };

  for (const message of payload.messages || []) {
    if (await historyEntryMatchesTarget(target, message?.key?.remoteJid)) {
      stats.matchedMessages += 1;
    }
  }

  for (const chat of payload.chats || []) {
    if (await historyEntryMatchesTarget(target, chat?.id)) {
      stats.matchedChats += 1;
    }
  }

  for (const contact of payload.contacts || []) {
    if (await historyEntryMatchesTarget(target, contact?.id)) {
      stats.matchedContacts += 1;
    }
  }

  stats.matched = stats.matchedMessages > 0 || stats.matchedChats > 0 || stats.matchedContacts > 0;
  return stats;
}

function getSelfJid(session) {
  return session.sock?.user?.id || session.account?.account_jid || null;
}

function extractPhoneFromJid(jid) {
  const rawValue = String(jid || "").split("@")[0].split(":")[0].trim();
  const digits = rawValue.replace(/\D+/g, "");
  return digits ? normalizeCustomerPhone(digits) : null;
}

function getSelfPhone(session) {
  return extractPhoneFromJid(getSelfJid(session)) || session.account?.account_phone || null;
}

function isConnectedWhatsAppPhone(session, phone) {
  const selfPhone = getSelfPhone(session);
  const normalizedPhone = normalizeCustomerPhone(phone);
  return Boolean(selfPhone && normalizedPhone && normalizedPhone === selfPhone);
}

async function upsertHistoryCustomer({
  session,
  phone,
  chatJid,
  contactName,
  nameSource,
  unreadCount,
  profilePictureUrl,
  about
}) {
  if (!phone || isConnectedWhatsAppPhone(session, phone)) {
    return;
  }

  await upsertCustomer({
    owner_user_id: session.ownerUserId,
    whatsapp_account_id: session.accountId,
    phone,
    chat_jid: chatJid,
    contact_name: contactName || undefined,
    name_source: nameSource || undefined,
    unread_count: unreadCount,
    profile_picture_url: profilePictureUrl || undefined,
    about: about || undefined
  }).catch((err) => console.warn("Failed to upsert history customer", err.message));
}

async function hydrateSessionFromLocalHistoryCache(session) {
  const [cachedChats, cachedContacts, cachedMessages] = await Promise.all([
    readHistoryCacheFile(session, HISTORY_CHATS_FILE, []),
    readHistoryCacheFile(session, HISTORY_CONTACTS_FILE, []),
    readHistoryCacheFile(session, HISTORY_MESSAGES_FILE, [])
  ]);

  const contactsByJid = new Map();
  let restoredChats = 0;
  let restoredMessages = 0;

  for (const contact of Array.isArray(cachedContacts) ? cachedContacts : []) {
    if (contact?.id) {
      contactsByJid.set(contact.id, contact);
    }
  }

  for (const chat of Array.isArray(cachedChats) ? cachedChats : []) {
    if (!chat?.id || chat.id.endsWith("@g.us") || chat.id === "status@broadcast") {
      continue;
    }

    const phone = await resolveWhatsAppPhone(chat.id, chat.id);
    const linkedContact = contactsByJid.get(chat.id);
    const contactName = String(
      linkedContact?.name || linkedContact?.notify || linkedContact?.verifiedName || chat.name || ""
    ).trim();

    if (!phone) {
      continue;
    }

    await upsertHistoryCustomer({
      session,
      phone,
      chatJid: chat.id,
      contactName,
      nameSource: contactName ? "history_sync" : undefined,
      unreadCount: typeof chat.unreadCount === "number" ? chat.unreadCount : undefined
    });

    restoredChats += 1;
  }

  for (const message of Array.isArray(cachedMessages) ? cachedMessages : []) {
    try {
      await persistIncomingMessage(session, message);
      restoredMessages += 1;
    } catch (error) {
      console.warn("Failed to restore cached history message:", error?.message || error);
    }
  }

  return {
    restoredChats,
    restoredMessages
  };
}

async function persistIncomingMessage(session, msg) {
  if (!msg?.message || !msg?.key?.remoteJid) return;
  if (msg.key.remoteJid === "status@broadcast" || msg.key.remoteJid.endsWith("@g.us")) return;

  const phone = await resolveWhatsAppPhone(msg.key.remoteJid, msg.key.remoteJid);
  const text = buildIncomingMessagePreview(msg.message);
  const media = await extractIncomingMedia(session, msg.message);
  const contactIdentity = extractContactIdentity(msg);
  const contactName = contactIdentity.name;
  if (!phone || !text) return;
  if (isConnectedWhatsAppPhone(session, phone)) return;

  const tsSecs = extractMessageTimestampSeconds(msg.messageTimestamp);
  const createdAt = tsSecs && !isNaN(tsSecs) ? new Date(tsSecs * 1000).toISOString() : undefined;

  let profileInfo = { profilePictureUrl: null, about: null };
  if (session.sock) {
    try {
      profileInfo = await getContactProfile(session.ownerUserId, session.accountId, phone, msg.key.remoteJid);
    } catch (e) {
      console.warn("Failed to fetch profile info for incoming message:", e.message);
    }
  }

  await upsertCustomer({
    owner_user_id: session.ownerUserId,
    whatsapp_account_id: session.accountId,
    phone,
    chat_jid: msg.key.remoteJid,
    contact_name: contactName && !msg.key.fromMe ? contactName : undefined,
    name_source: contactName && !msg.key.fromMe ? contactIdentity.source : undefined,
    profile_picture_url: profileInfo.profilePictureUrl || undefined,
    about: profileInfo.about || undefined
  });

  if (msg.key.fromMe) {
    const updatedMessage = await updateOutgoingMessageStatus({
      owner_user_id: session.ownerUserId,
      whatsapp_account_id: session.accountId,
      phone,
      chat_jid: msg.key.remoteJid,
      wa_message_id: msg.key.id,
      send_status: "sent",
      created_at: createdAt
    });

    if (updatedMessage) {
      return;
    }
  }

  await saveMessage({
    owner_user_id: session.ownerUserId,
    whatsapp_account_id: session.accountId,
    phone,
    chat_jid: msg.key.remoteJid,
    wa_message_id: msg.key.id,
    message: text,
    ...(media || {}),
    direction: msg.key.fromMe ? "outgoing" : "incoming",
    send_status: msg.key.fromMe ? "sent" : undefined,
    created_at: createdAt
  });
}

async function getLiveWhatsAppProfile(session) {
  if (!session.sock || session.connectionState !== "open") {
    return {
      connected: false,
      phone: session.account?.account_phone || null,
      username: session.account?.display_name || null,
      profilePictureUrl: session.account?.profile_picture_url || null,
      businessProfile: null,
      catalog: null
    };
  }

  const jid = getSelfJid(session);
  const username = String(session.sock.user?.name || "").trim() || session.account?.display_name || null;
  const phone = extractPhoneFromJid(jid);

  const [profilePictureUrl, businessProfile, catalogResult] = jid
    ? await Promise.all([
        withTimeout(session.sock.profilePictureUrl(jid, "image").catch(() => null), 5000, null),
        withTimeout(session.sock.getBusinessProfile(jid).catch(() => null), 5000, null),
        withTimeout(session.sock.getCatalog({ jid, limit: 10 }).catch(() => ({ products: [] })), 7000, {
          products: []
        })
      ])
    : [null, null, { products: [] }];

  return {
    connected: true,
    phone,
    username,
    profilePictureUrl,
    businessProfile: businessProfile
      ? {
          description: businessProfile.description || null,
          email: businessProfile.email || null,
          category: businessProfile.category || null,
          address: businessProfile.address || null,
          website: Array.isArray(businessProfile.website) ? businessProfile.website.filter(Boolean) : [],
          businessHours: businessProfile.business_hours || null
        }
      : null,
    catalog: {
      products: Array.isArray(catalogResult?.products)
        ? catalogResult.products.map((product) => ({
            id: product.id,
            name: product.name,
            description: product.description || null,
            price: product.price,
            currency: product.currency,
            url: product.url || null,
            availability: product.availability || null,
            imageUrl:
              product.imageUrls?.requested ||
              product.imageUrls?.original ||
              Object.values(product.imageUrls || {})[0] ||
              null
          }))
        : []
    }
  };
}

function scheduleReconnect(session, options = {}) {
  clearReconnectTimer(session);

  session.connectionState = "connecting";
  void syncSessionAccountState(session, { connection_state: "connecting" });

  console.warn(
    `Scheduling WhatsApp reconnect for ${session.accountId} in 3000ms${options.resetAuth ? " with auth reset" : ""}.`
  );

  session.reconnectTimer = setTimeout(async () => {
    session.reconnectTimer = null;
    try {
      if (options.resetAuth) {
        await resetAuthState(session);
      }
      await initializeWhatsApp(session.ownerUserId, session.accountId);
    } catch (error) {
      console.error(`Failed to reinitialize WhatsApp for ${session.accountId}:`, error);
      session.connectionState = "disconnected";
      await syncSessionAccountState(session, { connection_state: "disconnected" }).catch(() => {});
    }
  }, 3000);
}

async function initializeWhatsApp(ownerUserId, accountId) {
  const session = await ensureSession(ownerUserId, accountId, { initialize: false });

  if (!session) {
    return null;
  }

  if (session.sock) {
    return session.sock;
  }

  if (session.initializingPromise) {
    return session.initializingPromise;
  }

  session.initializingPromise = (async () => {
    session.connectionState = "connecting";
    session.qrData = null;
    session.historySyncObserved = false;
    await syncSessionAccountState(session, { connection_state: "connecting" }).catch(() => {});

    const {
      makeWASocket,
      useMultiFileAuthState,
      fetchLatestBaileysVersion,
      DisconnectReason,
      ALL_WA_PATCH_NAMES
    } = await loadBaileys();

    await fs.mkdir(session.authDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(session.authDir);
    const { version } = await fetchLatestBaileysVersion();
    clearFallbackSyncTimer(session);
    clearConnectingRecoveryTimer(session);

    session.sock = makeWASocket({
      version,
      printQRInTerminal: false,
      auth: state,
      fireInitQueries: false,
      syncFullHistory: true,
      logger: createQuietBaileysLogger(),
      getMessage: async () => undefined
    });
    const activeSock = session.sock;
    const isCurrentSocket = () => session.sock === activeSock;

    session.connectingRecoveryTimer = setTimeout(() => {
      safelyRunSocketTask(`connecting-timeout:${session.accountId}`, async () => {
        if (!isCurrentSocket() || session.connectionState !== "connecting") {
          return;
        }

        session.consecutiveConnectingTimeouts =
          Number.isFinite(session.consecutiveConnectingTimeouts) ? session.consecutiveConnectingTimeouts + 1 : 1;
        const shouldResetAuth =
          session.consecutiveConnectingTimeouts >= MAX_CONNECTING_TIMEOUTS_BEFORE_AUTH_RESET;

        console.warn(
          `WhatsApp session ${session.accountId} stayed in connecting for more than ${CONNECTING_RECOVERY_TIMEOUT_MS}ms. Attempt ${session.consecutiveConnectingTimeouts}/${MAX_CONNECTING_TIMEOUTS_BEFORE_AUTH_RESET}${shouldResetAuth ? " will reset auth for QR recovery." : " will retry without resetting auth."}`
        );

        clearConnectingRecoveryTimer(session);
        session.qrData = null;
        session.sock = null;
        session.historySyncObserved = false;
        clearFallbackSyncTimer(session);

        try {
          if (activeSock?.end) {
            activeSock.end(undefined);
          }
        } catch (error) {
          console.warn(`Failed to close stalled WhatsApp socket for ${session.accountId}:`, error?.message || error);
        }

        session.connectionState = "disconnected";
        await syncSessionAccountState(session, { connection_state: "disconnected" }).catch(() => {});
        scheduleReconnect(session, { resetAuth: shouldResetAuth });
      });
    }, CONNECTING_RECOVERY_TIMEOUT_MS);

    activeSock.ev.on("creds.update", () => {
      if (!isCurrentSocket()) {
        return;
      }

      safelyRunSocketTask(`creds.update:${session.accountId}`, () => saveCreds());
    });

    activeSock.ev.on("connection.update", (update) => {
      safelyRunSocketTask(`connection.update:${session.accountId}`, async () => {
        if (!isCurrentSocket()) {
          return;
        }

        const { connection, lastDisconnect, qr } = update;

        if (connection === "connecting") {
          session.connectionState = "connecting";
          await syncSessionAccountState(session, { connection_state: "connecting" }).catch(() => {});
        }

        if (qr) {
          clearConnectingRecoveryTimer(session);

          if (shouldIgnoreQrDowngrade(session)) {
            console.warn(`Ignoring QR update for recently connected account ${session.accountId}.`);
            return;
          }

          session.qrData = await QRCode.toDataURL(qr);
          session.connectionState = "qr";
          await syncSessionAccountState(session, { connection_state: "qr" }).catch(() => {});
        }

        if (connection === "open") {
          clearConnectingRecoveryTimer(session);
          session.consecutiveConnectingTimeouts = 0;
          session.connectionState = "open";
          session.qrData = null;
          console.log(`WhatsApp (Baileys) is ready for account ${session.accountId}.`);
          await syncSessionAccountState(session, {
            connection_state: "open",
            account_jid: getSelfJid(session),
            last_connected_at: new Date().toISOString()
          }).catch(() => {});

          clearFallbackSyncTimer(session);
          session.fallbackSyncTimer = setTimeout(async () => {
            if (!isCurrentSocket() || !session.sock || session.connectionState !== "open" || session.historySyncObserved) {
              return;
            }

            try {
              const restored = await hydrateSessionFromLocalHistoryCache(session);
              if (restored.restoredChats || restored.restoredMessages) {
                console.log(
                  `Restored ${restored.restoredChats} cached chats and ${restored.restoredMessages} cached messages for ${session.accountId} before fallback resync.`
                );
              }

              console.log(`History sync not received for ${session.accountId}. Triggering fallback app-state resync.`);
              await activeSock.resyncAppState(ALL_WA_PATCH_NAMES, true);
              console.log(`Fallback app-state resync finished for ${session.accountId}.`);
            } catch (error) {
              console.error(`Fallback app-state resync failed for ${session.accountId}:`, error?.message || error);
            }
          }, 8000);

          setTimeout(async () => {
            if (!isCurrentSocket()) {
              return;
            }

            try {
              const profile = await getLiveWhatsAppProfile(session);
              await upsertWhatsAppProfile({
                owner_user_id: session.ownerUserId,
                phone: profile.phone,
                username: profile.username,
                profile_picture_url: profile.profilePictureUrl
              });
              await syncSessionAccountState(session, {
                account_phone: profile.phone,
                account_jid: getSelfJid(session),
                display_name: profile.username,
                profile_picture_url: profile.profilePictureUrl,
                connection_state: "open",
                last_connected_at: new Date().toISOString()
              });
            } catch (e) {
              console.error("Failed to save WhatsApp profile to database:", e.message);
            }
          }, 3000);
        } else if (connection === "close") {
          clearConnectingRecoveryTimer(session);
          const statusCode =
            lastDisconnect?.error instanceof Boom ? lastDisconnect.error.output.statusCode : undefined;
          const disconnectMessage =
            lastDisconnect?.error instanceof Error
              ? lastDisconnect.error.message
              : String(lastDisconnect?.error?.message || lastDisconnect?.error || "").trim() || null;
          const disconnectData =
            lastDisconnect?.error instanceof Boom
              ? lastDisconnect.error?.data || lastDisconnect.error?.output?.payload || null
              : null;
          session.qrData = null;
          if (isCurrentSocket()) {
            session.sock = null;
          }
          session.historySyncObserved = false;
          clearFallbackSyncTimer(session);

          console.warn("WhatsApp connection closed:", {
            accountId: session.accountId,
            ownerUserId: session.ownerUserId,
            statusCode: statusCode ?? null,
            message: disconnectMessage,
            data: disconnectData,
            manualDisconnectRequested: session.manualDisconnectRequested
          });

          if (session.manualDisconnectRequested) {
            session.connectionState = "disconnected";
            await syncSessionAccountState(session, { connection_state: "disconnected" }).catch(() => {});
            return;
          }

          if (statusCode === DisconnectReason.loggedOut) {
            console.warn(`WhatsApp session ${session.accountId} was logged out. Resetting auth state for a fresh QR.`);
            scheduleReconnect(session, { resetAuth: true });
            return;
          }

          session.connectionState = "disconnected";
          await syncSessionAccountState(session, { connection_state: "disconnected" }).catch(() => {});
          if (statusCode !== DisconnectReason.loggedOut) {
            scheduleReconnect(session);
          }
        }
      });
    });

    activeSock.ev.on("chats.set", ({ chats }) => {
      safelyRunSocketTask(`chats.set:${session.accountId}`, async () => {
        if (!isCurrentSocket()) {
          return;
        }

        console.log(`Received chats.set with ${Array.isArray(chats) ? chats.length : 0} chats for ${session.accountId}.`);
        for (const chat of chats || []) {
          if (chat.id && chat.unreadCount !== undefined && !chat.id.endsWith("@g.us") && chat.id !== "status@broadcast") {
            const phone = await resolveWhatsAppPhone(chat.id, chat.id);
            if (phone && !isConnectedWhatsAppPhone(session, phone)) {
              await upsertCustomer({
                owner_user_id: session.ownerUserId,
                whatsapp_account_id: session.accountId,
                phone,
                chat_jid: chat.id,
                unread_count: chat.unreadCount
              }).catch(() => {});
            }
          }
        }
      });
    });

    activeSock.ev.on("chats.update", (updates) => {
      safelyRunSocketTask(`chats.update:${session.accountId}`, async () => {
        if (!isCurrentSocket()) {
          return;
        }

        for (const update of updates || []) {
          if (
            update.id &&
            update.unreadCount !== undefined &&
            !update.id.endsWith("@g.us") &&
            update.id !== "status@broadcast"
          ) {
            const phone = await resolveWhatsAppPhone(update.id, update.id);
            if (phone && !isConnectedWhatsAppPhone(session, phone)) {
              await upsertCustomer({
                owner_user_id: session.ownerUserId,
                whatsapp_account_id: session.accountId,
                phone,
                chat_jid: update.id,
                unread_count: update.unreadCount
              }).catch(() => {});
            }
          }
        }
      });
    });

    activeSock.ev.on("messages.upsert", ({ messages, type }) => {
      safelyRunSocketTask(`messages.upsert:${session.accountId}`, async () => {
        if (!isCurrentSocket()) {
          return;
        }

        if (!["notify", "append"].includes(type) || !Array.isArray(messages) || messages.length === 0) return;

        for (const msg of messages) {
          try {
            await persistIncomingMessage(session, msg);
          } catch (e) {
            console.error("Failed to save incoming message:", e.message);
          }
        }
      });
    });

    activeSock.ev.on("messages.update", (updates) => {
      safelyRunSocketTask(`messages.update:${session.accountId}`, async () => {
        if (!isCurrentSocket()) {
          return;
        }

        if (!Array.isArray(updates) || updates.length === 0) return;

        for (const update of updates) {
          const message = update?.update?.message;
          const key = update?.key;

          if (!message || !key?.remoteJid) {
            continue;
          }

          try {
            await persistIncomingMessage(session, {
              key,
              message,
              messageTimestamp: update?.update?.messageTimestamp
            });
          } catch (e) {
            console.error("Failed to save updated message:", e.message);
          }
        }
      });
    });

    activeSock.ev.on("contacts.upsert", (contacts) => {
      safelyRunSocketTask(`contacts.upsert:${session.accountId}`, async () => {
        if (!isCurrentSocket()) {
          return;
        }

        if (!Array.isArray(contacts)) return;
        for (const contact of contacts) {
          if (contact.id && contact.lid && !contact.id.endsWith("@g.us") && contact.id !== "status@broadcast") {
            const phone = extractDigits(contact.id);
            const lidDigits = extractDigits(contact.lid);
            if (phone && lidDigits && lidDigits !== phone) {
              const reverseFile = path.join(session.authDir, `lid-mapping-${lidDigits}_reverse.json`);
              const fwdFile = path.join(session.authDir, `lid-mapping-${phone}.json`);
              await fs.writeFile(reverseFile, JSON.stringify(phone)).catch(() => {});
              await fs.writeFile(fwdFile, JSON.stringify(lidDigits)).catch(() => {});
            }
          }
        }
      });
    });

    activeSock.ev.on("messaging-history.set", ({ chats, contacts, messages, syncType }) => {
      safelyRunSocketTask(`messaging-history.set:${session.accountId}`, async () => {
        if (!isCurrentSocket()) {
          return;
        }

        session.historySyncObserved = true;
        clearFallbackSyncTimer(session);

        try {
          const settings = await getWhatsAppSettings(session.ownerUserId);
          const days = settings.history_sync_days || 7;
          const cutoffSecs = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
          const contactsByJid = new Map();

          if (Array.isArray(chats)) {
            await writeHistoryCacheFile(session, HISTORY_CHATS_FILE, chats);
          }

          if (Array.isArray(contacts)) {
            for (const contact of contacts) {
              if (contact?.id) {
                contactsByJid.set(contact.id, contact);
              }
            }
          }

          if (Array.isArray(contacts)) {
            await writeHistoryCacheFile(session, HISTORY_CONTACTS_FILE, contacts);

            for (const contact of contacts) {
              if (contact.id && !contact.id.endsWith("@g.us") && contact.id !== "status@broadcast") {
                const phone = await resolveWhatsAppPhone(contact.id, contact.id);

                if (contact.lid && phone) {
                  const lidDigits = extractDigits(contact.lid);
                  if (lidDigits && lidDigits !== phone) {
                    const reverseFile = path.join(session.authDir, `lid-mapping-${lidDigits}_reverse.json`);
                    const fwdFile = path.join(session.authDir, `lid-mapping-${phone}.json`);
                    await fs.writeFile(reverseFile, JSON.stringify(phone)).catch(() => {});
                    await fs.writeFile(fwdFile, JSON.stringify(lidDigits)).catch(() => {});
                  }
                }

                if (phone) {
                  if (isConnectedWhatsAppPhone(session, phone)) {
                    continue;
                  }

                  const contactName = String(contact.name || contact.notify || contact.verifiedName || "").trim();
                  let profileInfo = { profilePictureUrl: null, about: null };
                  try {
                    profileInfo = await getContactProfile(session.ownerUserId, session.accountId, phone, contact.id);
                  } catch {
                    // Ignore individual profile sync failures during history sync.
                  }

                  await upsertHistoryCustomer({
                    session,
                    phone,
                    chatJid: contact.id,
                    contactName,
                    nameSource: contact.verifiedName ? "verified_business" : contact.name ? "contact" : contact.notify ? "push_name" : "history_sync",
                    profilePictureUrl: profileInfo.profilePictureUrl,
                    about: profileInfo.about
                  });
                }
              }
            }
          }

          if (Array.isArray(chats)) {
            for (const chat of chats) {
              if (!chat?.id || chat.id.endsWith("@g.us") || chat.id === "status@broadcast") {
                continue;
              }

              const phone = await resolveWhatsAppPhone(chat.id, chat.id);
              const linkedContact = contactsByJid.get(chat.id);
              const contactName = String(
                linkedContact?.name || linkedContact?.notify || linkedContact?.verifiedName || chat.name || ""
              ).trim();

              await upsertHistoryCustomer({
                session,
                phone,
                chatJid: chat.id,
                contactName,
                nameSource: linkedContact?.verifiedName ? "verified_business" : linkedContact?.name ? "contact" : linkedContact?.notify ? "push_name" : "history_sync",
                unreadCount: typeof chat.unreadCount === "number" ? chat.unreadCount : undefined
              });
            }
          }

          const safeMessages = Array.isArray(messages) ? messages : [];
          const recentMessages = safeMessages.filter(
            (m) => extractMessageTimestampSeconds(m?.messageTimestamp) >= cutoffSecs
          );

          await cacheHistoryMessages(session, recentMessages, cutoffSecs);

          console.log(
            `History sync chunk received for ${session.accountId}: ${safeMessages.length} total messages, keeping ${recentMessages.length} recent (last ${days} days).`
          );

          for (const msg of recentMessages) {
            try {
              await persistIncomingMessage(session, msg);
            } catch (e) {
              console.error("Failed to save history message:", e.message);
            }
          }
        } catch (error) {
          console.error("Failed to process messaging-history.set:", error.message);
        }

        if (session.pendingHistorySyncRequests?.size) {
          for (const request of Array.from(session.pendingHistorySyncRequests)) {
            const matchStats = await collectHistorySyncMatchStats(request.target, {
              chats,
              contacts,
              messages
            });

            if (matchStats.matched) {
              settleHistorySyncRequest(session, request, {
                ...matchStats,
                timedOut: false,
                cancelled: false,
                syncType: syncType || null
              });
            }
          }
        }
      });
    });

    return activeSock;
  })().finally(() => {
    session.initializingPromise = null;
  });

  return session.initializingPromise;
}

async function getWhatsAppStatus(ownerUserId, accountId) {
  let session = await ensureSession(ownerUserId, accountId, {
    initialize: false
  });

  if (!session) {
    return defaultStatus();
  }

  if (!session.sock && shouldAutoInitializeAccount(session.account)) {
    try {
      session = await ensureSession(ownerUserId, accountId, {
        initialize: true
      });
    } catch (error) {
      console.warn(`Failed to initialize WhatsApp status session for ${session.accountId}:`, error?.message || error);
    }
  }

  return defaultStatus(session.connectionState, session.qrData);
}

async function getWhatsAppQr(ownerUserId, accountId) {
  let session = await ensureSession(ownerUserId, accountId, {
    initialize: false
  });

  if (!session) {
    return {
      connected: false,
      state: "disconnected",
      qr: null
    };
  }

  if (!session.sock && shouldAutoInitializeAccount(session.account)) {
    try {
      session = await ensureSession(ownerUserId, accountId, {
        initialize: true
      });
    } catch (error) {
      console.warn(`Failed to initialize WhatsApp QR session for ${session.accountId}:`, error?.message || error);
    }
  }

  return {
    connected: session.connectionState === "open",
    state: session.connectionState,
    qr: session.qrData
  };
}

async function getWhatsAppProfile(ownerUserId, accountId) {
  const session = await ensureSession(ownerUserId, accountId, {
    initialize: false
  });

  if (!session) {
    return {
      connected: false,
      phone: null,
      username: null,
      profilePictureUrl: null,
      businessProfile: null,
      catalog: null
    };
  }

  return await getLiveWhatsAppProfile(session);
}

async function getCurrentWhatsAppAccountContext(ownerUserId, requestedAccountId = null) {
  const account = await resolveAccount(ownerUserId, requestedAccountId);
  if (!account) {
    return {
      id: null,
      phone: null,
      jid: null
    };
  }

  const session = sessions.get(account.id) || getOrCreateSessionFromAccount(account);
  return {
    id: account.id,
    phone: getSelfPhone(session) || account.account_phone || null,
    jid: getSelfJid(session) || account.account_jid || null
  };
}

async function requireConnectedSession(ownerUserId, accountId) {
  const session = await ensureSession(ownerUserId, accountId);

  if (!session || !session.sock || session.connectionState !== "open") {
    throw new Error("WhatsApp is not connected.");
  }

  return session;
}

async function sendMessageToPhone(ownerUserId, accountId, phone, message, chatJid) {
  const session = await requireConnectedSession(ownerUserId, accountId);
  const jid = chatJid || `${phone}@s.whatsapp.net`;
  return await session.sock.sendMessage(jid, { text: String(message) });
}

async function sendAttachmentToPhone(ownerUserId, accountId, { phone, chatJid, buffer, mimeType, fileName, caption }) {
  const session = await requireConnectedSession(ownerUserId, accountId);
  const jid = chatJid || `${phone}@s.whatsapp.net`;
  const normalizedMimeType = String(mimeType || "").trim().toLowerCase();
  const type = isStickerMimeType(normalizedMimeType) || isStickerFileName(fileName)
    ? "sticker"
    : normalizedMimeType.startsWith("image/")
      ? "image"
      : normalizedMimeType.startsWith("video/")
        ? "video"
        : "document";

  const msg =
    type === "sticker"
      ? { sticker: buffer, mimetype: normalizedMimeType || "image/webp" }
      : type === "image"
        ? { image: buffer, mimetype: mimeType, fileName, caption }
        : type === "video"
          ? { video: buffer, mimetype: mimeType, fileName, caption }
          : { document: buffer, mimetype: mimeType, fileName, caption };

  return await session.sock.sendMessage(jid, msg);
}

async function sendLocationToPhone(ownerUserId, accountId, { phone, chatJid, latitude, longitude, name, address }) {
  const session = await requireConnectedSession(ownerUserId, accountId);
  const jid = chatJid || `${phone}@s.whatsapp.net`;
  return await session.sock.sendMessage(jid, {
    location: {
      degreesLatitude: Number(latitude),
      degreesLongitude: Number(longitude),
      name,
      address
    }
  });
}

async function deleteMessageFromPhone(ownerUserId, accountId, { phone, chatJid, waMessageId, direction }) {
  if (!waMessageId) {
    return {
      attempted: false,
      deleted: false,
      warning: "WhatsApp message ID is not available for this message."
    };
  }

  if (direction !== "outgoing") {
    return {
      attempted: false,
      deleted: false,
      warning: "Remote WhatsApp deletion is only available for outgoing messages."
    };
  }

  const session = await ensureSession(ownerUserId, accountId);

  if (!session?.sock || session.connectionState !== "open") {
    return {
      attempted: false,
      deleted: false,
      warning: "WhatsApp is not connected."
    };
  }

  const remoteJid = chatJid || `${phone}@s.whatsapp.net`;

  try {
    await session.sock.sendMessage(remoteJid, {
      delete: {
        remoteJid,
        fromMe: true,
        id: waMessageId
      }
    });

    return {
      attempted: true,
      deleted: true,
      warning: null
    };
  } catch (error) {
    return {
      attempted: true,
      deleted: false,
      warning: error instanceof Error ? error.message : "Failed to delete the WhatsApp message."
    };
  }
}

async function getContactProfile(ownerUserId, accountId, phone, chatJid) {
  const session = await ensureSession(ownerUserId, accountId);
  if (!session?.sock || session.connectionState !== "open") {
    return { profilePictureUrl: null, about: null };
  }

  const jid = chatJid || `${phone}@s.whatsapp.net`;
  try {
    const [profilePictureUrl, status] = await Promise.all([
      session.sock.profilePictureUrl(jid, "image").catch(() => null),
      session.sock.fetchStatus(jid).catch(() => null)
    ]);
    return { profilePictureUrl, about: status?.status || null };
  } catch {
    return { profilePictureUrl: null, about: null };
  }
}

async function repopulateConversationFromWhatsApp(ownerUserId, accountId, options = {}) {
  const session = await ensureSession(ownerUserId, accountId);

  if (!session) {
    const error = new Error("WhatsApp account not found.");
    error.status = 404;
    throw error;
  }

  if (!session.sock || session.connectionState !== "open") {
    const error = new Error("WhatsApp must be connected before repopulating conversation history.");
    error.status = 409;
    throw error;
  }

  const targetChatJid = String(options.chatJid || options.anchorMessage?.chat_jid || "").trim() || null;
  const targetPhone =
    normalizeCustomerPhone(options.phone) ||
    (await resolveWhatsAppPhone(options.anchorMessage?.phone, targetChatJid || options.anchorMessage?.chat_jid || null)) ||
    null;
  const anchorMessage = options.anchorMessage && typeof options.anchorMessage === "object" ? options.anchorMessage : null;
  const result = {
    success: true,
    phone: targetPhone,
    chatJid: targetChatJid,
    whatsappAccountId: session.accountId,
    history: {
      attempted: false,
      requested: false,
      matched: false,
      matchedMessages: 0,
      matchedChats: 0,
      matchedContacts: 0,
      timedOut: false,
      warning: null,
      anchorMessageId: anchorMessage?.wa_message_id || null
    },
    profile: {
      refreshed: false,
      profilePictureUrl: null,
      about: null
    }
  };

  if (typeof session.sock.fetchMessageHistory === "function" && targetChatJid && anchorMessage?.wa_message_id && anchorMessage?.created_at) {
    result.history.attempted = true;

    const historyWaitPromise = registerHistorySyncRequest(session, {
      phone: targetPhone,
      chatJid: targetChatJid
    });

    try {
      const oldestTimestampSeconds = Math.floor(new Date(anchorMessage.created_at).getTime() / 1000);
      await session.sock.fetchMessageHistory(
        50,
        {
          remoteJid: targetChatJid,
          id: anchorMessage.wa_message_id,
          fromMe: anchorMessage.direction === "outgoing"
        },
        oldestTimestampSeconds
      );
      result.history.requested = true;

      const historySyncResult = await historyWaitPromise;
      result.history.matched = historySyncResult.matched;
      result.history.matchedMessages = historySyncResult.matchedMessages;
      result.history.matchedChats = historySyncResult.matchedChats;
      result.history.matchedContacts = historySyncResult.matchedContacts;
      result.history.timedOut = historySyncResult.timedOut;

      if (historySyncResult.timedOut) {
        result.history.warning = "WhatsApp accepted the history request, but no matching history chunk arrived before timeout.";
      }
    } catch (error) {
      result.history.warning = error instanceof Error ? error.message : "Failed to request WhatsApp message history.";
    }
  } else if (!targetChatJid) {
    result.history.warning = "Unable to request message history because this conversation does not have a stable WhatsApp chat JID yet.";
  } else if (!anchorMessage?.wa_message_id || !anchorMessage?.created_at) {
    result.history.warning = "Unable to request older history because no existing WhatsApp message anchor was found for this conversation.";
  } else {
    result.history.warning = "This Baileys session does not expose on-demand history fetching.";
  }

  if (targetPhone || targetChatJid) {
    const profile = await getContactProfile(ownerUserId, session.accountId, targetPhone, targetChatJid);
    result.profile = {
      refreshed: Boolean(profile.profilePictureUrl || profile.about),
      profilePictureUrl: profile.profilePictureUrl || null,
      about: profile.about || null
    };

    if (targetPhone) {
      await upsertCustomer({
        owner_user_id: ownerUserId,
        whatsapp_account_id: session.accountId,
        phone: targetPhone,
        chat_jid: targetChatJid,
        contact_name: options.contactName || undefined,
        name_source: options.contactName ? "manual" : undefined,
        profile_picture_url: profile.profilePictureUrl || undefined,
        about: profile.about || undefined
      }).catch((error) => {
        console.warn("Failed to refresh WhatsApp customer profile cache:", error?.message || error);
      });
    }
  }

  return result;
}
async function rebuildAllConversationsFromWhatsApp(ownerUserId, accountId, options = {}) {
  const session = await ensureSession(ownerUserId, accountId, { initialize: false });

  if (!session) {
    const error = new Error("WhatsApp account not found.");
    error.status = 404;
    throw error;
  }

  if (!session.sock || session.connectionState !== "open") {
    await initializeWhatsApp(ownerUserId, session.accountId);
  }

  const refreshedSession = await ensureSession(ownerUserId, session.accountId, { initialize: false });

  if (!refreshedSession?.sock || refreshedSession.connectionState !== "open") {
    const error = new Error("WhatsApp must be connected before rebuilding conversations.");
    error.status = 409;
    throw error;
  }

  const activeSession = refreshedSession;
  const waitMs =
    Number.isFinite(Number(options.waitMs)) && Number(options.waitMs) > 0
      ? Number(options.waitMs)
      : 12000;

  let restored = { restoredChats: 0, restoredMessages: 0 };
  let fallbackResyncTriggered = false;
  let fallbackResyncError = null;

  activeSession.historySyncObserved = false;

  try {
    restored = await hydrateSessionFromLocalHistoryCache(activeSession);
  } catch (error) {
    console.warn(
      `Failed to hydrate local history cache for ${activeSession.accountId}:`,
      error?.message || error
    );
  }

  const waitForHistorySync = new Promise((resolve) => {
    const startedAt = Date.now();

    const interval = setInterval(() => {
      if (activeSession.historySyncObserved) {
        clearInterval(interval);
        resolve({
          historySyncObserved: true,
          timedOut: false,
          waitedMs: Date.now() - startedAt
        });
        return;
      }

      if (Date.now() - startedAt >= waitMs) {
        clearInterval(interval);
        resolve({
          historySyncObserved: Boolean(activeSession.historySyncObserved),
          timedOut: !activeSession.historySyncObserved,
          waitedMs: Date.now() - startedAt
        });
      }
    }, 500);
  });

  if (typeof activeSession.sock.resyncAppState === "function") {
    try {
      const { ALL_WA_PATCH_NAMES } = await loadBaileys();
      fallbackResyncTriggered = true;
      await activeSession.sock.resyncAppState(ALL_WA_PATCH_NAMES, true);
    } catch (error) {
      fallbackResyncError = error instanceof Error ? error.message : String(error || "Unknown resync error");
      console.error(
        `Failed to trigger fallback app-state resync for ${activeSession.accountId}:`,
        error?.message || error
      );
    }
  }

  const waitResult = await waitForHistorySync;

  return {
    success: true,
    whatsappAccountId: activeSession.accountId,
    connectionState: activeSession.connectionState,
    restoredChats: restored.restoredChats || 0,
    restoredMessages: restored.restoredMessages || 0,
    historySyncObserved: waitResult.historySyncObserved,
    fallbackResyncTriggered,
    fallbackResyncError,
    waitedMs: waitResult.waitedMs,
    timedOut: waitResult.timedOut
  };
}

async function disconnectWhatsApp(ownerUserId, accountId) {
  const session = await ensureSession(ownerUserId, accountId, { initialize: false });

  if (!session) {
    return defaultStatus();
  }

  clearReconnectTimer(session);
  clearFallbackSyncTimer(session);
  session.qrData = null;
  session.connectionState = "disconnecting";
  session.manualDisconnectRequested = true;
  await syncSessionAccountState(session, { connection_state: "disconnecting" }).catch(() => {});

  const currentSock = session.sock;
  session.sock = null;

  try {
    if (currentSock?.logout) {
      await withTimeout(currentSock.logout(), 5000, null);
    } else {
      await resetAuthState(session);
    }
  } catch (error) {
    console.warn("Failed to log out WhatsApp session cleanly:", error.message);
    await resetAuthState(session);
  } finally {
    session.manualDisconnectRequested = false;
  }

  scheduleReconnect(session, { resetAuth: true });
  return defaultStatus(session.connectionState, session.qrData);
}

module.exports = {
  initializeWhatsApp,
  createWhatsAppConnection,
  shouldAutoInitializeAccount,
  isRuntimeCompatibleWhatsAppAccount,
  sendMessageToPhone,
  sendAttachmentToPhone,
  sendLocationToPhone,
  deleteMessageFromPhone,
  getWhatsAppStatus,
  getWhatsAppQr,
  getWhatsAppProfile,
  getContactProfile,
  repopulateConversationFromWhatsApp,
  rebuildAllConversationsFromWhatsApp,
  getCurrentWhatsAppAccountContext,
  disconnectWhatsApp,
  removeWhatsAppSessions,
  normalizePhone: normalizeCustomerPhone
};
