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
  const state = String(account?.connection_state || "").trim().toLowerCase();
  return ["open", "qr", "connecting", "disconnecting"].includes(state);
}

function getSessionAuthDir(account) {
  const configuredDir = String(account?.auth_dir || "").trim();
  return configuredDir ? path.resolve(configuredDir) : path.join(baseAuthDir, String(account?.id || crypto.randomUUID()));
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
    reconnectTimer: null,
    fallbackSyncTimer: null,
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
    return await getWhatsAppAccountById(normalizedOwnerId, normalizedAccountId);
  }

  const accounts = await getWhatsAppAccounts(normalizedOwnerId);
  const openAccount =
    accounts.find((account) => String(account.connection_state || "").trim().toLowerCase() === "open") || null;

  return openAccount || accounts[0] || null;
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

function extractContactName(msg) {
  const candidates = [
    msg?.pushName,
    msg?.verifiedBizName,
    msg?.message?.contactMessage?.displayName,
    msg?.message?.contactsArrayMessage?.displayName
  ];

  for (const candidate of candidates) {
    const normalized = String(candidate || "").trim();
    if (normalized) {
      return normalized;
    }
  }

  return null;
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
    unread_count: unreadCount,
    profile_picture_url: profilePictureUrl || undefined,
    about: about || undefined
  }).catch((err) => console.warn("Failed to upsert history customer", err.message));
}

async function persistIncomingMessage(session, msg) {
  if (!msg?.message || !msg?.key?.remoteJid) return;
  if (msg.key.remoteJid === "status@broadcast" || msg.key.remoteJid.endsWith("@g.us")) return;

  const phone = await resolveWhatsAppPhone(msg.key.remoteJid, msg.key.remoteJid);
  const text = buildIncomingMessagePreview(msg.message);
  const media = await extractIncomingMedia(session, msg.message);
  const contactName = extractContactName(msg);
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
      send_status: "sent"
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
          session.qrData = await QRCode.toDataURL(qr);
          session.connectionState = "qr";
          await syncSessionAccountState(session, { connection_state: "qr" }).catch(() => {});
        }

        if (connection === "open") {
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
          const statusCode =
            lastDisconnect?.error instanceof Boom ? lastDisconnect.error.output.statusCode : undefined;
          session.qrData = null;
          if (isCurrentSocket()) {
            session.sock = null;
          }
          session.historySyncObserved = false;
          clearFallbackSyncTimer(session);

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

    activeSock.ev.on("messaging-history.set", ({ chats, contacts, messages }) => {
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

          if (Array.isArray(contacts)) {
            for (const contact of contacts) {
              if (contact?.id) {
                contactsByJid.set(contact.id, contact);
              }
            }
          }

          if (Array.isArray(contacts)) {
            await fs.writeFile(path.join(session.authDir, "hist_contacts.json"), JSON.stringify(contacts, null, 2)).catch(
              () => {}
            );
            await fs.writeFile(path.join(session.authDir, "hist_chats.json"), JSON.stringify(chats, null, 2)).catch(
              () => {}
            );

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
                unreadCount: typeof chat.unreadCount === "number" ? chat.unreadCount : undefined
              });
            }
          }

          const safeMessages = Array.isArray(messages) ? messages : [];
          const recentMessages = safeMessages.filter(
            (m) => extractMessageTimestampSeconds(m?.messageTimestamp) >= cutoffSecs
          );

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
      });
    });

    return activeSock;
  })().finally(() => {
    session.initializingPromise = null;
  });

  return session.initializingPromise;
}

async function getWhatsAppStatus(ownerUserId, accountId) {
  const session = await ensureSession(ownerUserId, accountId, {
    initialize: false
  });

  if (!session) {
    return defaultStatus();
  }

  return defaultStatus(session.connectionState, session.qrData);
}

async function getWhatsAppQr(ownerUserId, accountId) {
  const session = await ensureSession(ownerUserId, accountId, {
    initialize: false
  });

  if (!session) {
    return {
      connected: false,
      state: "disconnected",
      qr: null
    };
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
  sendMessageToPhone,
  sendAttachmentToPhone,
  sendLocationToPhone,
  deleteMessageFromPhone,
  getWhatsAppStatus,
  getWhatsAppQr,
  getWhatsAppProfile,
  getContactProfile,
  getCurrentWhatsAppAccountContext,
  disconnectWhatsApp,
  removeWhatsAppSessions,
  normalizePhone: normalizeCustomerPhone
};
