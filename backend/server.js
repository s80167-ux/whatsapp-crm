require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const VALID_CUSTOMER_STATUSES = ["new_lead", "interested", "processing", "closed_won", "closed_lost"];
const {
  createDashboardSession,
  registerUser,
  loginUser,
  requireAuth,
  requireSupabaseAuth,
  revokeDashboardSession
} = require("./auth");
const {
  getConversations,
  getMessagesByPhone,
  saveMessage,
  getCustomerByPhone,
  getCustomerInsights,
  getCustomerSalesItems,
  createCustomerSalesItem,
  updateCustomerSalesItem,
  clearConversationUnreadCount,
  deleteConversation,
  deleteMessage,
  upsertCustomer,
  getWhatsAppSettings,
  upsertWhatsAppProfile
} = require("./supabase");
const {
  initializeWhatsApp,
  sendMessageToPhone,
  sendAttachmentToPhone,
  sendLocationToPhone,
  deleteMessageFromPhone,
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

function isStickerAttachment(mimeType, fileName) {
  const normalizedMimeType = String(mimeType || "").trim().toLowerCase();
  return normalizedMimeType === "image/webp" || /\.webp$/i.test(String(fileName || "").trim());
}

function isAllowedLocalDevOrigin(origin) {
  return /^https?:\/\/(localhost|127\.0\.0\.1):(\d+)$/.test(String(origin || "").trim());
}

function getAttachmentMediaType(mimeType, fileName) {
  const normalizedMimeType = String(mimeType || "").trim().toLowerCase();

  if (isStickerAttachment(normalizedMimeType, fileName)) {
    return "sticker";
  }

  if (normalizedMimeType.startsWith("image/")) {
    return "image";
  }

  if (normalizedMimeType.startsWith("video/")) {
    return "video";
  }

  return "document";
}

function getAttachmentPreviewText(file, caption) {
  const mediaType = getAttachmentMediaType(file?.mimetype, file?.originalname);
  const label = mediaType === "image" ? "Image" : mediaType === "video" ? "Video" : mediaType === "sticker" ? "Sticker" : "Document";
  const trimmedCaption = String(caption || "").trim();

  return trimmedCaption
    ? `[${label}] ${file.originalname} - ${trimmedCaption}`
    : `[${label}] ${file.originalname}`;
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin) || isAllowedLocalDevOrigin(origin)) {
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

whatsappRouter.get("/settings", requireAuth, async (req, res) => {
  try {
    const settings = await getWhatsAppSettings(req.user.sub);
    return res.json(settings);
  } catch (error) {
    console.error("Failed to fetch WhatsApp settings:", error);
    return res.status(500).json({ error: "Failed to fetch WhatsApp settings." });
  }
});

whatsappRouter.put("/settings", requireAuth, async (req, res) => {
  try {
    const { history_sync_days } = req.body;
    if (typeof history_sync_days !== "number" || history_sync_days < 1) {
      return res.status(400).json({ error: "Invalid history sync days." });
    }
    await upsertWhatsAppProfile({ owner_user_id: req.user.sub, history_sync_days });
    const settings = await getWhatsAppSettings(req.user.sub);
    return res.json(settings);
  } catch (error) {
    console.error("Failed to update WhatsApp settings:", error);
    return res.status(500).json({ error: "Failed to update WhatsApp settings." });
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

whatsappRouter.delete("/clear", requireAuth, bindAuthenticatedWhatsAppOwner, async (req, res) => {
  try {
    const owner_user_id = req.user?.sub;
    if (!owner_user_id) throw new Error("No user ID found");

    console.log(`[CLEAR DB] Wiping tables for owner: ${owner_user_id}`);
    const { supabase } = require('./supabase');

    const messageResult = await supabase.from('messages').delete().eq('owner_user_id', owner_user_id);
    if (messageResult.error) console.error(`[CLEAR DB] Message deletion error:`, messageResult.error);
    else console.log(`[CLEAR DB] Messages wiped successfully.`);

    const customerResult = await supabase.from('customers').delete().eq('owner_user_id', owner_user_id);
    if (customerResult.error) console.error(`[CLEAR DB] Customer deletion error:`, customerResult.error);
    else console.log(`[CLEAR DB] Customers wiped successfully.`);

    res.json({ success: true, message: "Database cleared successfully" });
  } catch (error) {
    console.error(`[CLEAR DB] Unhandled error:`, error);
    res.status(500).json({ error: error.message });
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
    const sessionId = await createDashboardSession(result.user.id);
    return res.json({
      ...result,
      sessionId
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || "Failed to log in.",
      code: error.code
    });
  }
});

app.post("/auth/session", requireSupabaseAuth, async (req, res) => {
  try {
    const replaceExisting = req.body?.replaceExisting === true;
    const sessionId = await createDashboardSession(req.user.sub, { replaceExisting });
    return res.status(201).json({ sessionId });
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || "Failed to create dashboard session.",
      code: error.code
    });
  }
});

app.delete("/auth/session", requireSupabaseAuth, async (req, res) => {
  try {
    const sessionId = String(req.headers["x-session-id"] || "").trim() || null;
    await revokeDashboardSession(req.user.sub, sessionId);
    return res.json({ success: true });
  } catch (error) {
    return res.status(error.status || 500).json({
      error: error.message || "Failed to revoke dashboard session."
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

app.post("/conversations/:phone/read", requireAuth, bindAuthenticatedWhatsAppOwner, async (req, res) => {
  try {
    const phone = normalizePhone(req.params.phone);
    const chatJid = typeof req.body?.chatJid === "string" ? req.body.chatJid.trim() || null : null;

    if (!phone && !chatJid) {
      return res.status(400).json({ error: "Phone or chat JID is required." });
    }

    await clearConversationUnreadCount({
      owner_user_id: req.user.sub,
      phone,
      chat_jid: chatJid
    });

    return res.json({ success: true });
  } catch (error) {
    console.error("Failed to clear unread count:", error);
    return res.status(500).json({ error: "Failed to clear unread count." });
  }
});

app.delete("/conversations/:phone", requireAuth, bindAuthenticatedWhatsAppOwner, async (req, res) => {
  try {
    const phone = normalizePhone(req.params.phone);
    const chatJid = typeof req.body?.chatJid === "string" ? req.body.chatJid.trim() || null : null;

    if (!phone && !chatJid) {
      return res.status(400).json({ error: "Phone or chat JID is required." });
    }

    const result = await deleteConversation({
      owner_user_id: req.user.sub,
      phone,
      chat_jid: chatJid
    });

    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("Failed to delete conversation:", error);
    return res.status(500).json({ error: "Failed to delete conversation." });
  }
});

app.delete("/messages/:messageId", requireAuth, bindAuthenticatedWhatsAppOwner, async (req, res) => {
  try {
    const messageId = String(req.params.messageId || "").trim();

    if (!messageId) {
      return res.status(400).json({ error: "Message ID is required." });
    }

    const deletedMessage = await deleteMessage({
      owner_user_id: req.user.sub,
      message_id: messageId
    });

    const whatsapp = await deleteMessageFromPhone({
      phone: deletedMessage.phone,
      chatJid: deletedMessage.chat_jid || null,
      waMessageId: deletedMessage.wa_message_id || null,
      direction: deletedMessage.direction
    });

    return res.json({
      success: true,
      deletedMessageId: deletedMessage.id,
      phone: deletedMessage.phone,
      chatJid: deletedMessage.chat_jid || null,
      whatsapp
    });
  } catch (error) {
    console.error("Failed to delete message:", error);
    return res.status(error.status || 500).json({ error: error.message || "Failed to delete message." });
  }
});


app.get("/messages/:phone", requireAuth, bindAuthenticatedWhatsAppOwner, async (req, res) => {
  try {
    const phone = normalizePhone(req.params.phone);
    const chatJid = typeof req.query?.chatJid === "string" ? req.query.chatJid.trim() || null : null;
    const messages = await getMessagesByPhone(phone, req.user.sub, chatJid);
    return res.json(messages);
  } catch (error) {
    console.error("Failed to fetch messages:", error);
    return res.status(500).json({ error: "Failed to fetch messages." });
  }
});

app.get("/customers/:phone", requireAuth, bindAuthenticatedWhatsAppOwner, async (req, res) => {
  try {
    const phone = normalizePhone(req.params.phone);
    const chatJid = typeof req.query?.chatJid === "string" ? req.query.chatJid.trim() || null : null;
    const customer = await getCustomerInsights(phone, req.user.sub, chatJid);
    const profile = await getContactProfile(phone, customer.chat_jid || chatJid || null);

    // Update DB cache if we got live data from WhatsApp
    if (profile.profilePictureUrl || profile.about) {
      await upsertCustomer({
        owner_user_id: req.user.sub,
        phone,
        chat_jid: customer.chat_jid || chatJid || null,
        profile_picture_url: profile.profilePictureUrl,
        about: profile.about
      }).catch((err) => {
        console.warn(`[PROFILE CACHE] Failed for ${phone}. If you haven't run the SQL migration yet, this is expected:`, err.message);
      });
    }

    return res.json({
      ...customer,
      profile_picture_url: profile.profilePictureUrl || customer.profile_picture_url || null,
      about: profile.about || customer.about || null
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
    const chatJid = typeof req.body?.chatJid === "string" ? req.body.chatJid.trim() || null : null;

    if (!phone && !chatJid) {
      return res.status(400).json({ error: "Phone or chat JID is required." });
    }

    if (!VALID_CUSTOMER_STATUSES.includes(status)) {
      return res.status(400).json({ error: "Status must be one of: new_lead, interested, processing, closed_won, closed_lost." });
    }

    await upsertCustomer({
      owner_user_id: req.user.sub,
      phone,
      chat_jid: chatJid,
      status,
      notes: typeof notes === "string" ? notes : ""
    });

    const customer = await getCustomerInsights(phone, req.user.sub, chatJid);
    const profile = await getContactProfile(phone, customer.chat_jid || chatJid || null);

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

app.get("/customers/:phone/sales-items", requireAuth, bindAuthenticatedWhatsAppOwner, async (req, res) => {
  try {
    const phone = normalizePhone(req.params.phone);
    const chatJid = typeof req.query?.chatJid === "string" ? req.query.chatJid.trim() || null : null;

    if (!phone && !chatJid) {
      return res.status(400).json({ error: "Phone or chat JID is required." });
    }

    const items = await getCustomerSalesItems(phone, req.user.sub, chatJid);
    return res.json(items);
  } catch (error) {
    console.error("Failed to fetch customer sales items:", error);
    return res.status(error.status || 500).json({ error: error.message || "Failed to fetch customer sales items." });
  }
});

app.post("/customers/:phone/sales-items", requireAuth, bindAuthenticatedWhatsAppOwner, async (req, res) => {
  try {
    const phone = normalizePhone(req.params.phone);
    const messageId = String(req.body?.messageId || "").trim();
    const chatJid = typeof req.body?.chatJid === "string" ? req.body.chatJid.trim() || null : null;
    const leadStatus = String(req.body?.status || "").trim();
    const productType = String(req.body?.productType || "").trim();
    const packageName = String(req.body?.packageName || "").trim();
    const price = Number(req.body?.price);
    const quantity = Number(req.body?.quantity);

    if (!phone && !chatJid) {
      return res.status(400).json({ error: "Phone or chat JID is required." });
    }

    if (!messageId) {
      return res.status(400).json({ error: "Message ID is required." });
    }

    if (!VALID_CUSTOMER_STATUSES.includes(leadStatus)) {
      return res.status(400).json({ error: "Status must be one of: new_lead, interested, processing, closed_won, closed_lost." });
    }

    if (!productType || !packageName) {
      return res.status(400).json({ error: "Product type and package are required." });
    }

    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).json({ error: "Price must be a valid non-negative number." });
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ error: "Quantity must be a whole number greater than 0." });
    }

    const customer = await getCustomerByPhone(phone, req.user.sub, chatJid);
    const resolvedChatJid = chatJid || customer.chat_jid || null;

    await upsertCustomer({
      owner_user_id: req.user.sub,
      phone,
      chat_jid: resolvedChatJid
    });

    const item = await createCustomerSalesItem({
      owner_user_id: req.user.sub,
      message_id: messageId,
      phone,
      chat_jid: resolvedChatJid,
      lead_status: leadStatus,
      product_type: productType,
      package_name: packageName,
      price,
      quantity
    });

    return res.status(201).json(item);
  } catch (error) {
    console.error("Failed to create customer sales item:", error);
    return res.status(error.status || 500).json({ error: error.message || "Failed to create customer sales item." });
  }
});

app.put("/customers/:phone/sales-items/:itemId", requireAuth, bindAuthenticatedWhatsAppOwner, async (req, res) => {
  try {
    const phone = normalizePhone(req.params.phone);
    const itemId = String(req.params.itemId || "").trim();
    const chatJid = typeof req.body?.chatJid === "string" ? req.body.chatJid.trim() || null : null;
    const leadStatus = String(req.body?.status || "").trim();
    const productType = String(req.body?.productType || "").trim();
    const packageName = String(req.body?.packageName || "").trim();
    const price = Number(req.body?.price);
    const quantity = Number(req.body?.quantity);

    if (!phone && !chatJid) {
      return res.status(400).json({ error: "Phone or chat JID is required." });
    }

    if (!itemId) {
      return res.status(400).json({ error: "Sales lead item ID is required." });
    }

    if (!VALID_CUSTOMER_STATUSES.includes(leadStatus)) {
      return res.status(400).json({ error: "Status must be one of: new_lead, interested, processing, closed_won, closed_lost." });
    }

    if (!productType || !packageName) {
      return res.status(400).json({ error: "Product type and package are required." });
    }

    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).json({ error: "Price must be a valid non-negative number." });
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ error: "Quantity must be a whole number greater than 0." });
    }

    const customer = await getCustomerByPhone(phone, req.user.sub, chatJid);
    const resolvedChatJid = chatJid || customer.chat_jid || null;

    const item = await updateCustomerSalesItem({
      owner_user_id: req.user.sub,
      item_id: itemId,
      phone,
      chat_jid: resolvedChatJid,
      lead_status: leadStatus,
      product_type: productType,
      package_name: packageName,
      price,
      quantity
    });

    return res.json(item);
  } catch (error) {
    console.error("Failed to update customer sales item:", error);
    return res.status(error.status || 500).json({ error: error.message || "Failed to update customer sales item." });
  }
});

app.post("/send", requireAuth, bindAuthenticatedWhatsAppOwner, async (req, res) => {
  try {
    const { phone, message, chatJid } = req.body;
    const normalizedPhone = normalizePhone(phone);

    if ((!normalizedPhone && !chatJid) || !message) {
      return res.status(400).json({ error: "Message and a phone or chat JID are required." });
    }

    const customer = await getCustomerByPhone(normalizedPhone, req.user.sub, chatJid || null);
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

    if ((!normalizedPhone && !chatJid) || !file) {
      return res.status(400).json({ error: "File and a phone or chat JID are required." });
    }

    const customer = await getCustomerByPhone(normalizedPhone, req.user.sub, chatJid || null);
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

    const previewText = getAttachmentPreviewText(file, caption);
    const mediaType = getAttachmentMediaType(file.mimetype, file.originalname);
    const mediaDataUrl = `data:${file.mimetype || "application/octet-stream"};base64,${file.buffer.toString("base64")}`;

    const savedMessage = await saveMessage({
      owner_user_id: req.user.sub,
      phone: normalizedPhone,
      chat_jid: resolvedChatJid,
      wa_message_id: result?.key?.id || null,
      message: previewText,
      media_type: mediaType,
      media_mime_type: file.mimetype || "application/octet-stream",
      media_file_name: file.originalname,
      media_data_url: mediaDataUrl,
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

    if ((!normalizedPhone && !chatJid) || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: "Latitude, longitude, and a phone or chat JID are required." });
    }

    const customer = await getCustomerByPhone(normalizedPhone, req.user.sub, chatJid || null);
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

const server = app.listen(port, async () => {
  console.log(`Backend listening on http://localhost:${port}`);

  try {
    await initializeWhatsApp();
  } catch (error) {
    console.error("Failed to initialize WhatsApp:", error);
  }
});

server.on("error", (error) => {
  if (error?.code === "EADDRINUSE") {
    console.error(
      `Port ${port} is already in use. Stop the existing backend process on port ${port} before running npm run dev again.`
    );
    process.exit(1);
    return;
  }

  console.error("Backend server failed to start:", error);
  process.exit(1);
});

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`Received ${signal}. Shutting down backend server...`);

  server.close((error) => {
    if (error) {
      console.error("Failed to close backend server cleanly:", error);
      process.exit(1);
      return;
    }

    process.exit(0);
  });

  setTimeout(() => {
    console.warn("Forcing backend shutdown after timeout.");
    process.exit(1);
  }, 5000).unref();
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
