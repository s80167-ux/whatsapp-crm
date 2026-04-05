export const CUSTOMER_STATUSES = ["new_lead", "interested", "processing", "closed_won", "closed_lost"] as const;

export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const CUSTOMER_STATUS_LABELS: Record<CustomerStatus, string> = {
  new_lead: "New Lead",
  interested: "Interested",
  processing: "Processing",
  closed_won: "Close Won",
  closed_lost: "Close Lost"
};

export type AuthResponse = {
  token: string;
  user: {
    id: string;
    email: string;
  };
};

export type Conversation = {
  phone: string;
  chatJid: string | null;
  contactName: string | null;
  profilePictureUrl?: string | null;
  lastMessage: string;
  timestamp: string;
  lastDirection: "incoming" | "outgoing";
  status: CustomerStatus;
  unreadCount?: number;
};

export type Message = {
  id: string;
  phone: string;
  chat_jid?: string | null;
  wa_message_id?: string | null;
  message: string;
  media_type?: string | null;
  media_mime_type?: string | null;
  media_file_name?: string | null;
  media_data_url?: string | null;
  direction: "incoming" | "outgoing";
  created_at: string;
  send_status?: "sending" | "queued" | "sent" | "delivered" | "read" | "failed";
};

export type Customer = {
  phone: string;
  chat_jid?: string | null;
  contact_name?: string | null;
  status: CustomerStatus;
  notes: string;
  updated_at?: string;
  profile_picture_url?: string | null;
  about?: string | null;
  total_messages?: number;
  incoming_count?: number;
  outgoing_count?: number;
  last_message_at?: string | null;
  last_message_preview?: string | null;
  last_direction?: "incoming" | "outgoing" | null;
};

export type SalesLeadItem = {
  id: string;
  message_id: string;
  phone: string;
  chat_jid?: string | null;
  product_type: string;
  package_name: string;
  price: number;
  quantity: number;
  created_at: string;
  updated_at?: string;
};

export type WhatsAppStatus = {
  connected: boolean;
  state: string;
  hasQr: boolean;
};

export type WhatsAppQr = {
  connected: boolean;
  state: string;
  qr: string | null;
};

export type WhatsAppProfile = {
  connected: boolean;
  phone: string | null;
  username: string | null;
  profilePictureUrl: string | null;
  businessProfile: {
    description: string | null;
    email: string | null;
    category: string | null;
    address: string | null;
    website: string[];
    businessHours: {
      timezone?: string;
      config?: Array<{
        day_of_week: string;
        mode: string;
        open_time?: number;
        close_time?: number;
      }>;
      business_config?: Array<{
        day_of_week: string;
        mode: string;
        open_time?: number;
        close_time?: number;
      }>;
    } | null;
  } | null;
  catalog: {
    products: Array<{
      id: string;
      name: string;
      description: string | null;
      price: number;
      currency: string;
      url: string | null;
      availability: string | null;
      imageUrl: string | null;
    }>;
  } | null;
};

export type WhatsAppSettings = {
  history_sync_days: number;
};

export type DeleteMessageResponse = {
  success: boolean;
  deletedMessageId: string;
  phone: string;
  chatJid?: string | null;
  whatsapp: {
    attempted: boolean;
    deleted: boolean;
    warning?: string | null;
  };
};

const configuredApiUrl = import.meta.env.VITE_API_URL;
const isLocalhost =
  typeof window !== "undefined" &&
  ["localhost", "127.0.0.1"].includes(window.location.hostname);
const API_URL = isLocalhost ? configuredApiUrl || "http://localhost:4000" : "/api";

