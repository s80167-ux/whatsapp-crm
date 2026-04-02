const path = require("path");
const pino = require("pino");
const QRCode = require("qrcode");
const qrcode = require("qrcode-terminal");
const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  WAMessageStatus,
  useMultiFileAuthState
} = require("@whiskeysockets/baileys");
const { saveMessage, updateOutgoingMessageStatus, upsertCustomer } = require("./supabase");

let socket;
let connectionState = "connecting";
let currentQr = null;
let currentQrDataUrl = null;

function normalizePhone(rawPhone) {
  return String(rawPhone || "").replace(/\D/g, "");
}

function getChatKey(jid) {
  return String(jid || "").trim();
}

function toWhatsAppJid(phone) {
  const rawPhone = String(phone || "");

  if (rawPhone.includes("@s.whatsapp.net")) {
    return rawPhone;
  }

  const normalized = normalizePhone(rawPhone);
  return `${normalized}@s.whatsapp.net`;
}

function extractText(message) {
  return (
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    ""
  );
}

function getSendStatusLabel(status) {
  if (status === WAMessageStatus.READ || status === WAMessageStatus.PLAYED) {
    return "read";
  }

  if (status === WAMessageStatus.DELIVERY_ACK) {
    return "delivered";
  }

  if (status === WAMessageStatus.SERVER_ACK) {
    return "sent";
  }

  return "queued";
}

async function initializeWhatsApp() {
  const authDir = path.join(__dirname, "baileys_auth");
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  socket = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false,
    logger: pino({ level: "silent" }),
    browser: ["whatsapp-crm", "Chrome", "1.0.0"]
  });

  socket.ev.on("creds.update", saveCreds);

  socket.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      currentQr = qr;
      currentQrDataUrl = await QRCode.toDataURL(qr);
      console.log("\nScan this WhatsApp QR code:\n");
      qrcode.generate(qr, { small: true });
    }

    if (connection) {
      connectionState = connection;
      if (connection === "open") {
        currentQr = null;
        currentQrDataUrl = null;
      }
      console.log(`WhatsApp connection: ${connection}`);
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      if (shouldReconnect) {
        initializeWhatsApp().catch((error) => {
          console.error("Failed to reconnect WhatsApp:", error);
        });
      } else {
        console.error("WhatsApp session logged out. Delete backend/baileys_auth and reconnect.");
      }
    }
  });

  socket.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") {
      return;
    }

    for (const item of messages) {
      const chatJid = getChatKey(item.key.remoteJid);
      const phone = normalizePhone(chatJid);
      const text = extractText(item.message);
      const contactName = item.pushName || item.verifiedBizName || null;

      if (!phone || !text || item.key.fromMe) {
        continue;
      }

      try {
        await upsertCustomer({
          phone,
          chat_jid: chatJid,
          contact_name: contactName
        });
        await saveMessage({
          phone,
          chat_jid: chatJid,
          message: text,
          direction: "incoming"
        });
      } catch (error) {
        console.error("Failed to save incoming message:", error.message);
      }
    }
  });

  socket.ev.on("messages.update", async (updates) => {
    for (const item of updates) {
      const waMessageId = item.key?.id;
      const phone = normalizePhone(item.key?.remoteJid);
      const chatJid = getChatKey(item.key?.remoteJid);
      const sendStatus = getSendStatusLabel(item.update?.status);

      if (!item.key?.fromMe || !waMessageId) {
        continue;
      }

      try {
        await updateOutgoingMessageStatus({
          phone,
          chat_jid: chatJid,
          wa_message_id: waMessageId,
          send_status: sendStatus
        });
      } catch (error) {
        console.error("Failed to update outgoing message status:", error.message);
      }
    }
  });

  socket.ev.on("message-receipt.update", async (updates) => {
    for (const item of updates) {
      const waMessageId = item.key?.id;
      const phone = normalizePhone(item.key?.remoteJid);
      const chatJid = getChatKey(item.key?.remoteJid);
      const sendStatus = item.receipt?.readTimestamp ? "read" : item.receipt?.receiptTimestamp ? "delivered" : null;

      if (!item.key?.fromMe || !waMessageId || !sendStatus) {
        continue;
      }

      try {
        await updateOutgoingMessageStatus({
          phone,
          chat_jid: chatJid,
          wa_message_id: waMessageId,
          send_status: sendStatus
        });
      } catch (error) {
        console.error("Failed to update outgoing receipt status:", error.message);
      }
    }
  });
}

async function sendMessageToPhone(phone, message, chatJid) {
  ensureSocketReady();

  return socket.sendMessage(chatJid || toWhatsAppJid(phone), { text: message });
}

function ensureSocketReady() {
  if (!socket) {
    throw new Error("WhatsApp socket is not initialized yet.");
  }

  if (connectionState !== "open") {
    throw new Error("WhatsApp is not connected. Scan the QR and wait for connection.");
  }
}

async function sendAttachmentToPhone({ phone, chatJid, buffer, mimeType, fileName, caption }) {
  ensureSocketReady();

  const jid = chatJid || toWhatsAppJid(phone);
  const normalizedMimeType = mimeType || "application/octet-stream";
  const isImage = normalizedMimeType.startsWith("image/");
  const payload = isImage
    ? {
        image: buffer,
        mimetype: normalizedMimeType,
        caption: caption || undefined
      }
    : {
        document: buffer,
        mimetype: normalizedMimeType,
        fileName: fileName || "attachment",
        caption: caption || undefined
      };

  return socket.sendMessage(jid, payload);
}

async function sendLocationToPhone({ phone, chatJid, latitude, longitude, name, address }) {
  ensureSocketReady();

  const jid = chatJid || toWhatsAppJid(phone);

  return socket.sendMessage(jid, {
    location: {
      degreesLatitude: Number(latitude),
      degreesLongitude: Number(longitude),
      name: name || undefined,
      address: address || undefined
    }
  });
}

function getWhatsAppStatus() {
  return {
    connected: connectionState === "open",
    state: connectionState,
    hasQr: Boolean(currentQrDataUrl)
  };
}

function getWhatsAppQr() {
  return {
    connected: connectionState === "open",
    state: connectionState,
    qr: currentQrDataUrl
  };
}

async function getContactProfile(phone, chatJid) {
  if (!socket || connectionState !== "open") {
    return {
      profilePictureUrl: null,
      about: null
    };
  }

  const jid = chatJid || toWhatsAppJid(phone);

  let profilePictureUrl = null;
  let about = null;

  try {
    profilePictureUrl = await socket.profilePictureUrl(jid, "image");
  } catch {
    profilePictureUrl = null;
  }

  try {
    if (typeof socket.fetchStatus === "function") {
      const status = await socket.fetchStatus(jid);
      about = status?.status || null;
    }
  } catch {
    about = null;
  }

  return {
    profilePictureUrl,
    about
  };
}

module.exports = {
  initializeWhatsApp,
  sendMessageToPhone,
  sendAttachmentToPhone,
  sendLocationToPhone,
  getWhatsAppStatus,
  getWhatsAppQr,
  getContactProfile,
  normalizePhone
};
