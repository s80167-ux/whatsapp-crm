// ...existing code...

// ...existing code above...
// Remove duplicate export and merge all api methods into a single export below
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
  sessionId?: string;
  user: {
    id: string;
    email: string;
  };
};

export type DashboardSessionResponse = {
  sessionId: string;
};

export type Conversation = {
  phone: string;
  chatJid: string | null;
  whatsappAccountId?: string | null;
  sourceAccountPhone?: string | null;
  sourceDisplayName?: string | null;
  sourceConnectionState?: string | null;
  contactName: string | null;
  profilePictureUrl?: string | null;
  lastMessage: string;
  timestamp: string;
  latestReceivedAt?: string | null;
  lastDirection: "incoming" | "outgoing";
  status: CustomerStatus | null;
  status_counts?: Record<CustomerStatus, number>;
  unreadCount?: number;
};

export type Message = {
  id: string;
  phone: string;
  whatsapp_account_id?: string | null;
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
  id?: string;
  phone: string;
  whatsapp_account_id?: string | null;
  chat_jid?: string | null;
  contact_name?: string | null;
  status: CustomerStatus;
  status_counts?: Record<CustomerStatus, number>;
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
  // Added fields for extended customer info
  premise_address?: string | null;
  business_type?: string | null;
  age?: number | null;
  email_address?: string | null;
  contact_id?: string | null;
};