function getApiUrl() {
  if (!API_URL) {
    throw new Error(
      "Missing backend API URL. Set VITE_API_URL for local development before using the dashboard."
    );
  }

  return API_URL.replace(/\/$/, "");
}

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers);
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;

  if (!isFormData) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;

  try {
    response = await fetch(`${getApiUrl()}${path}`, {
      ...init,
      headers
    });
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Failed to reach backend API at ${getApiUrl()}. ${error.message}`
        : `Failed to reach backend API at ${getApiUrl()}.`
    );
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
  const payloadError = (data as { error?: string }).error;
  if (payloadError) {
    throw new Error(payloadError);
  }

  throw new Error(`Request failed (${response.status} ${response.statusText || "Unknown error"}).`);
  }

  return data as T;
}

export const api = {
  login(email: string, password: string) {
    return request<AuthResponse>("/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
  },
  register(email: string, password: string) {
    return request<AuthResponse>("/register", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
  },
  getWhatsAppStatus() {
    return request<WhatsAppStatus>("/whatsapp/status");
  },
  getWhatsAppQr() {
    return request<WhatsAppQr>("/whatsapp/qr");
  },
  getWhatsAppProfile(token: string) {
    return request<WhatsAppProfile>("/whatsapp/profile", {}, token);
  },
  clearDatabase(token: string) {
    return request<{ success: boolean; message: string }>(
      "/whatsapp/clear",
      { method: "DELETE" },
      token
    );
  },
  disconnectWhatsApp(token: string) {
    return request<WhatsAppStatus>(
      "/whatsapp/disconnect",
      {
        method: "POST"
      },
      token
    );
  },
  getWhatsAppSettings(token: string) {
    return request<WhatsAppSettings>("/whatsapp/settings", {}, token);
  },
  updateWhatsAppSettings(history_sync_days: number, token: string) {
    return request<WhatsAppSettings>(
      "/whatsapp/settings",
      {
        method: "PUT",
        body: JSON.stringify({ history_sync_days })
      },
      token
    );
  },
  getConversations(token: string) {
    return request<Conversation[]>("/conversations", {}, token);
  },
  markConversationRead(phone: string, token: string, chatJid?: string | null) {
    return request<{ success: boolean }>(
      `/conversations/${phone}/read`,
      {
        method: "POST",
        body: JSON.stringify({ chatJid: chatJid || null })
      },
      token
    );
  },
  deleteConversation(phone: string, token: string, chatJid?: string | null) {
    return request<{ success: boolean; deletedMessages: number; deletedCustomers: number }>(
      `/conversations/${phone}`,
      {
        method: "DELETE",
        body: JSON.stringify({ chatJid: chatJid || null })
      },
      token
    );
  },
  deleteMessage(messageId: string, token: string) {
    return request<DeleteMessageResponse>(
      `/messages/${messageId}`,
      {
        method: "DELETE"
      },
      token
    );
  },
  getMessages(phone: string, token: string) {
    return request<Message[]>(`/messages/${phone}`, {}, token);
  },
  getCustomer(phone: string, token: string) {
    return request<Customer>(`/customers/${phone}`, {}, token);
  },
  getCustomerSalesItems(phone: string, token: string, chatJid?: string | null) {
    const params = new URLSearchParams();

    if (chatJid) {
      params.set("chatJid", chatJid);
    }

    return request<SalesLeadItem[]>(`/customers/${phone}/sales-items${params.size ? `?${params.toString()}` : ""}`, {}, token);
  },
  saveCustomer(phone: string, payload: Pick<Customer, "status" | "notes">, token: string) {
    return request<Customer>(
      `/customers/${phone}`,
      {
        method: "PUT",
        body: JSON.stringify(payload)
      },
      token
    );
  },
  createCustomerSalesItem(
    phone: string,
    payload: {
      messageId: string;
      chatJid?: string | null;
      productType: string;
      packageName: string;
      price: number;
      quantity: number;
    },
    token: string
  ) {
    return request<SalesLeadItem>(
      `/customers/${phone}/sales-items`,
      {
        method: "POST",
        body: JSON.stringify(payload)
      },
      token
    );
  },
  sendMessage(phone: string, message: string, token: string, chatJid?: string | null) {
    return request<Message>(
      "/send",
      {
        method: "POST",
        body: JSON.stringify({ phone, message, chatJid })
      },
      token
    );
  },
  sendAttachment(
    phone: string,
    file: File,
    token: string,
    options?: {
      chatJid?: string | null;
      caption?: string;
    }
  ) {
    const formData = new FormData();
    formData.append("phone", phone);
    formData.append("file", file);

    if (options?.chatJid) {
      formData.append("chatJid", options.chatJid);
    }

    if (options?.caption) {
      formData.append("caption", options.caption);
    }

    return request<Message>(
      "/send/attachment",
      {
        method: "POST",
        body: formData
      },
      token
    );
  },
  sendLocation(
    phone: string,
    payload: {
      latitude: number;
      longitude: number;
      name?: string;
      address?: string;
      chatJid?: string | null;
    },
    token: string
  ) {
    return request<Message>(
      "/send/location",
      {
        method: "POST",
        body: JSON.stringify({
          phone,
          latitude: payload.latitude,
          longitude: payload.longitude,
          name: payload.name,
          address: payload.address,
          chatJid: payload.chatJid
        })
      },
      token
    );
  }
};
