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
  lastMessage: string;
  timestamp: string;
  lastDirection: "incoming" | "outgoing";
  status: "hot" | "warm" | "cold";
};

export type Message = {
  id: string;
  phone: string;
  chat_jid?: string | null;
  wa_message_id?: string | null;
  message: string;
  direction: "incoming" | "outgoing";
  created_at: string;
  send_status?: "sending" | "queued" | "sent" | "delivered" | "read" | "failed";
};

export type Customer = {
  phone: string;
  chat_jid?: string | null;
  contact_name?: string | null;
  status: "hot" | "warm" | "cold";
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

const configuredApiUrl = import.meta.env.VITE_API_URL;
const isLocalhost =
  typeof window !== "undefined" &&
  ["localhost", "127.0.0.1"].includes(window.location.hostname);
const API_URL = configuredApiUrl || (isLocalhost ? "http://localhost:4000" : "");

function getApiUrl() {
  if (!API_URL) {
    throw new Error(
      "Missing backend API URL. Set VITE_API_URL to your deployed backend URL before using the dashboard."
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
    throw new Error((data as { error?: string }).error || "Request failed.");
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
  disconnectWhatsApp(token: string) {
    return request<WhatsAppStatus>(
      "/whatsapp/disconnect",
      {
        method: "POST"
      },
      token
    );
  },
  getConversations(token: string) {
    return request<Conversation[]>("/conversations", {}, token);
  },
  getMessages(phone: string, token: string) {
    return request<Message[]>(`/messages/${phone}`, {}, token);
  },
  getCustomer(phone: string, token: string) {
    return request<Customer>(`/customers/${phone}`, {}, token);
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
