require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { registerUser, loginUser, requireAuth } = require("./auth");
const {
  getConversations,
  getMessagesByPhone,
  saveMessage,
  getCustomerByPhone,
  getCustomerInsights,
  upsertCustomer
} = require("./supabase");
const {
  initializeWhatsApp,
  sendMessageToPhone,
  sendAttachmentToPhone,
  sendLocationToPhone,
  getWhatsAppStatus,
  getWhatsAppQr,
  getWhatsAppProfile,
  disconnectWhatsApp,
  getContactProfile,
  bindWhatsAppOwner,
  normalizePhone
} = require("./whatsapp");

if (
  !process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !process.env.SUPABASE_PUBLISHABLE_KEY &&
  !process.env.SUPABASE_ANON_KEY
) {
  throw new Error("Missing Supabase key in backend/.env");
}

const app = express();
const whatsappRouter = express.Router();
const port = process.env.PORT || 4000;
const allowedOrigins = new Set(
  [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://rezekicrm.vercel.app",
    ...String(process.env.FRONTEND_URL || "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  ]
);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024
  }
});

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed by CORS.`));
    }
  })
);
app.use(express.json());

function bindAuthenticatedWhatsAppOwner(req, _res, next) {
  bindWhatsAppOwner(req.user?.sub || null);
  next();
}

app.get("/", (_req, res) => {
  res.json({
    name: "whatsapp-crm-backend",
    ok: true,
    routes: {
      health: "/health",
      whatsappStatus: "/whatsapp/status",
      whatsappQr: "/whatsapp/qr",
      whatsappProfile: "/whatsapp/profile",
      whatsappDisconnect: "/whatsapp/disconnect",
      register: "/register",
      login: "/login",
      conversations: "/conversations",
      messages: "/messages/:phone",
      send: "/send",
      customer: "/customers/:phone"
    }
  });
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    whatsapp: getWhatsAppStatus()
  });
});

whatsappRouter.get("/status", (_req, res) => {
  res.json(getWhatsAppStatus());
});

whatsappRouter.get("/qr", (_req, res) => {
  res.json(getWhatsAppQr());
});

whatsappRouter.get("/profile", requireAuth, bindAuthenticatedWhatsAppOwner, async (_req, res) => {
  try {
    return res.json(await getWhatsAppProfile());
  } catch (error) {
    console.error("Failed to fetch WhatsApp profile:", error);
    return res.status(500).json({ error: "Failed to fetch WhatsApp profile." });
  }
});

whatsappRouter.post("/disconnect", requireAuth, bindAuthenticatedWhatsAppOwner, async (_req, res) => {
  try {
    const status = await disconnectWhatsApp();
    return res.json(status);
  } catch (error) {
    console.error("Failed to disconnect WhatsApp:", error);
    return res.status(500).json({ error: "Failed to disconnect WhatsApp." });
  }
});

app.use("/whatsapp", whatsappRouter);

app.post("/register", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const result = await registerUser(email, password);
    return res.status(201).json(result);
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || "Failed to register user."
    });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const result = await loginUser(email, password);
    return res.json(result);
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || "Failed to log in."
    });
  }
});

app.get("/conversations", requireAuth, bindAuthenticatedWhatsAppOwner, async (req, res) => {
  try {
    const conversations = await getConversations(req.user.sub);
    return res.json(conversations);
  } catch (error) {
    console.error("Failed to fetch conversations:", error);
    return res.status(500).json({ error: "Failed to fetch conversations." });
  }
});

app.get("/messages/:phone", requireAuth, bindAuthenticatedWhatsAppOwner, async (req, res) => {
  try {
    const phone = normalizePhone(req.params.phone);
    const messages = await getMessagesByPhone(phone, req.user.sub);
    return res.json(messages);
  } catch (error) {
    console.error("Failed to fetch messages:", error);
    return res.status(500).json({ error: "Failed to fetch messages." });
  }
});

app.get("/customers/:phone", requireAuth, bindAuthenticatedWhatsAppOwner, async (req, res) => {
  try {
    const phone = normalizePhone(req.params.phone);
    const customer = await getCustomerInsights(phone, req.user.sub);
    const profile = await getContactProfile(phone, customer.chat_jid || null);
    return res.json({
      ...customer,
      profile_picture_url: profile.profilePictureUrl,
      about: profile.about
    });
  } catch (error) {
    console.error("Failed to fetch customer:", error);
    return res.status(500).json({ error: "Failed to fetch customer." });
  }
});

app.put("/customers/:phone", requireAuth, bindAuthenticatedWhatsAppOwner, async (req, res) => {
  try {
    const phone = normalizePhone(req.params.phone);
    const { status, notes } = req.body;

    if (!phone) {
      return res.status(400).json({ error: "Phone is required." });
    }

    if (!["hot", "warm", "cold"].includes(status)) {
      return res.status(400).json({ error: "Status must be hot, warm, or cold." });
    }

    await upsertCustomer({
      owner_user_id: req.user.sub,
      phone,
      status,
      notes: typeof notes === "string" ? notes : ""
    });

    const customer = await getCustomerInsights(phone, req.user.sub);
    const profile = await getContactProfile(phone, customer.chat_jid || null);

    return res.json({
      ...customer,
      profile_picture_url: profile.profilePictureUrl,
      about: profile.about
    });
  } catch (error) {
    console.error("Failed to save customer:", error);
    return res.status(500).json({ error: "Failed to save customer." });
  }
});

app.post("/send", requireAuth, bindAuthenticatedWhatsAppOwner, async (req, res) => {
  try {
    const { phone, message, chatJid } = req.body;
    const normalizedPhone = normalizePhone(phone);

    if (!normalizedPhone || !message) {
      return res.status(400).json({ error: "Phone and message are required." });
    }

    const customer = await getCustomerByPhone(normalizedPhone, req.user.sub);
    const resolvedChatJid = chatJid || customer.chat_jid || null;

    const result = await sendMessageToPhone(normalizedPhone, message, resolvedChatJid);

    await upsertCustomer({
      owner_user_id: req.user.sub,
      phone: normalizedPhone,
      chat_jid: resolvedChatJid
    });

    const savedMessage = await saveMessage({
      owner_user_id: req.user.sub,
      phone: normalizedPhone,
      chat_jid: resolvedChatJid,
      wa_message_id: result?.key?.id || null,
      message,
      direction: "outgoing",
      send_status: "sent"
    });

    return res.status(201).json(savedMessage);
  } catch (error) {
    console.error("Failed to send message:", error);
    return res.status(500).json({
      error: error.message || "Failed to send message."
    });
  }
});

app.post("/send/attachment", requireAuth, bindAuthenticatedWhatsAppOwner, upload.single("file"), async (req, res) => {
  try {
    const normalizedPhone = normalizePhone(req.body.phone);
    const { chatJid, caption } = req.body;
    const file = req.file;

    if (!normalizedPhone || !file) {
      return res.status(400).json({ error: "Phone and file are required." });
    }

    const customer = await getCustomerByPhone(normalizedPhone, req.user.sub);
    const resolvedChatJid = chatJid || customer.chat_jid || null;
    const result = await sendAttachmentToPhone({
      phone: normalizedPhone,
      chatJid: resolvedChatJid,
      buffer: file.buffer,
      mimeType: file.mimetype,
      fileName: file.originalname,
      caption
    });

    await upsertCustomer({
      owner_user_id: req.user.sub,
      phone: normalizedPhone,
      chat_jid: resolvedChatJid
    });

    const label = file.mimetype.startsWith("image/") ? "Image" : "Document";
    const previewText = caption?.trim()
      ? `[${label}] ${file.originalname} - ${caption.trim()}`
      : `[${label}] ${file.originalname}`;

    const savedMessage = await saveMessage({
      owner_user_id: req.user.sub,
      phone: normalizedPhone,
      chat_jid: resolvedChatJid,
      wa_message_id: result?.key?.id || null,
      message: previewText,
      direction: "outgoing",
      send_status: "sent"
    });

    return res.status(201).json(savedMessage);
  } catch (error) {
    console.error("Failed to send attachment:", error);
    return res.status(500).json({
      error: error.message || "Failed to send attachment."
    });
  }
});

app.post("/send/location", requireAuth, bindAuthenticatedWhatsAppOwner, async (req, res) => {
  try {
    const normalizedPhone = normalizePhone(req.body.phone);
    const { chatJid, latitude, longitude, name, address } = req.body;

    if (!normalizedPhone || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: "Phone, latitude, and longitude are required." });
    }

    const customer = await getCustomerByPhone(normalizedPhone, req.user.sub);
    const resolvedChatJid = chatJid || customer.chat_jid || null;
    const result = await sendLocationToPhone({
      phone: normalizedPhone,
      chatJid: resolvedChatJid,
      latitude,
      longitude,
      name,
      address
    });

    await upsertCustomer({
      owner_user_id: req.user.sub,
      phone: normalizedPhone,
      chat_jid: resolvedChatJid
    });

    const locationName = String(name || address || `${latitude}, ${longitude}`).trim();
    const savedMessage = await saveMessage({
      owner_user_id: req.user.sub,
      phone: normalizedPhone,
      chat_jid: resolvedChatJid,
      wa_message_id: result?.key?.id || null,
      message: `[Location] ${locationName}`,
      direction: "outgoing",
      send_status: "sent"
    });

    return res.status(201).json(savedMessage);
  } catch (error) {
    console.error("Failed to send location:", error);
    return res.status(500).json({
      error: error.message || "Failed to send location."
    });
  }
});

initializeWhatsApp().catch((error) => {
  console.error("Failed to initialize WhatsApp:", error);
});

console.log(
  "Registered WhatsApp routes:",
  whatsappRouter.stack
    .filter((layer) => layer.route)
    .map((layer) => {
      const methods = Object.keys(layer.route.methods)
        .filter((method) => layer.route.methods[method])
        .map((method) => method.toUpperCase())
        .join(",");

      return `${methods} /whatsapp${layer.route.path}`;
    })
    .join(" | ")
);

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
