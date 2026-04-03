const path = require("path");
const QRCode = require("qrcode");
const { Client, LocalAuth, Location, MessageMedia } = require("whatsapp-web.js");
const { saveMessage, updateOutgoingMessageStatus, upsertCustomer } = require("./supabase");

let client = null;
let initializationPromise = null;
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
  const rawPhone = String(phone || "").trim();

  if (rawPhone.includes("@c.us") || rawPhone.includes("@g.us")) {
    return rawPhone;
  }

  return `${normalizePhone(rawPhone)}@c.us`;
}

function ackToStatus(ack) {
  if (ack >= 3) {
    return "read";
  }

  if (ack === 2) {
    return "delivered";
  }

  if (ack === 1) {
    return "sent";
  }

  if (ack === -1) {
    return "failed";
  }

  return "queued";
}

function createClient() {
  const authPath = process.env.WHATSAPP_AUTH_DIR || path.join(__dirname, "wwebjs_auth");

  return new Client({
    authStrategy: new LocalAuth({
      clientId: "whatsapp-crm",
      dataPath: authPath
    }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      ...(process.env.PUPPETEER_EXECUTABLE_PATH
        ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH }
        : {})
    }
  });
}

async function initializeWhatsApp() {
  if (client) {
    return client;
  }

  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = new Promise((resolve, reject) => {
    const nextClient = createClient();
    let resolved = false;

    nextClient.on("qr", async (qr) => {
      currentQr = qr;
      currentQrDataUrl = await QRCode.toDataURL(qr);
      connectionState = "qr";
      console.log("\nScan this WhatsApp QR code from /whatsapp/qr\n");
    });

    nextClient.on("ready", () => {
      client = nextClient;
      connectionState = "open";
      currentQr = null;
      currentQrDataUrl = null;
      console.log("WhatsApp is ready.");

      if (!resolved) {
        resolved = true;
        resolve(nextClient);
      }
    });

    nextClient.on("authenticated", () => {
      connectionState = "authenticated";
      console.log("WhatsApp authenticated.");
    });

    nextClient.on("auth_failure", (message) => {
      connectionState = "auth_failure";
      console.error("WhatsApp authentication failed:", message);
    });

    nextClient.on("disconnected", (reason) => {
      connectionState = "disconnected";
      currentQr = null;
      currentQrDataUrl = null;
      client = null;
      initializationPromise = null;
      console.error("WhatsApp disconnected:", reason);

      setTimeout(() => {
        initializeWhatsApp().catch((error) => {
          console.error("Failed to reconnect WhatsApp:", error);
        });
      }, 3000);
    });

    nextClient.on("message", async (message) => {
      const chatJid = getChatKey(message.from);
      const phone = normalizePhone(chatJid);
      const text = String(message.body || "").trim();
      const contactName = message._data?.notifyName || null;

      if (!phone || !text) {
        return;
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
          wa_message_id: message.id?.id || null,
          message: text,
          direction: "incoming"
        });
      } catch (error) {
        console.error("Failed to save incoming message:", error.message);
      }
    });

    nextClient.on("message_ack", async (message, ack) => {
      if (!message.fromMe) {
        return;
      }

      try {
        await updateOutgoingMessageStatus({
          phone: normalizePhone(message.to || message.from),
          chat_jid: getChatKey(message.to || message.from),
          wa_message_id: message.id?.id || null,
          send_status: ackToStatus(ack)
        });
      } catch (error) {
        console.error("Failed to update outgoing message status:", error.message);
      }
    });

    nextClient
      .initialize()
      .catch((error) => {
        initializationPromise = null;
        client = null;
        if (!resolved) {
          reject(error);
        }
      });
  });

  return initializationPromise;
}

function ensureClientReady() {
  if (!client) {
    throw new Error("WhatsApp client is not initialized yet.");
  }

  if (connectionState !== "open") {
    throw new Error("WhatsApp is not connected. Scan the QR and wait for connection.");
  }
}

async function sendMessageToPhone(phone, message, chatJid) {
  ensureClientReady();
  return client.sendMessage(chatJid || toWhatsAppJid(phone), String(message));
}

async function sendAttachmentToPhone({ phone, chatJid, buffer, mimeType, fileName, caption }) {
  ensureClientReady();

  const media = new MessageMedia(
    mimeType || "application/octet-stream",
    Buffer.from(buffer).toString("base64"),
    fileName || "attachment"
  );

  return client.sendMessage(chatJid || toWhatsAppJid(phone), media, {
    caption: caption || undefined,
    sendMediaAsDocument: !(mimeType || "").startsWith("image/")
  });
}

async function sendLocationToPhone({ phone, chatJid, latitude, longitude, name, address }) {
  ensureClientReady();

  const description = [name, address].filter(Boolean).join(" - ") || undefined;
  const location = new Location(Number(latitude), Number(longitude), description);

  return client.sendMessage(chatJid || toWhatsAppJid(phone), location);
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
  if (!client || connectionState !== "open") {
    return {
      profilePictureUrl: null,
      about: null
    };
  }

  try {
    const contact = await client.getContactById(chatJid || toWhatsAppJid(phone));
    const profilePictureUrl = (await contact.getProfilePicUrl().catch(() => null)) || null;
    const about = (await contact.getAbout().catch(() => null)) || null;

    return {
      profilePictureUrl,
      about
    };
  } catch {
    return {
      profilePictureUrl: null,
      about: null
    };
  }
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