export type SalesLeadItem = {
  id: string;
  message_id: string;
  phone: string;
  whatsapp_account_id?: string | null;
  chat_jid?: string | null;
  lead_status?: CustomerStatus;
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

export type WhatsAppAccount = {
  id: string;
  owner_user_id: string;
  account_phone: string | null;
  account_jid: string | null;
  display_name: string | null;
  profile_picture_url: string | null;
  auth_dir: string | null;
  connection_state: string;
  is_active: boolean;
  last_connected_at: string | null;
  created_at: string;
  updated_at: string;
};

export type WhatsAppAccountCleanupResponse = {
  success: boolean;
  removedInvalidCount: number;
  removedDuplicateCount: number;
  removedIds: string[];
  remainingCount: number;
  accounts: WhatsAppAccount[];
};

export type UserProfile = {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  last_sign_in_at: string | null;
  created_at: string | null;
  updated_at: string | null;
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

export type ConversationRepopulateResponse = {
  success: boolean;
  phone: string | null;
  chatJid: string | null;
  whatsappAccountId: string | null;
  history: {
    attempted: boolean;
    requested: boolean;
    matched: boolean;
    matchedMessages: number;
    matchedChats: number;
    matchedContacts: number;
    timedOut: boolean;
    warning: string | null;
    anchorMessageId: string | null;
  };
  profile: {
    refreshed: boolean;
    profilePictureUrl: string | null;
    about: string | null;
  };
  customer?: Customer | null;
};

export type ContactNameResyncResponse = {
  success: boolean;
  whatsappAccountId: string | null;
  connectionState: string | null;
  processedContacts: number;
  processedChats: number;
  cachedIdentityCount: number;
  upsertedCandidates: number;
};

const configuredApiUrl = import.meta.env.VITE_API_URL;
const isLocalhost =
  typeof window !== "undefined" &&
  ["localhost", "127.0.0.1"].includes(window.location.hostname);
const API_URL = isLocalhost ? configuredApiUrl || "http://localhost:4000" : "/api";
let activeDashboardSessionId = "";
let unauthorizedHandler: ((error: ApiError) => void | Promise<void>) | null = null;

export class ApiError extends Error {
  code?: string;
  status?: number;

  constructor(message: string, options?: { code?: string; status?: number }) {
    super(message);
    this.name = "ApiError";
    this.code = options?.code;
    this.status = options?.status;
  }
}

export function setApiSessionId(sessionId: string) {
  activeDashboardSessionId = sessionId;
}

export function setApiUnauthorizedHandler(handler: ((error: ApiError) => void | Promise<void>) | null) {
  unauthorizedHandler = handler;
}

function getApiUrl() {
  if (!API_URL) {
    throw new Error(
      "Missing backend API URL. Set VITE_API_URL for local development before using the dashboard."
    );
  }

  return API_URL.replace(/\/$/, "");
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  token?: string,
  options?: {
    skipSession?: boolean;
  }
): Promise<T> {
  const headers = new Headers(init.headers);
  const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;

  if (!isFormData) {
    headers.set("Content-Type", "application/json");
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  if (!options?.skipSession && activeDashboardSessionId) {
    headers.set("X-Session-Id", activeDashboardSessionId);
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
    const payload = data as { error?: string; code?: string };
    const apiError = new ApiError(
      payload.error || `Request failed (${response.status} ${response.statusText || "Unknown error"}).`,
      {
        code: payload.code,
        status: response.status
      }
    );

    const shouldHandleUnauthorized =
      response.status === 401 &&
      Boolean(token) &&
      (!payload.code ||
        payload.code === "SESSION_REVOKED" ||
        payload.code === "SESSION_REQUIRED" ||
        payload.code === "AUTH_TOKEN_INVALID" ||
        payload.code === "AUTH_TOKEN_MISSING");

    if (shouldHandleUnauthorized) {
      void unauthorizedHandler?.(apiError);
    }

    throw apiError;
  }

  return data as T;
}

function withWhatsAppAccountParam(path: string, whatsappAccountId?: string | null) {
  if (!whatsappAccountId) {
    return path;
  }

  const [basePath, existingQuery = ""] = path.split("?");
  const params = new URLSearchParams(existingQuery);
  params.set("whatsappAccountId", whatsappAccountId);
  const queryString = params.toString();
  return `${basePath}${queryString ? `?${queryString}` : ""}`;
}

export const api = {
  /**
   * Fetch paginated customers with optional search/filter.
   * @param params { page, pageSize, search }
   * @returns { data: Customer[], total: number }
   */
  getCustomers(params: { page?: number; pageSize?: number; search?: string; whatsappAccountId?: string | null }, token?: string) {
    const urlParams = new URLSearchParams();
    if (params.page !== undefined) urlParams.set("page", String(params.page));
    if (params.pageSize !== undefined) urlParams.set("pageSize", String(params.pageSize));
    if (params.search) urlParams.set("search", params.search);
    if (params.whatsappAccountId) urlParams.set("whatsappAccountId", params.whatsappAccountId);
    return request<{ data: Customer[]; total: number }>(
      `/customers${urlParams.size ? `?${urlParams.toString()}` : ""}`,
      {},
      token
    );
  },
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
  createDashboardSession(token: string, replaceExisting = false) {
    return request<DashboardSessionResponse>(
      "/auth/session",
      {
        method: "POST",
        body: JSON.stringify({ replaceExisting })
      },
      token,
      {
        skipSession: true
      }
    );
  },
  deleteDashboardSession(token: string) {
    return request<{ success: boolean }>(
      "/auth/session",
      {
        method: "DELETE"
      },
      token
    );
  },
  getWhatsAppStatus(token: string, whatsappAccountId?: string | null) {
    return request<WhatsAppStatus>(withWhatsAppAccountParam("/whatsapp/status", whatsappAccountId), {}, token);
  },
  getWhatsAppQr(token: string, whatsappAccountId?: string | null) {
    return request<WhatsAppQr>(withWhatsAppAccountParam("/whatsapp/qr", whatsappAccountId), {}, token);
  },
  createWhatsAppConnection(token: string) {
    return request<WhatsAppAccount>(
      "/whatsapp/connect",
      {
        method: "POST"
      },
      token
    );
  },
  getWhatsAppProfile(token: string, whatsappAccountId?: string | null) {
    return request<WhatsAppProfile>(withWhatsAppAccountParam("/whatsapp/profile", whatsappAccountId), {}, token);
  },
  getWhatsAppAccounts(token: string) {
    return request<WhatsAppAccount[]>("/whatsapp/accounts", {}, token);
  },
  getMyProfile(token: string) {
    return request<UserProfile>("/profiles/me", {}, token);
  },
  clearDatabase(token: string) {
    return request<{ success: boolean; message: string }>(
      "/whatsapp/clear",
      { method: "DELETE" },
      token
    );
  },
  cleanupStaleWhatsAppAccounts(token: string) {
    return request<WhatsAppAccountCleanupResponse>(
      "/whatsapp/cleanup-stale-accounts",
      { method: "POST" },
      token
    );
  },
  disconnectWhatsApp(token: string, whatsappAccountId?: string | null) {
    return request<WhatsAppStatus>(
      withWhatsAppAccountParam("/whatsapp/disconnect", whatsappAccountId),
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
  resyncContactNames(token: string, whatsappAccountId?: string | null) {
    return request<ContactNameResyncResponse>(
      withWhatsAppAccountParam("/whatsapp/resync-contact-names", whatsappAccountId),
      {
        method: "POST"
      },
      token
    );
  },
  getConversations(token: string, whatsappAccountId?: string | null) {
    return request<Conversation[]>(withWhatsAppAccountParam("/conversations", whatsappAccountId), {}, token);
  },
  /**
   * Fetch paginated customers with optional search/filter.
   * @param params { page, pageSize, search }
   * @returns { data: Customer[], total: number }
   */
  
  
  markConversationRead(phone: string, token: string, chatJid?: string | null, whatsappAccountId?: string | null) {
    return request<{ success: boolean }>(
      withWhatsAppAccountParam(`/conversations/${phone}/read`, whatsappAccountId),
      {
        method: "POST",
        body: JSON.stringify({ chatJid: chatJid || null, whatsappAccountId: whatsappAccountId || null })
      },
      token
    );
  },
  deleteConversation(phone: string, token: string, chatJid?: string | null, whatsappAccountId?: string | null) {
    return request<{ success: boolean; deletedMessages: number; deletedCustomers: number }>(
      withWhatsAppAccountParam(`/conversations/${phone}`, whatsappAccountId),
      {
        method: "DELETE",
        body: JSON.stringify({ chatJid: chatJid || null, whatsappAccountId: whatsappAccountId || null })
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
  getMessages(phone: string, token: string, chatJid?: string | null, whatsappAccountId?: string | null) {
    const params = new URLSearchParams();

    if (chatJid) {
      params.set("chatJid", chatJid);
    }

    if (whatsappAccountId) {
      params.set("whatsappAccountId", whatsappAccountId);
    }

    return request<Message[]>(`/messages/${phone}${params.size ? `?${params.toString()}` : ""}`, {}, token);
  },
  getCustomer(phone: string, token: string, chatJid?: string | null, whatsappAccountId?: string | null) {
    const params = new URLSearchParams();

    if (chatJid) {
      params.set("chatJid", chatJid);
    }

    if (whatsappAccountId) {
      params.set("whatsappAccountId", whatsappAccountId);
    }

    return request<Customer>(`/customers/${phone}${params.size ? `?${params.toString()}` : ""}`, {}, token);
  },
  repopulateConversation(phone: string, token: string, options?: { chatJid?: string | null; whatsappAccountId?: string | null }) {
    return request<ConversationRepopulateResponse>(
      withWhatsAppAccountParam(`/customers/${phone}/repopulate`, options?.whatsappAccountId),
      {
        method: "POST",
        body: JSON.stringify({
          chatJid: options?.chatJid || null,
          whatsappAccountId: options?.whatsappAccountId || null
        })
      },
      token
    );
  },
  getCustomerSalesItems(phone: string, token: string, chatJid?: string | null, whatsappAccountId?: string | null) {
    const params = new URLSearchParams();

    if (chatJid) {
      params.set("chatJid", chatJid);
    }

    if (whatsappAccountId) {
      params.set("whatsappAccountId", whatsappAccountId);
    }

    return request<SalesLeadItem[]>(`/customers/${phone}/sales-items${params.size ? `?${params.toString()}` : ""}`, {}, token);
  },
  getSalesLeadItems(token: string, whatsappAccountId?: string | null) {
    return request<SalesLeadItem[]>(withWhatsAppAccountParam("/sales-items", whatsappAccountId), {}, token);
  },
  saveCustomer(
    phone: string,
    payload: Pick<Customer, "status" | "notes"> & { chat_jid?: string | null; whatsappAccountId?: string | null },
    token: string
  ) {
    return request<Customer>(
      `/customers/${phone}`,
      {
        method: "PUT",
        body: JSON.stringify({
          status: payload.status,
          notes: payload.notes,
          chatJid: payload.chat_jid || null,
          whatsappAccountId: payload.whatsappAccountId || null
        })
      },
      token
    );
  },
  createCustomerSalesItem(
    phone: string,
    payload: {
      messageId: string;
      status: CustomerStatus;
      chatJid?: string | null;
      productType: string;
      packageName: string;
      price: number;
      quantity: number;
      whatsappAccountId?: string | null;
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
  updateCustomerSalesItem(
    phone: string,
    itemId: string,
    payload: {
      status: CustomerStatus;
      chatJid?: string | null;
      productType: string;
      packageName: string;
      price: number;
      quantity: number;
      whatsappAccountId?: string | null;
    },
    token: string
  ) {
    return request<SalesLeadItem>(
      `/customers/${phone}/sales-items/${itemId}`,
      {
        method: "PUT",
        body: JSON.stringify(payload)
      },
      token
    );
  },
  sendMessage(phone: string, message: string, token: string, chatJid?: string | null, whatsappAccountId?: string | null) {
    return request<Message>(
      "/send",
      {
        method: "POST",
        body: JSON.stringify({ phone, message, chatJid, whatsappAccountId: whatsappAccountId || null })
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
      whatsappAccountId?: string | null;
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

    if (options?.whatsappAccountId) {
      formData.append("whatsappAccountId", options.whatsappAccountId);
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
      whatsappAccountId?: string | null;
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
          chatJid: payload.chatJid,
          whatsappAccountId: payload.whatsappAccountId || null
        })
      },
      token
    );
  }
};
