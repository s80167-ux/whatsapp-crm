import { useEffect, useMemo, useRef, useState } from "react";
import { ChatList } from "./components/ChatList";
import { ChatWindow } from "./components/ChatWindow";
import { ContactList } from "./components/ContactList";
import CustomerEditModal from "./components/CustomerEditModal";

import { CustomerPanel } from "./components/CustomerPanel";
import type { CustomerPanelProps } from "./components/CustomerPanel";
import { LoginForm } from "./components/LoginForm";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { SalesDashboard } from "./components/SalesDashboard";
import {
  ApiError,
  api,
  CUSTOMER_STATUSES,
  setApiSessionId,
  setApiUnauthorizedHandler,
  type Conversation,
  type Customer,
  type CustomerStatus,
  type Message,
  type SalesLeadItem,
  type WhatsAppAccount,
  type WhatsAppQr,
  type WhatsAppStatus
} from "./lib/api";
import { getConversationIdentifier, getConversationSortTimestamp, getDisplayName, getDisplayPhone, getResolvedPhone } from "./lib/display";
import { clearPasswordRecoveryCallback, getEmailVerificationRedirectUrl, getPasswordRecoveryRedirectUrl, isPasswordRecoveryCallback, supabase } from "./lib/supabase";

type AuthMode = "login" | "register";
type DashboardTab = "inbox" | "contacts" | "sales";
type SidebarView = "inbox" | "pipeline" | "broadcast";
const conversationPollMs = 8000;
const whatsAppStatePollMs = 5000;
const dashboardSessionStorageKey = "whatsapp-crm-dashboard-session-id";

function sortConversationsByLatestMessage(conversations: Conversation[]) {
  return [...conversations].sort(
    (left, right) => new Date(getConversationSortTimestamp(right)).getTime() - new Date(getConversationSortTimestamp(left)).getTime()
  );
}

function sortContactsByDisplayPriority(contacts: Customer[]) {
  return [...contacts].sort((left, right) => {
    const leftHasName = !!(left.contact_name && left.contact_name.trim());
    const rightHasName = !!(right.contact_name && right.contact_name.trim());

    if (leftHasName !== rightHasName) {
      return rightHasName ? 1 : -1;
    }

    const leftTime = left.last_message_at || left.updated_at || "";
    const rightTime = right.last_message_at || right.updated_at || "";
    return rightTime.localeCompare(leftTime);
  });
}

function compareCustomerPreference(left: Customer, right: Customer) {
  const leftAnchor = Boolean(left.is_contact_anchor);
  const rightAnchor = Boolean(right.is_contact_anchor);
  if (leftAnchor !== rightAnchor) {
    return Number(rightAnchor) - Number(leftAnchor);
  }

  const leftQuality = Number(left.quality_score || 0);
  const rightQuality = Number(right.quality_score || 0);
  if (leftQuality !== rightQuality) {
    return rightQuality - leftQuality;
  }

  const leftUpdatedAt = new Date(left.updated_at || 0).getTime();
  const rightUpdatedAt = new Date(right.updated_at || 0).getTime();
  if (leftUpdatedAt !== rightUpdatedAt) {
    return rightUpdatedAt - leftUpdatedAt;
  }

  return String(right.id || "").localeCompare(String(left.id || ""));
}

function isSameCustomerSelection(
  customer: Customer | null,
  targetPhone: string | null,
  targetChatJid?: string | null,
  targetWhatsAppAccountId?: string | null
) {
  if (!customer || !targetPhone) {
    return false;
  }

  const customerConversationId = getConversationIdentifier(customer.phone, customer.chat_jid);
  const normalizedCustomerChatJid = String(customer.chat_jid || "").trim();
  const normalizedTargetChatJid = String(targetChatJid || "").trim();
  const normalizedCustomerAccountId = String(customer.whatsapp_account_id || "").trim();
  const normalizedTargetAccountId = String(targetWhatsAppAccountId || "").trim();

  if (customerConversationId !== targetPhone) {
    return false;
  }

  if (normalizedTargetChatJid && normalizedCustomerChatJid && normalizedTargetChatJid !== normalizedCustomerChatJid) {
    return false;
  }

  if (normalizedTargetAccountId && normalizedCustomerAccountId && normalizedTargetAccountId !== normalizedCustomerAccountId) {
    return false;
  }

  return true;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("Failed to read attachment preview."));
    reader.readAsDataURL(file);
  });
}

function isStickerFile(file: File) {
  return file.type === "image/webp" || /\.webp$/i.test(file.name);
}

function getAttachmentMediaType(file: File) {
  if (isStickerFile(file)) {
    return "sticker";
  }

  if (file.type.startsWith("image/")) {
    return "image";
  }

  if (file.type.startsWith("video/")) {
    return "video";
  }

  return "document";
}

function buildAttachmentPreviewText(file: File, caption: string) {
  const mediaType = getAttachmentMediaType(file);
  const label = mediaType === "image" ? "Image" : mediaType === "video" ? "Video" : mediaType === "sticker" ? "Sticker" : "Document";
  const trimmedCaption = caption.trim();

  return trimmedCaption ? `[${label}] ${file.name} - ${trimmedCaption}` : `[${label}] ${file.name}`;
}

function normalizePhoneValue(value: string | null | undefined) {
  return String(value || "").replace(/\D/g, "") || null;
}

function buildSelectedWhatsAppStatus(
  account: WhatsAppAccount | null,
  polledStatus: WhatsAppStatus | null,
  qr: WhatsAppQr | null
) {
  if (!account) {
    return polledStatus;
  }

  const state =
    String(polledStatus?.state || "").trim().toLowerCase() ||
    String(account.connection_state || "").trim().toLowerCase() ||
    "disconnected";
  return {
    connected: state === "open",
    state,
    hasQr: state === "qr" || Boolean(qr?.qr) || Boolean(polledStatus?.hasQr)
  };
}

function buildAccountScopedCacheKey(phone: string, chatJid?: string | null, whatsappAccountId?: string | null) {
  const conversationId = getConversationIdentifier(phone, chatJid) || phone;
  return `${whatsappAccountId || "no-account"}::${conversationId}`;
}

function App() {
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [passwordResetRequestLoading, setPasswordResetRequestLoading] = useState(false);
  const [verificationResendLoading, setVerificationResendLoading] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [passwordRecoveryActive, setPasswordRecoveryActive] = useState(false);
  const [token, setToken] = useState("");
  const [dashboardSessionId, setDashboardSessionId] = useState("");
  const [sessionConflictMessage, setSessionConflictMessage] = useState("");
  const [replacingActiveSession, setReplacingActiveSession] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [activeDashboardTab, setActiveDashboardTab] = useState<DashboardTab>("inbox");
  const [activeView, setActiveView] = useState<SidebarView>("inbox");
  const [activeStatusFilter, setActiveStatusFilter] = useState<CustomerStatus | null>(null);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [selectedConversationChatJid, setSelectedConversationChatJid] = useState<string | null>(null);
  const [selectedContactConversationId, setSelectedContactConversationId] = useState<string | null>(null);
  const [selectedContactChatJid, setSelectedContactChatJid] = useState<string | null>(null);
  const [activeMessageFilterId, setActiveMessageFilterId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [loadingChats, setLoadingChats] = useState(false);
  const [refreshingChats, setRefreshingChats] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [dashboardError, setDashboardError] = useState("");
  const [dashboardNotice, setDashboardNotice] = useState("");
  const [loadingCustomer, setLoadingCustomer] = useState(false);
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [customerDraft, setCustomerDraft] = useState<Customer | null>(null);
  const [selectedContactSnapshot, setSelectedContactSnapshot] = useState<Customer | null>(null);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [editingCustomerOpen, setEditingCustomerOpen] = useState(false);
  const [salesLeadItems, setSalesLeadItems] = useState<SalesLeadItem[]>([]);
  const [allSalesLeadItems, setAllSalesLeadItems] = useState<SalesLeadItem[]>([]);
  const [loadingSalesLeadItems, setLoadingSalesLeadItems] = useState(false);
  const [loadingAllSalesLeadItems, setLoadingAllSalesLeadItems] = useState(false);
  const [savingSalesLeadItem, setSavingSalesLeadItem] = useState(false);
  const [customerPanelCollapsed, setCustomerPanelCollapsed] = useState(true);
  const [saveTimer, setSaveTimer] = useState<number | null>(null);
  const [whatsAppStatus, setWhatsAppStatus] = useState<WhatsAppStatus | null>(null);
  const [whatsAppQr, setWhatsAppQr] = useState<WhatsAppQr | null>(null);
  const [whatsAppAccounts, setWhatsAppAccounts] = useState<WhatsAppAccount[]>([]);
  const [selectedWhatsAppAccountId, setSelectedWhatsAppAccountId] = useState<string | null>(null);
  const [loadingWhatsApp, setLoadingWhatsApp] = useState(true);
  const [disconnectingWhatsApp, setDisconnectingWhatsApp] = useState(false);
  const [connectingNewWhatsApp, setConnectingNewWhatsApp] = useState(false);
  const [deletingConversationKey, setDeletingConversationKey] = useState<string | null>(null);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [repopulatingConversation, setRepopulatingConversation] = useState(false);
  const handlingSessionRevocationRef = useRef(false);
  const messagesCacheRef = useRef<Record<string, Message[]>>({});
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const activeWhatsAppAccountChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const conversationsRefreshTimerRef = useRef<number | null>(null);
  const activeSelectionRef = useRef<{
    dashboardTab: DashboardTab;
    selectedWhatsAppAccountId: string | null;
    selectedPhone: string | null;
    selectedConversationChatJid: string | null;
    selectedContactConversationId: string | null;
    selectedContactChatJid: string | null;
    activeChatJid: string | null;
    activeContactChatJid: string | null;
  }>({
    dashboardTab: "inbox",
    selectedWhatsAppAccountId: null,
    selectedPhone: null,
    selectedConversationChatJid: null,
    selectedContactConversationId: null,
    selectedContactChatJid: null,
    activeChatJid: null,
    activeContactChatJid: null
  });
  const isSalesDashboard = activeDashboardTab === "sales";

  // Contacts dashboard state and logic
  const CONTACTS_PAGE_SIZE = 10;
  const [contacts, setContacts] = useState<Customer[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsRefreshing, setContactsRefreshing] = useState(false);
  const [contactsPage, setContactsPage] = useState(1);
  const [contactsTotal, setContactsTotal] = useState(0);
  const [contactsQuery, setContactsQuery] = useState("");

  function handleContactsQueryChange(nextQuery: string) {
    setContactsPage(1);
    setContactsQuery(nextQuery);
  }

  // Fetch contacts from backend with pagination and search
  const fetchContacts = async ({ page = contactsPage, query = contactsQuery, silent = false } = {}) => {
    if (!token || activeDashboardTab !== "contacts") return;
    if (!silent) setContactsLoading(true);
    else setContactsRefreshing(true);
    try {
      const { data, total } = await api.getCustomers({
        page,
        pageSize: CONTACTS_PAGE_SIZE,
        search: query
      }, token);
      setContacts(sortContactsByDisplayPriority(data));
      setContactsTotal(total);
      setContactsPage(page);
    } catch (error) {
      setContacts([]);
      setContactsTotal(0);
    } finally {
      if (!silent) setContactsLoading(false);
      else setContactsRefreshing(false);
    }
  };

  // Fetch contacts when tab, page, or query changes
  useEffect(() => {
    if (activeDashboardTab === "contacts" && token && dashboardSessionId) {
      fetchContacts({ page: contactsPage, query: contactsQuery });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDashboardTab, contactsPage, contactsQuery, token, dashboardSessionId]);

  function resetDashboardState() {
    messagesCacheRef.current = {};
    setToken("");
    setDashboardSessionId("");
    setSessionConflictMessage("");
    setUserEmail("");
    setConversations([]);
    setSelectedPhone(null);
    setSelectedConversationChatJid(null);
    setActiveMessageFilterId(null);
    setMessages([]);
    setCustomerDraft(null);
    setSalesLeadItems([]);
    setAllSalesLeadItems([]);
    setWhatsAppAccounts([]);
    setSelectedWhatsAppAccountId(null);
    setSelectedContactConversationId(null);
    setSelectedContactChatJid(null);
  }

  function persistDashboardSession(nextSessionId: string) {
    setDashboardSessionId(nextSessionId);
    setApiSessionId(nextSessionId);

    if (typeof window === "undefined") {
      return;
    }

    if (nextSessionId) {
      window.sessionStorage.setItem(dashboardSessionStorageKey, nextSessionId);
      window.localStorage.removeItem(dashboardSessionStorageKey);
      return;
    }

    window.sessionStorage.removeItem(dashboardSessionStorageKey);
    window.localStorage.removeItem(dashboardSessionStorageKey);
  }

  async function ensureDashboardSession(
    activeToken: string,
    options?: {
      forceRefresh?: boolean;
      replaceExisting?: boolean;
    }
  ) {
    const forceRefresh = options?.forceRefresh === true;
    const storedSessionId =
      !forceRefresh && typeof window !== "undefined"
        ? window.sessionStorage.getItem(dashboardSessionStorageKey) || ""
        : "";

    if (storedSessionId) {
      persistDashboardSession(storedSessionId);
      return storedSessionId;
    }

    const { sessionId } = await api.createDashboardSession(activeToken, options?.replaceExisting === true);
    persistDashboardSession(sessionId);
    return sessionId;
  }

  async function handleSessionRevoked(message: string) {
    if (handlingSessionRevocationRef.current) {
      return;
    }

    handlingSessionRevocationRef.current = true;

    if (saveTimer) {
      window.clearTimeout(saveTimer);
      setSaveTimer(null);
    }

    await supabase.auth.signOut().catch(() => undefined);
    persistDashboardSession("");
    resetDashboardState();
    setPasswordRecoveryActive(false);
    const normalizedMessage = String(message || "").trim().toLowerCase();
    const revocationMessage =
      normalizedMessage === "invalid or expired token."
        ? "Your login session expired. Please sign in again."
        : message || "Your session ended. Please sign in again.";
    setDashboardError(revocationMessage);
    setAuthError(revocationMessage);
    setAuthNotice("");
    handlingSessionRevocationRef.current = false;
  }

  useEffect(() => {
    setCustomerPanelCollapsed(false);
  }, [selectedPhone, activeDashboardTab]);

  useEffect(() => {
    if (activeDashboardTab !== "contacts") {
      setEditingCustomerOpen(false);
      setEditingCustomer(null);
    }
  }, [activeDashboardTab]);

  useEffect(() => {
    if (activeDashboardTab !== "contacts") {
      return;
    }

    if (!contacts.length) {
      return;
    }

    const hasSelectedContactInList = contacts.some((contact) => {
      const conversationId = getConversationIdentifier(contact.phone, contact.chat_jid);
      if (conversationId !== selectedContactConversationId) {
        return false;
      }

      if (selectedContactChatJid) {
        return String(contact.chat_jid || "").trim() === String(selectedContactChatJid).trim();
      }

      return true;
    });

    if (hasSelectedContactInList) {
      return;
    }

    const inboxContact = selectedPhone
      ? contacts.find((contact) => {
          const conversationId = getConversationIdentifier(contact.phone, contact.chat_jid);
          if (conversationId !== selectedPhone) {
            return false;
          }

          if (selectedConversationChatJid) {
            return String(contact.chat_jid || "").trim() === String(selectedConversationChatJid).trim();
          }

          return true;
        }) || null
      : null;

    if (inboxContact) {
      setSelectedContactConversationId(getConversationIdentifier(inboxContact.phone, inboxContact.chat_jid));
      setSelectedContactChatJid(inboxContact.chat_jid || null);
      return;
    }

    const topContact =
      [...contacts].sort((left, right) => {
        const leftResolvedPhone = getResolvedPhone(left.phone, left.chat_jid);
        const rightResolvedPhone = getResolvedPhone(right.phone, right.chat_jid);
        const leftDisplayPhone = getDisplayPhone(left.phone, left.chat_jid);
        const rightDisplayPhone = getDisplayPhone(right.phone, right.chat_jid);
        const leftLabel = getDisplayName(left.contact_name, leftDisplayPhone || leftResolvedPhone).trim();
        const rightLabel = getDisplayName(right.contact_name, rightDisplayPhone || rightResolvedPhone).trim();
        return leftLabel.localeCompare(rightLabel, undefined, { sensitivity: "base", numeric: true });
      })[0] || null;

    if (!topContact) {
      return;
    }

    setSelectedContactConversationId(getConversationIdentifier(topContact.phone, topContact.chat_jid));
    setSelectedContactChatJid(topContact.chat_jid || null);
  }, [activeDashboardTab, contacts, selectedContactChatJid, selectedContactConversationId, selectedConversationChatJid, selectedPhone]);

  useEffect(() => {
    setApiUnauthorizedHandler((error) => handleSessionRevoked(error.message));

    return () => {
      setApiUnauthorizedHandler(null);
    };
  }, [saveTimer]);

  function updateConversationStatus(params: {
    phone?: string | null;
    chatJid?: string | null;
    status: CustomerStatus;
  }) {
    const targetConversationId = getConversationIdentifier(params.phone, params.chatJid);
    const targetChatJid = String(params.chatJid || "").trim() || null;

    setConversations((current) =>
      current.map((conversation) => {
        const conversationId = getConversationIdentifier(conversation.phone, conversation.chatJid);
        const matchesPhone = Boolean(targetConversationId && conversationId === targetConversationId);
        const matchesChatJid = Boolean(targetChatJid && conversation.chatJid === targetChatJid);

        if (!matchesPhone && !matchesChatJid) {
          return conversation;
        }

        return {
          ...conversation,
          status: params.status
        };
      })
    );
  }

  function clearConversationUnread(params: {
    phone?: string | null;
    chatJid?: string | null;
  }) {
    const targetConversationId = getConversationIdentifier(params.phone, params.chatJid);
    const targetChatJid = String(params.chatJid || "").trim() || null;

    setConversations((current) =>
      current.map((conversation) => {
        const conversationId = getConversationIdentifier(conversation.phone, conversation.chatJid);
        const matchesPhone = Boolean(targetConversationId && conversationId === targetConversationId);
        const matchesChatJid = Boolean(targetChatJid && conversation.chatJid === targetChatJid);

        if (!matchesPhone && !matchesChatJid) {
          return conversation;
        }

        if (!conversation.unreadCount) {
          return conversation;
        }

        return {
          ...conversation,
          unreadCount: 0
        };
      })
    );
  }

  async function markActiveConversationRead(phone: string, chatJid?: string | null) {
    if (!token) {
      return;
    }

    clearConversationUnread({ phone, chatJid });

    try {
      await api.markConversationRead(phone, token, chatJid, selectedWhatsAppAccountId);
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : "Failed to clear unread count.");
      loadConversations(token, true);
    }
  }

  async function loadConversations(activeToken: string, silent = false) {
    const requestedAccountId = selectedWhatsAppAccountId;
    if (!silent) {
      setLoadingChats(true);
      setDashboardError("");
    } else {
      setRefreshingChats(true);
    }

      try {
        const data = await api.getConversations(activeToken, selectedWhatsAppAccountId);
        if (activeSelectionRef.current.selectedWhatsAppAccountId !== requestedAccountId) {
          return;
        }
        const sortedData = sortConversationsByLatestMessage(data);
        setConversations(sortedData);
        setSelectedPhone((current) => {
          if (!sortedData.length) {
            return null;
          }

          if (current && sortedData.some((item) => getConversationIdentifier(item.phone, item.chatJid) === current)) {
            return current;
          }

          if (current) {
            return current;
          }

          if (activeDashboardTab !== "inbox") {
            return current;
          }

          return getConversationIdentifier(sortedData[0]?.phone, sortedData[0]?.chatJid) || null;
      });
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : "Failed to load conversations.");
    } finally {
      if (!silent) {
        setLoadingChats(false);
      } else {
        setRefreshingChats(false);
      }
    }
  }

  async function loadMessages(phone: string, activeToken: string, chatJid?: string | null, silent = false, force = false) {
    const requestedAccountId = selectedWhatsAppAccountId;
    const cacheKey = buildAccountScopedCacheKey(phone, chatJid, requestedAccountId);
    const cached = messagesCacheRef.current[cacheKey];

    // Always show cached messages instantly if available (unless force)
    if (cached && !force) {
      setMessages(cached);
    }

    // Only show loading spinner if no cache
    if (!cached && !silent) {
      setLoadingMessages(true);
    }

    try {
      const data = await api.getMessages(phone, activeToken, chatJid, selectedWhatsAppAccountId);
      messagesCacheRef.current[cacheKey] = data;
      const activeSelection = activeSelectionRef.current;

      if (
        activeSelection.selectedWhatsAppAccountId !== requestedAccountId ||
        activeSelection.dashboardTab !== "inbox" ||
        activeSelection.selectedPhone !== phone
      ) {
        return;
      }

      const requestedChatJid = String(chatJid || "").trim();
      const currentChatJid = String(activeSelection.activeChatJid || "").trim();
      const selectedChatJid = String(activeSelection.selectedConversationChatJid || "").trim();

      if (
        (requestedChatJid && currentChatJid && requestedChatJid !== currentChatJid) ||
        (requestedChatJid && selectedChatJid && requestedChatJid !== selectedChatJid)
      ) {
        return;
      }

      setMessages(data);
    } catch (error) {
      if (!silent) {
        setDashboardError(error instanceof Error ? error.message : "Failed to load messages.");
      } else {
        console.warn("Silent message refresh failed:", error);
      }
    } finally {
      if ((!cached || force) && !silent) {
        setLoadingMessages(false);
      }
    }
  }

  async function loadCustomer(phone: string, activeToken: string, chatJid?: string | null, silent = false) {
    const requestedAccountId = selectedWhatsAppAccountId;
    if (!silent) {
      setLoadingCustomer(true);
    }

    try {
      const data = await api.getCustomer(phone, activeToken, chatJid, selectedWhatsAppAccountId);
      const activeSelection = activeSelectionRef.current;
      if (activeSelection.selectedWhatsAppAccountId !== requestedAccountId) {
        return;
      }
      const isInboxTarget = activeSelection.dashboardTab === "inbox" && activeSelection.selectedPhone === phone;
      const isContactTarget =
        activeSelection.dashboardTab === "contacts" && activeSelection.selectedContactConversationId === phone;

      if (isInboxTarget || isContactTarget) {
        const requestedChatJid = String(chatJid || "").trim();
        const currentChatJid = String(
          activeSelection.dashboardTab === "contacts" ? activeSelection.activeContactChatJid : activeSelection.activeChatJid
        ).trim();
        const selectedChatJid = String(
          activeSelection.dashboardTab === "contacts" ? activeSelection.selectedContactChatJid : activeSelection.selectedConversationChatJid
        ).trim();

        if (
          !requestedChatJid ||
          (!currentChatJid && !selectedChatJid) ||
          requestedChatJid === currentChatJid ||
          requestedChatJid === selectedChatJid
        ) {
          setCustomerDraft(data);
        }
      }
      updateConversationStatus({
        phone: data.phone,
        chatJid: data.chat_jid,
        status: data.status
      });
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : "Failed to load customer.");
    } finally {
      if (!silent) {
        setLoadingCustomer(false);
      }
    }
  }

  async function loadCustomerSalesItems(phone: string, activeToken: string, chatJid?: string | null, silent = false) {
    const requestedAccountId = selectedWhatsAppAccountId;
    if (!silent) {
      setLoadingSalesLeadItems(true);
    }

    try {
      const data = await api.getCustomerSalesItems(phone, activeToken, chatJid, selectedWhatsAppAccountId);
      const activeSelection = activeSelectionRef.current;
      if (activeSelection.selectedWhatsAppAccountId !== requestedAccountId) {
        return;
      }
      const isInboxTarget = activeSelection.dashboardTab === "inbox" && activeSelection.selectedPhone === phone;
      const isContactTarget =
        activeSelection.dashboardTab === "contacts" && activeSelection.selectedContactConversationId === phone;

      if (!isInboxTarget && !isContactTarget) {
        return;
      }

      const requestedChatJid = String(chatJid || "").trim();
      const currentChatJid = String(
        activeSelection.dashboardTab === "contacts" ? activeSelection.activeContactChatJid : activeSelection.activeChatJid
      ).trim();
      const selectedChatJid = String(
        activeSelection.dashboardTab === "contacts" ? activeSelection.selectedContactChatJid : activeSelection.selectedConversationChatJid
      ).trim();

      if (
        (requestedChatJid && currentChatJid && requestedChatJid !== currentChatJid) ||
        (requestedChatJid && selectedChatJid && requestedChatJid !== selectedChatJid)
      ) {
        return;
      }

      setSalesLeadItems(data);
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : "Failed to load customer sales items.");
    } finally {
      if (!silent) {
        setLoadingSalesLeadItems(false);
      }
    }
  }

  async function loadAllSalesLeadItems(activeToken: string, silent = false) {
    if (!silent) {
      setLoadingAllSalesLeadItems(true);
    }

    try {
      const data = await api.getSalesLeadItems(activeToken, selectedWhatsAppAccountId);
      setAllSalesLeadItems(data);
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : "Failed to load sales dashboard data.");
    } finally {
      if (!silent) {
        setLoadingAllSalesLeadItems(false);
      }
    }
  }

  async function handleDeleteConversation(phone: string, chatJid?: string | null) {
    if (!token) {
      return;
    }

    const conversationId = getConversationIdentifier(phone, chatJid);
    const conversationKey = String(chatJid || conversationId || phone || "").trim() || null;

    setDeletingConversationKey(conversationKey);
    setDashboardError("");

    try {
      await api.deleteConversation(phone, token, chatJid, selectedWhatsAppAccountId);

      setConversations((current) =>
        current.filter((conversation) => {
          const currentConversationId = getConversationIdentifier(conversation.phone, conversation.chatJid);
          const matchesPhone = Boolean(conversationId && currentConversationId === conversationId);
          const matchesChatJid = Boolean(chatJid && conversation.chatJid === chatJid);

          return !matchesPhone && !matchesChatJid;
        })
      );

      if (selectedPhone && conversationId && selectedPhone === conversationId) {
        setSelectedPhone(null);
        setSelectedConversationChatJid(null);
        setMessages([]);
        setCustomerDraft(null);
        setSalesLeadItems([]);
        delete messagesCacheRef.current[buildAccountScopedCacheKey(phone, chatJid, selectedWhatsAppAccountId)];
      }
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : "Failed to delete conversation.");
    } finally {
      setDeletingConversationKey(null);
    }
  }

  async function handleDeleteMessage(message: Message) {
    if (!token || deletingMessageId === message.id) {
      return;
    }

    const targetPhone = getConversationIdentifier(message.phone, message.chat_jid) || message.phone;
    const targetChatJid = message.chat_jid || activeChatJid || null;

    setDeletingMessageId(message.id);
    setDashboardError("");

    try {
      await api.deleteMessage(message.id, token);

      setMessages((current) => {
        const next = current.filter((item) => item.id !== message.id);
        const key = buildAccountScopedCacheKey(targetPhone, targetChatJid, selectedWhatsAppAccountId);
        messagesCacheRef.current[key] = next;
        return next;
      });

      await loadConversations(token, true);

      if (selectedPhone && selectedPhone === targetPhone) {
        await Promise.allSettled([
          loadMessages(targetPhone, token, targetChatJid, true, true),
          loadCustomer(targetPhone, token, targetChatJid, true),
          loadCustomerSalesItems(targetPhone, token, targetChatJid, true)
        ]);
      }
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : "Failed to delete message.");
    } finally {
      setDeletingMessageId(null);
    }
  }

  async function persistCustomer(nextCustomer: Customer) {
    if (!token) {
      return;
    }

    setSavingCustomer(true);

    try {
      const savedCustomer = await api.saveCustomer(
        nextCustomer.phone,
        {
          contact_name: nextCustomer.contact_name || null,
          chat_jid: nextCustomer.chat_jid || null,
          status: nextCustomer.status,
          notes: nextCustomer.notes,
          profile_picture_url: nextCustomer.profile_picture_url || null,
          about: nextCustomer.about || null,
          premise_address: nextCustomer.premise_address || null,
          business_type: nextCustomer.business_type || null,
          age: nextCustomer.age ?? null,
          email_address: nextCustomer.email_address || null,
          whatsappAccountId: activeConversationSourceAccountId
        },
        token
      );
      syncSavedCustomer(savedCustomer);
      updateConversationStatus({
        phone: savedCustomer.phone,
        chatJid: savedCustomer.chat_jid,
        status: savedCustomer.status
      });

      if (activeDashboardTab === "contacts" && contactsPage !== 1) {
        await fetchContacts({ page: 1, query: contactsQuery, silent: true });
      }
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : "Failed to save customer.");
    } finally {
      setSavingCustomer(false);
    }
  }

  async function handleCreateSalesLeadItem(payload: {
    messageId: string;
    status: CustomerStatus;
    productType: string;
    packageName: string;
    price: number;
    quantity: number;
  }) {
    if (!token || !selectedPhone) {
      return;
    }

    setSavingSalesLeadItem(true);

    try {
      const item = await api.createCustomerSalesItem(
        selectedPhone,
        {
          ...payload,
          chatJid: activeCustomerChatJid,
          whatsappAccountId: activeConversationSourceAccountId
        },
        token
      );

      setSalesLeadItems((current) => [item, ...current]);
      setAllSalesLeadItems((current) => [item, ...current]);

      setCustomerDraft((current) =>
        current
          ? {
              ...current,
              chat_jid: activeCustomerChatJid,
              status: payload.status,
              notes: selectedNotes
            }
          : current
      );
      updateConversationStatus({
        phone: selectedPhone,
        chatJid: activeCustomerChatJid,
        status: payload.status
      });

      const savedCustomer = await api.saveCustomer(
        selectedPhone,
        {
          chat_jid: activeCustomerChatJid,
          status: payload.status,
          notes: selectedNotes,
          whatsappAccountId: activeConversationSourceAccountId
        },
        token
      );

      setCustomerDraft(savedCustomer);
      updateConversationStatus({
        phone: savedCustomer.phone,
        chatJid: savedCustomer.chat_jid,
        status: savedCustomer.status
      });
      await loadConversations(token, true);
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : "Failed to save sales lead item.");
      throw error;
    } finally {
      setSavingSalesLeadItem(false);
    }
  }

  async function handleUpdateSalesLeadItem(payload: {
    itemId: string;
    status: CustomerStatus;
    productType: string;
    packageName: string;
    price: number;
    quantity: number;
  }) {
    if (!token || !selectedPhone) {
      return;
    }

    setSavingSalesLeadItem(true);

    try {
      const item = await api.updateCustomerSalesItem(
        selectedPhone,
        payload.itemId,
        {
          ...payload,
          chatJid: activeCustomerChatJid,
          whatsappAccountId: activeConversationSourceAccountId
        },
        token
      );

      setSalesLeadItems((current) => current.map((existingItem) => (existingItem.id === item.id ? item : existingItem)));
      setAllSalesLeadItems((current) => current.map((existingItem) => (existingItem.id === item.id ? item : existingItem)));

      setCustomerDraft((current) =>
        current
          ? {
              ...current,
              chat_jid: activeCustomerChatJid,
              status: payload.status,
              notes: selectedNotes
            }
          : current
      );
      updateConversationStatus({
        phone: selectedPhone,
        chatJid: activeCustomerChatJid,
        status: payload.status
      });

      const savedCustomer = await api.saveCustomer(
        selectedPhone,
        {
          chat_jid: activeCustomerChatJid,
          status: payload.status,
          notes: selectedNotes,
          whatsappAccountId: activeConversationSourceAccountId
        },
        token
      );

      setCustomerDraft(savedCustomer);
      updateConversationStatus({
        phone: savedCustomer.phone,
        chatJid: savedCustomer.chat_jid,
        status: savedCustomer.status
      });
      await loadConversations(token, true);
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : "Failed to update sales lead item.");
      throw error;
    } finally {
      setSavingSalesLeadItem(false);
    }
  }

  async function loadWhatsAppState(
    silent = false,
    options?: {
      accountId?: string | null;
    }
  ) {
    if (!token || !dashboardSessionId) {
      setWhatsAppStatus(null);
      setWhatsAppQr(null);
      if (!silent) {
        setLoadingWhatsApp(false);
      }
      return;
    }

    const targetAccountId = options?.accountId !== undefined ? options.accountId : selectedWhatsAppAccountId;

    if (!silent) {
      setLoadingWhatsApp(true);
    }

    try {
      const [status, qr] = await Promise.all([
        api.getWhatsAppStatus(token, targetAccountId),
        api.getWhatsAppQr(token, targetAccountId)
      ]);
      setWhatsAppStatus(status);
      if (targetAccountId) {
        setWhatsAppAccounts((current) =>
          current.map((account) =>
            account.id === targetAccountId
              ? {
                  ...account,
                  connection_state: status.state
                }
              : account
          )
        );
        setConversations((current) =>
          current.map((conversation) =>
            conversation.whatsappAccountId === targetAccountId
              ? {
                  ...conversation,
                  sourceConnectionState: status.state
                }
              : conversation
          )
        );
      }
      setWhatsAppQr((current) => {
        if (status.connected) {
          return qr;
        }

        if (qr.qr) {
          return qr;
        }

        if (status.hasQr && current?.qr) {
          return current;
        }

        return qr;
      });

    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : "Failed to load WhatsApp state.");
    } finally {
      if (!silent) {
        setLoadingWhatsApp(false);
      }
    }
  }

  async function loadWhatsAppAccounts(activeToken: string, options?: { preserveSelection?: boolean }) {
    try {
      const accounts = await api.getWhatsAppAccounts(activeToken);
      const visibleAccounts = accounts.filter((account) => {
        const hasPhone = Boolean(normalizePhoneValue(account.account_phone));
        const state = String(account.connection_state || "").trim().toLowerCase();
        return hasPhone || state === "connecting" || state === "qr" || state === "open";
      });

      setWhatsAppAccounts(visibleAccounts);
      setSelectedWhatsAppAccountId((current) => {
        if (options?.preserveSelection && current && visibleAccounts.some((account) => account.id === current)) {
          return current;
        }

        if (current && visibleAccounts.some((account) => account.id === current)) {
          return current;
        }

        const connectedAccount =
          visibleAccounts.find((account) => String(account.connection_state || "").trim().toLowerCase() === "open") || null;

        return connectedAccount?.id || visibleAccounts[0]?.id || null;
      });
    } catch (error) {
      console.warn("Failed to load WhatsApp accounts:", error);
      setWhatsAppAccounts([]);
      setSelectedWhatsAppAccountId(null);
    }
  }

  async function handleDisconnectWhatsApp() {
    if (!token || !selectedWhatsAppAccountId || disconnectingWhatsApp) {
      return;
    }

    setDisconnectingWhatsApp(true);
    setDashboardError("");

    try {
      const status = await api.disconnectWhatsApp(token, selectedWhatsAppAccountId);
      setWhatsAppStatus(status);
      setWhatsAppQr({
        connected: status.connected,
        state: status.state,
        qr: null
      });

      window.setTimeout(() => {
        loadWhatsAppState(true, { accountId: selectedWhatsAppAccountId });
        if (token) {
          loadWhatsAppAccounts(token, { preserveSelection: true });
        }
      }, 3500);
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : "Failed to disconnect WhatsApp.");
    } finally {
      setDisconnectingWhatsApp(false);
    }
  }

  async function handleRepopulateConversation() {
    if (!token || !selectedPhone || repopulatingConversation) {
      return;
    }

    setRepopulatingConversation(true);
    setDashboardError("");
    setDashboardNotice("");

    try {
      const response = await api.repopulateConversation(selectedPhone, token, {
        chatJid: activeChatJid,
        whatsappAccountId: activeConversationSourceAccountId
      });

      await loadWhatsAppState(true);
      await loadConversations(token, true);
      await Promise.allSettled([
        loadMessages(selectedPhone, token, activeChatJid, true, true),
        loadCustomer(selectedPhone, token, activeChatJid, true),
        loadCustomerSalesItems(selectedPhone, token, activeChatJid, true)
      ]);

      if (response.customer) {
        setCustomerDraft(response.customer);
      }

      if (response.history.warning) {
        setDashboardNotice(response.history.warning);
      } else if (response.history.requested && response.history.matchedMessages > 0) {
        setDashboardNotice(`Repopulated ${response.history.matchedMessages} WhatsApp message${response.history.matchedMessages === 1 ? "" : "s"} for this conversation.`);
      } else if (response.profile.refreshed) {
        setDashboardNotice("Refreshed the latest WhatsApp profile details for this conversation.");
      } else {
        setDashboardNotice("Repopulation request completed, but WhatsApp did not return any new conversation data.");
      }
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : "Failed to repopulate conversation from WhatsApp.");
    } finally {
      setRepopulatingConversation(false);
    }
  }

  async function handleConnectNewWhatsApp() {
    if (!token || connectingNewWhatsApp) {
      return;
    }

    setConnectingNewWhatsApp(true);
    setDashboardError("");

    try {
      const account = await api.createWhatsAppConnection(token, {
        whatsappAccountId: selectedWhatsAppAccountId,
        addAnother: !reconnectingExistingNumber && Boolean(selectedWhatsAppAccount?.account_phone)
      });
      await loadWhatsAppAccounts(token);
      setSelectedWhatsAppAccountId(account.id);
      await loadWhatsAppState(false, { accountId: account.id });
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : "Failed to start a new WhatsApp connection.");
    } finally {
      setConnectingNewWhatsApp(false);
    }
  }

  async function handleCleanupWhatsAppAccounts() {
    if (!token) {
      return;
    }

    setDashboardError("");
    setDashboardNotice("");

    try {
      const result = await api.cleanupStaleWhatsAppAccounts(token);
      const visibleAccounts = result.accounts.filter((account) => {
        const normalizedPhone = normalizePhoneValue(account.account_phone);
        const state = String(account.connection_state || "").trim().toLowerCase();
        return Boolean(normalizedPhone) || state === "connecting" || state === "qr" || state === "open";
      });

      setWhatsAppAccounts(visibleAccounts);
      setSelectedWhatsAppAccountId((current) => {
        if (current && visibleAccounts.some((account) => account.id === current)) {
          return current;
        }

        return visibleAccounts[0]?.id || null;
      });

      const removedTotal = result.removedInvalidCount + result.removedDuplicateCount;
      if (removedTotal > 0) {
        setDashboardNotice(
          `Cleaned up ${removedTotal} stale WhatsApp source${removedTotal === 1 ? "" : "s"} (${result.removedDuplicateCount} duplicate${result.removedDuplicateCount === 1 ? "" : "s"}, ${result.removedInvalidCount} incomplete).`
        );
      } else {
        setDashboardNotice("WhatsApp sources are already clean.");
      }
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : "Failed to cleanup WhatsApp sources.");
    }
  }

  useEffect(() => {
    if (!dashboardNotice) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setDashboardNotice("");
    }, 5000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [dashboardNotice]);

  const selectedWhatsAppAccount =
    whatsAppAccounts.find((account) => account.id === selectedWhatsAppAccountId) || null;
  const effectiveWhatsAppStatus = buildSelectedWhatsAppStatus(selectedWhatsAppAccount, whatsAppStatus, whatsAppQr);
  const reconnectingExistingNumber =
    Boolean(selectedWhatsAppAccount?.account_phone) && !Boolean(effectiveWhatsAppStatus?.connected);
  const connectActionLabel = connectingNewWhatsApp
    ? reconnectingExistingNumber
      ? "Reconnecting WhatsApp"
      : "Starting new connection"
    : reconnectingExistingNumber
      ? "Reconnect WhatsApp"
      : "Connect another number";

  const leadConversations = useMemo(() => {
    const selectedAccountPhone = selectedWhatsAppAccount?.account_phone || null;

    if (!selectedAccountPhone) {
      return conversations;
    }

    const normalizedSelectedAccountPhone = normalizePhoneValue(selectedAccountPhone);
    return conversations.filter((conversation) => normalizePhoneValue(conversation.phone) !== normalizedSelectedAccountPhone);
  }, [conversations, selectedWhatsAppAccount]);

  const selectedConversation = useMemo(
    () =>
      leadConversations.find((conversation) => {
        const conversationId = getConversationIdentifier(conversation.phone, conversation.chatJid);
        if (conversationId !== selectedPhone) {
          return false;
        }

        if (selectedConversationChatJid) {
          return String(conversation.chatJid || "").trim() === selectedConversationChatJid;
        }

        return true;
      }) || null,
    [leadConversations, selectedConversationChatJid, selectedPhone]
  );
  const selectedContact = useMemo(
    () => {
      const candidates = contacts.filter((contact) => {
        const conversationId = getConversationIdentifier(contact.phone, contact.chat_jid);
        if (conversationId !== selectedContactConversationId) {
          return false;
        }

        if (selectedContactChatJid) {
          return String(contact.chat_jid || "").trim() === selectedContactChatJid;
        }

        return true;
      });

      if (!candidates.length) {
        return null;
      }

      return [...candidates].sort(compareCustomerPreference)[0] || null;
    },
    [contacts, selectedContactChatJid, selectedContactConversationId]
  );
  const contactPanelCustomer = activeDashboardTab === "contacts" ? selectedContactSnapshot || selectedContact || customerDraft : customerDraft;
  const activeChatJid = selectedConversation?.chatJid || customerDraft?.chat_jid || null;
  const activeContactChatJid = selectedContactChatJid || customerDraft?.chat_jid || null;
  const activeConversationSourceAccountId =
    selectedConversation?.whatsappAccountId || customerDraft?.whatsapp_account_id || contactPanelCustomer?.whatsapp_account_id || null;
  const activeConversationSourceState = String(selectedConversation?.sourceConnectionState || "").trim().toLowerCase();
  const selectedWhatsAppAccountPhone = normalizePhoneValue(selectedWhatsAppAccount?.account_phone);
  const activeConversationSourcePhone = normalizePhoneValue(selectedConversation?.sourceAccountPhone);
  const activeConversationUsesSelectedAccount = Boolean(
    selectedConversation &&
      ((activeConversationSourceAccountId && selectedWhatsAppAccountId && activeConversationSourceAccountId === selectedWhatsAppAccountId) ||
        (activeConversationSourcePhone && selectedWhatsAppAccountPhone && activeConversationSourcePhone === selectedWhatsAppAccountPhone))
  );
  const resolvedActiveConversationSourceState = activeConversationUsesSelectedAccount
    ? String(effectiveWhatsAppStatus?.state || selectedWhatsAppAccount?.connection_state || activeConversationSourceState || "")
        .trim()
        .toLowerCase()
    : activeConversationSourceState;
  const activeConversationCanSend =
    !selectedConversation || !resolvedActiveConversationSourceState || resolvedActiveConversationSourceState === "open";
  const activeConversationSourceLabel =
    selectedConversation?.sourceDisplayName || selectedConversation?.sourceAccountPhone || "the original WhatsApp source";
  const activeSelectionId = activeDashboardTab === "contacts" ? selectedContactConversationId : selectedPhone;

  useEffect(() => {
    activeSelectionRef.current = {
      dashboardTab: activeDashboardTab,
      selectedWhatsAppAccountId,
      selectedPhone,
      selectedConversationChatJid,
      selectedContactConversationId,
      selectedContactChatJid,
      activeChatJid,
      activeContactChatJid
    };
  }, [activeChatJid, activeContactChatJid, activeDashboardTab, selectedContactChatJid, selectedContactConversationId, selectedConversationChatJid, selectedPhone, selectedWhatsAppAccountId]);

  useEffect(() => {
    if (activeDashboardTab !== "contacts" || !activeSelectionId) {
      setSelectedContactSnapshot(null);
      return;
    }

    setSelectedContactSnapshot(selectedContact || null);
  }, [activeDashboardTab, activeSelectionId, selectedContact]);

  useEffect(() => {
    if (activeDashboardTab !== "contacts" || !customerDraft || !activeSelectionId) {
      return;
    }

    if (isSameCustomerSelection(customerDraft, activeSelectionId, activeContactChatJid, selectedWhatsAppAccountId)) {
      setSelectedContactSnapshot(customerDraft);
    }
  }, [activeContactChatJid, activeDashboardTab, activeSelectionId, customerDraft, selectedWhatsAppAccountId]);

  useEffect(() => {
    let mounted = true;
    const recoveryCallbackActive = isPasswordRecoveryCallback();

    if (typeof window !== "undefined") {
      window.localStorage.removeItem(dashboardSessionStorageKey);
    }

    async function bootstrapAuth() {
      const { data } = await supabase.auth.getSession();

      if (!mounted) {
        return;
      }

      const activeToken = data.session?.access_token || "";
      setToken(activeToken);
      setUserEmail(data.session?.user.email || "");
      setPasswordRecoveryActive(recoveryCallbackActive);

      if (activeToken) {
        if (recoveryCallbackActive) {
          persistDashboardSession("");
          setSessionConflictMessage("");
          setAuthError("");
          setAuthNotice("Secure recovery verified. Enter a new password to finish resetting your account.");
          clearPasswordRecoveryCallback();
          setAuthReady(true);
          return;
        }

        try {
          await ensureDashboardSession(activeToken);
        } catch (error) {
          if (!mounted) {
            return;
          }

          if (error instanceof ApiError && error.code === "SESSION_ALREADY_ACTIVE") {
            persistDashboardSession("");
            setSessionConflictMessage(error.message);
            setAuthError("");
          } else {
            const message = error instanceof Error ? error.message : "Failed to restore dashboard session.";
            await handleSessionRevoked(message);
          }
        }
      } else {
        persistDashboardSession("");
      }

      if (mounted) {
        setAuthReady(true);
      }
    }

    void bootstrapAuth();

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "INITIAL_SESSION") {
        return;
      }

      const activeToken = session?.access_token || "";
      setToken(activeToken);
      setUserEmail(session?.user.email || "");

      if (event === "PASSWORD_RECOVERY") {
        persistDashboardSession("");
        setSessionConflictMessage("");
        setPassword("");
        setConfirmPassword("");
        setAuthError("");
        setAuthNotice("Secure recovery verified. Enter a new password to finish resetting your account.");
        setPasswordRecoveryActive(true);
        clearPasswordRecoveryCallback();
        setAuthReady(true);
        return;
      }

      if (!activeToken) {
        persistDashboardSession("");
        setSessionConflictMessage("");
        setPasswordRecoveryActive(false);
        setAuthReady(true);
        return;
      }

      setPasswordRecoveryActive(false);
      setAuthReady(true);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!token || !dashboardSessionId) {
      setWhatsAppStatus(null);
      setWhatsAppQr(null);
      setWhatsAppAccounts([]);
      setSelectedWhatsAppAccountId(null);
      return;
    }
    loadWhatsAppAccounts(token);
    loadConversations(token);
  }, [dashboardSessionId, selectedWhatsAppAccountId, token]);

  useEffect(() => {
    if (!token || !dashboardSessionId) {
      return;
    }

    loadWhatsAppState(true);
  }, [dashboardSessionId, selectedWhatsAppAccountId, token]);

  useEffect(() => {
    if (activeWhatsAppAccountChannelRef.current) {
      supabase.removeChannel(activeWhatsAppAccountChannelRef.current);
      activeWhatsAppAccountChannelRef.current = null;
    }

    if (!token || !dashboardSessionId || !selectedWhatsAppAccountId) {
      return;
    }

    const channel = supabase
      .channel(`whatsapp-account:${selectedWhatsAppAccountId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "whatsapp_accounts",
          filter: `id=eq.${selectedWhatsAppAccountId}`
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            setWhatsAppAccounts((current) => current.filter((account) => account.id !== selectedWhatsAppAccountId));
            return;
          }

          const nextAccount = payload.new as WhatsAppAccount | undefined;
          if (!nextAccount) {
            return;
          }

          setWhatsAppAccounts((current) => {
            const existingIndex = current.findIndex((account) => account.id === nextAccount.id);
            if (existingIndex === -1) {
              return [nextAccount, ...current];
            }

            const next = [...current];
            next[existingIndex] = nextAccount;
            return next;
          });
        }
      )
      .subscribe();

    activeWhatsAppAccountChannelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      if (activeWhatsAppAccountChannelRef.current === channel) {
        activeWhatsAppAccountChannelRef.current = null;
      }
    };
  }, [dashboardSessionId, selectedWhatsAppAccountId, token]);

  useEffect(() => {
    if (!whatsAppAccounts.length) {
      return;
    }

    setSelectedWhatsAppAccountId((current) => {
      if (current && whatsAppAccounts.some((account) => account.id === current)) {
        return current;
      }

      const connectedAccount =
        whatsAppAccounts.find((account) => String(account.connection_state || "").trim().toLowerCase() === "open") || null;

      return connectedAccount?.id || whatsAppAccounts[0]?.id || null;
    });
  }, [whatsAppAccounts]);

  useEffect(() => {
    messagesCacheRef.current = {};
    setMessages([]);
    setCustomerDraft(null);
    setSalesLeadItems([]);
    setAllSalesLeadItems([]);
    setSelectedPhone(null);
    setSelectedConversationChatJid(null);
    setSelectedContactConversationId(null);
    setSelectedContactChatJid(null);

    if (!token || !dashboardSessionId) {
      return;
    }

    loadConversations(token);

    if (activeDashboardTab === "contacts") {
      fetchContacts({ page: contactsPage, query: contactsQuery });
    }

    if (activeDashboardTab === "sales") {
      loadAllSalesLeadItems(token, true);
    }
  }, [dashboardSessionId, selectedWhatsAppAccountId, token]);

  useEffect(() => {
    if (!token || !dashboardSessionId || !activeSelectionId) {
      setMessages([]);
      if (activeDashboardTab === "contacts") {
        setCustomerDraft(null);
        setSalesLeadItems([]);
      } else {
        setCustomerDraft(null);
        setSalesLeadItems([]);
      }
      return;
    }

    const requestedChatJid = activeDashboardTab === "contacts" ? activeContactChatJid : activeChatJid;
    setCustomerDraft((current) =>
      isSameCustomerSelection(current, activeSelectionId, requestedChatJid, selectedWhatsAppAccountId) ? current : null
    );
    setSalesLeadItems([]);

    if (activeDashboardTab === "contacts") {
      loadCustomer(activeSelectionId, token, activeContactChatJid);
      loadCustomerSalesItems(activeSelectionId, token, activeContactChatJid);
      return;
    }

    loadMessages(activeSelectionId, token, activeChatJid);
    loadCustomer(activeSelectionId, token, activeChatJid);
    loadCustomerSalesItems(activeSelectionId, token, activeChatJid);
  }, [activeChatJid, activeContactChatJid, activeDashboardTab, activeSelectionId, dashboardSessionId, selectedWhatsAppAccountId, token]);

  useEffect(() => {
    if (!token || !dashboardSessionId || activeDashboardTab !== "sales") {
      return;
    }

    loadAllSalesLeadItems(token, true);
  }, [activeDashboardTab, dashboardSessionId, token]);

  useEffect(() => {
    if (!token || !dashboardSessionId) {
      return;
    }

    if (whatsAppStatus?.connected) {
      return;
    }

    if (!whatsAppStatus?.hasQr || whatsAppQr?.qr) {
      return;
    }

    const timeout = window.setTimeout(() => {
      loadWhatsAppState(true);
    }, 1500);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [whatsAppQr?.qr, whatsAppStatus?.connected, whatsAppStatus?.hasQr]);

  useEffect(() => {
    if (!token || !dashboardSessionId) {
      return;
    }

    const interval = window.setInterval(() => {
      loadWhatsAppState(true);
    }, whatsAppStatePollMs);

    return () => {
      window.clearInterval(interval);
    };
  }, [dashboardSessionId, selectedWhatsAppAccountId, token]);

  // Keep the inbox warm even if Supabase Realtime is unavailable or reconnecting.
  useEffect(() => {
    if (!token || !dashboardSessionId) {
      return;
    }

    const interval = window.setInterval(() => {
      void loadConversations(token, true);

      const activeSelection = activeSelectionRef.current;
      if (!activeSelection.selectedPhone) {
        return;
      }

      if (activeSelection.dashboardTab === "contacts") {
        void Promise.allSettled([
          loadCustomer(activeSelection.selectedPhone, token, activeSelection.activeContactChatJid, true),
          loadCustomerSalesItems(activeSelection.selectedPhone, token, activeSelection.activeContactChatJid, true)
        ]);
        return;
      }

      if (activeSelection.dashboardTab !== "inbox") {
        return;
      }

      void Promise.allSettled([
        loadMessages(activeSelection.selectedPhone, token, activeSelection.activeChatJid, true, true),
        loadCustomer(activeSelection.selectedPhone, token, activeSelection.activeChatJid, true),
        loadCustomerSalesItems(activeSelection.selectedPhone, token, activeSelection.activeChatJid, true)
      ]);
    }, conversationPollMs);

    return () => {
      window.clearInterval(interval);
    };
  }, [dashboardSessionId, token]);

  // Supabase Realtime subscription for inbox activity.
  useEffect(() => {
    // Clean up previous subscription if any
    if (realtimeChannelRef.current) {
      supabase.removeChannel(realtimeChannelRef.current);
      realtimeChannelRef.current = null;
    }

    // Only subscribe if the dashboard is ready.
    if (!token || !dashboardSessionId) {
      return;
    }

    const channel = supabase
      .channel("messages:inbox")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages"
        },
        (payload) => {
          const changedMessage = (payload.new || payload.old) as Message | undefined;
          if (
            selectedWhatsAppAccountId &&
            changedMessage?.whatsapp_account_id &&
            changedMessage.whatsapp_account_id !== selectedWhatsAppAccountId
          ) {
            return;
          }
          const changedConversationId = changedMessage ? getConversationIdentifier(changedMessage.phone, changedMessage.chat_jid) : null;
          const activeSelection = activeSelectionRef.current;
          const activeSelectedPhone = activeSelection.selectedPhone;
          const activeSelectedChatJid = String(activeSelection.activeChatJid || activeSelection.selectedConversationChatJid || "").trim();
          const changedChatJid = String(changedMessage?.chat_jid || "").trim();
          const matchesActiveConversation =
            Boolean(changedConversationId && activeSelectedPhone && changedConversationId === activeSelectedPhone) &&
            (!activeSelectedChatJid || !changedChatJid || activeSelectedChatJid === changedChatJid);

          if (matchesActiveConversation) {
            if (payload.eventType === "INSERT" && payload.new) {
              const newMessage = payload.new as Message;

              setMessages((current) => {
                if (current.some((message) => message.id === newMessage.id)) {
                  return current;
                }

                const next = [...current, newMessage].sort(
                  (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
                );
                const key = buildAccountScopedCacheKey(newMessage.phone, newMessage.chat_jid, selectedWhatsAppAccountId);
                messagesCacheRef.current[key] = next;
                return next;
              });
            } else if (payload.eventType === "UPDATE" && payload.new) {
              const updatedMessage = payload.new as Message;

              setMessages((current) => {
                const next = current.map((message) => (message.id === updatedMessage.id ? updatedMessage : message));
                const key = buildAccountScopedCacheKey(updatedMessage.phone, updatedMessage.chat_jid, selectedWhatsAppAccountId);
                messagesCacheRef.current[key] = next;
                return next;
              });
            } else if (payload.eventType === "DELETE" && payload.old) {
              const deletedMessage = payload.old as Message;

              setMessages((current) => {
                const next = current.filter((message) => message.id !== deletedMessage.id);
                const key = buildAccountScopedCacheKey(deletedMessage.phone, deletedMessage.chat_jid, selectedWhatsAppAccountId);
                messagesCacheRef.current[key] = next;
                return next;
              });
            }
          }

          if (conversationsRefreshTimerRef.current) {
            window.clearTimeout(conversationsRefreshTimerRef.current);
          }

          conversationsRefreshTimerRef.current = window.setTimeout(() => {
            void loadConversations(token, true);
          }, 150);
        }
      )
      .subscribe();

    realtimeChannelRef.current = channel;

    // Cleanup on unmount or dependency change
    return () => {
      supabase.removeChannel(channel);
      realtimeChannelRef.current = null;

      if (conversationsRefreshTimerRef.current) {
        window.clearTimeout(conversationsRefreshTimerRef.current);
        conversationsRefreshTimerRef.current = null;
      }
    };
  }, [dashboardSessionId, selectedWhatsAppAccountId, token]);

  useEffect(() => {
    return () => {
      if (conversationsRefreshTimerRef.current) {
        window.clearTimeout(conversationsRefreshTimerRef.current);
        conversationsRefreshTimerRef.current = null;
      }

      if (activeWhatsAppAccountChannelRef.current) {
        supabase.removeChannel(activeWhatsAppAccountChannelRef.current);
        activeWhatsAppAccountChannelRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimer) {
        window.clearTimeout(saveTimer);
      }
    };
  }, [saveTimer]);

  useEffect(() => {
    if (!selectedConversation?.unreadCount || !selectedPhone) {
      return;
    }

    markActiveConversationRead(selectedPhone, selectedConversation.chatJid);
  }, [selectedConversation?.chatJid, selectedConversation?.unreadCount, selectedPhone, token]);

  const sidebarCounts = useMemo(() => {
    return {
      inbox: leadConversations.length
    };
  }, [leadConversations]);

  const visibleConversations = useMemo(() => {
    if (activeStatusFilter) {
      return leadConversations.filter((conversation) => (conversation.status_counts?.[activeStatusFilter] ?? 0) > 0);
    }

    return leadConversations;
  }, [activeStatusFilter, leadConversations]);

  const customerStatusCounts =
    customerDraft?.status_counts || {
      new_lead: 0,
      interested: 0,
      processing: 0,
      closed_won: 0,
      closed_lost: 0
    };

  const sidebarStats = useMemo(
    () => ({
      statusCounts: {
        new_lead: leadConversations.filter((conversation) => (conversation.status_counts?.new_lead ?? 0) > 0).length,
        interested: leadConversations.filter((conversation) => (conversation.status_counts?.interested ?? 0) > 0).length,
        processing: leadConversations.filter((conversation) => (conversation.status_counts?.processing ?? 0) > 0).length,
        closed_won: leadConversations.filter((conversation) => (conversation.status_counts?.closed_won ?? 0) > 0).length,
        closed_lost: leadConversations.filter((conversation) => (conversation.status_counts?.closed_lost ?? 0) > 0).length
      },
      currentThreadMessages: messages.length,
      activeContact: customerDraft?.contact_name || selectedConversation?.contactName || selectedPhone || "None"
    }),
    [customerDraft?.contact_name, leadConversations, messages.length, selectedConversation?.contactName, selectedPhone]
  );

  useEffect(() => {
    if (activeDashboardTab !== "inbox") {
      return;
    }

    if (!visibleConversations.length) {
      setSelectedPhone(null);
      setSelectedConversationChatJid(null);
      return;
    }

    if (selectedPhone) {
      return;
    }

    setSelectedPhone(getConversationIdentifier(visibleConversations[0].phone, visibleConversations[0].chatJid));
    setSelectedConversationChatJid(visibleConversations[0].chatJid || null);
  }, [selectedPhone, visibleConversations]);

  async function handleAuthSubmit() {
    setAuthLoading(true);
    setAuthError("");
    setAuthNotice("");
    setSessionConflictMessage("");

    try {
      if (passwordRecoveryActive) {
        const trimmedPassword = password.trim();
        const trimmedConfirmation = confirmPassword.trim();

        if (trimmedPassword.length < 6) {
          throw new Error("Password must be at least 6 characters.");
        }

        if (trimmedPassword !== trimmedConfirmation) {
          throw new Error("Passwords do not match.");
        }

        const { error } = await supabase.auth.updateUser({ password: trimmedPassword });

        if (error) {
          throw error;
        }

        await supabase.auth.signOut();
        persistDashboardSession("");
        resetDashboardState();
        setPasswordRecoveryActive(false);
        setPassword("");
        setConfirmPassword("");
        setAuthNotice("Password updated. Log in with your new password.");
        return;
      }

      if (mode === "login") {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password
        });

        if (error) {
          throw error;
        }

        const activeToken = data.session?.access_token;

        if (!activeToken) {
          throw new Error("Authentication succeeded but no session was returned.");
        }

        await ensureDashboardSession(activeToken, { forceRefresh: true });
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: getEmailVerificationRedirectUrl()
          }
        });

        if (error) {
          throw error;
        }

        if (!data.session) {
          setAuthNotice("Account created. Confirm your email before logging in.");
        } else {
          await ensureDashboardSession(data.session.access_token, { forceRefresh: true });
        }
      }

      setPassword("");
      setConfirmPassword("");
    } catch (error) {
      if (error instanceof ApiError && error.code === "SESSION_ALREADY_ACTIVE") {
        setSessionConflictMessage(error.message);
        setAuthError("");
      } else {
        setAuthError(error instanceof Error ? error.message : "Authentication failed.");
      }
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleRequestPasswordReset() {
    const normalizedEmail = email.trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setAuthError("Enter a valid email address to receive a secure reset link.");
      setAuthNotice("");
      return;
    }

    setPasswordResetRequestLoading(true);
    setAuthError("");
    setAuthNotice("");
    setSessionConflictMessage("");

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: getPasswordRecoveryRedirectUrl()
      });

      if (error) {
        throw error;
      }

      setAuthNotice("If an account exists for that email, a secure password reset link has been sent.");
      setPassword("");
    } catch {
      setAuthNotice("If an account exists for that email, a secure password reset link has been sent.");
      setPassword("");
    } finally {
      setPasswordResetRequestLoading(false);
    }
  }

  async function handleReplaceActiveSession() {
    if (!token) {
      return;
    }

    setReplacingActiveSession(true);
    setAuthError("");

    try {
      await ensureDashboardSession(token, {
        forceRefresh: true,
        replaceExisting: true
      });
      setAuthError("");
      setSessionConflictMessage("");
      setPassword("");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Failed to replace the active session.");
    } finally {
      setReplacingActiveSession(false);
    }
  }

  async function handleResendVerification() {
    const normalizedEmail = email.trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setAuthError("Enter a valid email address to resend the verification link.");
      setAuthNotice("");
      return;
    }

    setVerificationResendLoading(true);
    setAuthError("");
    setAuthNotice("");

    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: normalizedEmail,
        options: {
          emailRedirectTo: getEmailVerificationRedirectUrl()
        }
      });

      if (error) {
        throw error;
      }

      setAuthNotice("If a pending account exists for that email, a new verification link has been sent.");
    } catch {
      setAuthNotice("If a pending account exists for that email, a new verification link has been sent.");
    } finally {
      setVerificationResendLoading(false);
    }
  }

  async function handleSend() {
    await sendTextMessage(chatInput);
  }

  async function sendTextMessage(rawMessage: string) {
    if (!selectedPhone || !rawMessage.trim() || !token) {
      return;
    }

    const outgoingText = rawMessage.trim();
    const tempId = `temp-${Date.now()}`;
    const optimisticMessage: Message = {
      id: tempId,
      phone: selectedPhone,
      chat_jid: activeChatJid,
      message: outgoingText,
      direction: "outgoing",
      created_at: new Date().toISOString(),
      send_status: "sending"
    };

    setSending(true);
    setDashboardError("");
    setMessages((current) => {
      const next = [...current, optimisticMessage];
      messagesCacheRef.current[buildAccountScopedCacheKey(selectedPhone, activeChatJid, selectedWhatsAppAccountId)] = next;
      return next;
    });

    if (rawMessage === chatInput) {
      setChatInput("");
    }

    try {
      const sentMessage = await api.sendMessage(
        selectedPhone,
        outgoingText,
        token,
        activeChatJid,
        selectedWhatsAppAccountId
      );
      setMessages((current) => {
        const next = current.map((item) => (item.id === tempId ? sentMessage : item));
        const key = buildAccountScopedCacheKey(optimisticMessage.phone, optimisticMessage.chat_jid, selectedWhatsAppAccountId);
        messagesCacheRef.current[key] = next;
        return next;
      });
      setConversations((current) =>
        sortConversationsByLatestMessage(
          current
          .map((item) =>
            item.phone === selectedPhone
              ? {
                  ...item,
                  lastMessage: sentMessage.message,
                  timestamp: sentMessage.created_at,
                  lastDirection: "outgoing" as const
                }
              : item
          )
        )
      );
    } catch (error) {
      setMessages((current) => {
        const next = current.map((item) => (item.id === tempId ? { ...item, send_status: "failed" as const } : item));
        const key = buildAccountScopedCacheKey(optimisticMessage.phone, optimisticMessage.chat_jid, selectedWhatsAppAccountId);
        messagesCacheRef.current[key] = next;
        return next;
      });
      setDashboardError(error instanceof Error ? error.message : "Failed to send message.");
    } finally {
      setSending(false);
    }
  }

  async function completeOutgoingSend(
    optimisticMessage: Message,
    sendRequest: () => Promise<Message>,
    nextConversationPreview?: string
  ) {
    setSending(true);
    setDashboardError("");
    setMessages((current) => {
      const next = [...current, optimisticMessage];
      const key = buildAccountScopedCacheKey(optimisticMessage.phone, optimisticMessage.chat_jid, selectedWhatsAppAccountId);
      messagesCacheRef.current[key] = next;
      return next;
    });

    try {
      const sentMessage = await sendRequest();
      setMessages((current) => {
        const next = current.map((item) => (item.id === optimisticMessage.id ? sentMessage : item));
        const key = buildAccountScopedCacheKey(optimisticMessage.phone, optimisticMessage.chat_jid, selectedWhatsAppAccountId);
        messagesCacheRef.current[key] = next;
        return next;
      });
      setConversations((current) =>
        sortConversationsByLatestMessage(
          current
          .map((item) =>
            item.phone === optimisticMessage.phone
              ? {
                  ...item,
                  lastMessage: nextConversationPreview || sentMessage.message,
                  timestamp: sentMessage.created_at,
                  lastDirection: "outgoing" as const
                }
              : item
          )
        )
      );
    } catch (error) {
      setMessages((current) => {
        const next = current.map((item) => (item.id === optimisticMessage.id ? { ...item, send_status: "failed" as const } : item));
        const key = buildAccountScopedCacheKey(optimisticMessage.phone, optimisticMessage.chat_jid, selectedWhatsAppAccountId);
        messagesCacheRef.current[key] = next;
        return next;
      });
      setDashboardError(error instanceof Error ? error.message : "Failed to send message.");
      throw error;
    } finally {
      setSending(false);
    }
  }

  async function handleSendAttachment(file: File, caption?: string) {
    if (!selectedPhone || !token) {
      return;
    }

    const previewText = buildAttachmentPreviewText(file, caption ?? "");
    const mediaType = getAttachmentMediaType(file);
    const mediaDataUrl = await readFileAsDataUrl(file);

    const optimisticMessage: Message = {
      id: `temp-attachment-${Date.now()}`,
      phone: selectedPhone,
      chat_jid: activeChatJid,
      message: previewText,
      media_type: mediaType,
      media_mime_type: file.type || "application/octet-stream",
      media_file_name: file.name,
      media_data_url: mediaDataUrl,
      direction: "outgoing",
      created_at: new Date().toISOString(),
      send_status: "sending"
    };

    await completeOutgoingSend(
      optimisticMessage,
      () =>
        api.sendAttachment(selectedPhone, file, token, {
          chatJid: activeChatJid,
          caption: (caption ?? "").trim(),
          whatsappAccountId: selectedWhatsAppAccountId
        }),
      previewText
    );
  }

  async function handleSendLocation(payload: { latitude: number; longitude: number; name?: string; address?: string }) {
    if (!selectedPhone || !token) {
      return;
    }

    const label = payload.name?.trim() || payload.address?.trim() || `${payload.latitude}, ${payload.longitude}`;
    const previewText = `[Location] ${label}`;
    const optimisticMessage: Message = {
      id: `temp-location-${Date.now()}`,
      phone: selectedPhone,
      chat_jid: activeChatJid,
      message: previewText,
      direction: "outgoing",
      created_at: new Date().toISOString(),
      send_status: "sending"
    };

    await completeOutgoingSend(
      optimisticMessage,
      () =>
        api.sendLocation(
          selectedPhone,
          {
            ...payload,
            chatJid: activeChatJid,
            whatsappAccountId: selectedWhatsAppAccountId
          },
          token
        ),
      previewText
    );
  }

  async function handleLogout() {
    if (saveTimer) {
      window.clearTimeout(saveTimer);
      setSaveTimer(null);
    }
    if (token && dashboardSessionId) {
      await api.deleteDashboardSession(token).catch(() => undefined);
    }
    await supabase.auth.signOut();
    persistDashboardSession("");
    resetDashboardState();
  }

  function scheduleCustomerSave(nextCustomer: Customer, immediate = false) {
    if (saveTimer) {
      window.clearTimeout(saveTimer);
    }

    const timeout = window.setTimeout(
      () => {
        persistCustomer(nextCustomer);
        setSaveTimer(null);
      },
      immediate ? 0 : 500
    );

    setSaveTimer(timeout);
  }

  function syncSavedCustomer(savedCustomer: Customer) {
    const savedConversationId = getConversationIdentifier(savedCustomer.phone, savedCustomer.chat_jid);
    const normalizedSavedChatJid = String(savedCustomer.chat_jid || "").trim();

    setCustomerDraft(savedCustomer);

    if (savedConversationId) {
      setSelectedContactConversationId(savedConversationId);
    }

    setSelectedContactChatJid(savedCustomer.chat_jid || null);

    setContacts((current) => {
      const nextContacts = current.filter((contact) => {
        const contactConversationId = getConversationIdentifier(contact.phone, contact.chat_jid);
        const normalizedContactChatJid = String(contact.chat_jid || "").trim();

        if (savedConversationId && contactConversationId === savedConversationId) {
          return false;
        }

        if (normalizedSavedChatJid && normalizedContactChatJid === normalizedSavedChatJid) {
          return false;
        }

        return true;
      });

      return sortContactsByDisplayPriority([savedCustomer, ...nextContacts]);
    });

    setConversations((current) =>
      current.map((conversation) => {
        const conversationId = getConversationIdentifier(conversation.phone, conversation.chatJid);
        const normalizedConversationChatJid = String(conversation.chatJid || "").trim();
        const matchesConversation = Boolean(savedConversationId && conversationId === savedConversationId);
        const matchesChatJid = Boolean(normalizedSavedChatJid && normalizedConversationChatJid === normalizedSavedChatJid);

        if (!matchesConversation && !matchesChatJid) {
          return conversation;
        }

        return {
          ...conversation,
          contactName: savedCustomer.contact_name ?? null,
          status: savedCustomer.status
        };
      })
    );
  }

  const activeCustomerPhone =
    activeDashboardTab === "contacts"
      ? selectedContactConversationId || contactPanelCustomer?.phone || null
      : customerDraft?.phone || selectedPhone;
  const selectedStatus = selectedConversation?.status || customerDraft?.status || "new_lead";
  const selectedNotes = customerDraft?.notes || "";
  const activeCustomerChatJid =
    activeDashboardTab === "contacts"
      ? activeContactChatJid || contactPanelCustomer?.chat_jid || null
      : selectedConversation?.chatJid || customerDraft?.chat_jid || null;
  const displayProfilePictureUrl =
    activeDashboardTab === "contacts"
      ? contactPanelCustomer?.profile_picture_url || null
      : customerDraft?.profile_picture_url || selectedConversation?.profilePictureUrl || null;

  const activeCustomerForEdit: Customer | null = activeCustomerPhone
    ? {
        phone: activeCustomerPhone,
        whatsapp_account_id: activeConversationSourceAccountId,
        chat_jid: activeCustomerChatJid,
        contact_name:
          activeDashboardTab === "contacts"
            ? contactPanelCustomer?.contact_name || null
            : customerDraft?.contact_name || selectedConversation?.contactName || null,
        is_contact_anchor: contactPanelCustomer?.is_contact_anchor ?? false,
        status: activeDashboardTab === "contacts" ? contactPanelCustomer?.status || "new_lead" : selectedStatus,
        contact_status: contactPanelCustomer?.contact_status ?? null,
        notes: selectedNotes,
        profile_picture_url: displayProfilePictureUrl,
        about: contactPanelCustomer?.about || null,
        total_messages: contactPanelCustomer?.total_messages,
        incoming_count: contactPanelCustomer?.incoming_count,
        outgoing_count: contactPanelCustomer?.outgoing_count,
        last_message_at: contactPanelCustomer?.last_message_at || null,
        last_message_preview: contactPanelCustomer?.last_message_preview || null,
        last_direction: contactPanelCustomer?.last_direction || null,
        premise_address: contactPanelCustomer?.premise_address ?? "",
        business_type: contactPanelCustomer?.business_type ?? "",
        age: contactPanelCustomer?.age ?? null,
        email_address: contactPanelCustomer?.email_address ?? "",
        contact_id: contactPanelCustomer?.contact_id ?? "",
        id: contactPanelCustomer?.id,
        updated_at: contactPanelCustomer?.updated_at ?? undefined
      }
    : null;

  const customerPanelProps: CustomerPanelProps | null = activeCustomerPhone
    ? {
        contactName:
          activeDashboardTab === "contacts"
            ? contactPanelCustomer?.contact_name || null
            : customerDraft?.contact_name || selectedConversation?.contactName || null,
        about: contactPanelCustomer?.about || null,
        chatJid: activeCustomerChatJid,
        customerId: contactPanelCustomer?.id ?? null,
        updatedAt: contactPanelCustomer?.updated_at ?? null,
        incomingCount: contactPanelCustomer?.incoming_count,
        lastDirection: contactPanelCustomer?.last_direction || null,
        lastMessageAt: contactPanelCustomer?.last_message_at || null,
        lastMessagePreview: contactPanelCustomer?.last_message_preview || null,
        loading: loadingCustomer,
        notes: selectedNotes,
        outgoingCount: contactPanelCustomer?.outgoing_count,
        phone: activeCustomerPhone,
        profilePictureUrl: displayProfilePictureUrl,
        saving: savingCustomer,
        status: activeDashboardTab === "contacts" ? contactPanelCustomer?.status || "new_lead" : selectedStatus,
        contactStatus: contactPanelCustomer?.contact_status ?? null,
        statusCounts: activeDashboardTab === "contacts" ? customerStatusCounts : customerStatusCounts,
        totalMessages: contactPanelCustomer?.total_messages ?? 0,
        isContactAnchor: contactPanelCustomer?.is_contact_anchor ?? false,
        // New fields for customer info window
        premiseAddress: contactPanelCustomer?.premise_address ?? "",
        businessType: contactPanelCustomer?.business_type ?? "",
        age: contactPanelCustomer?.age ?? null,
        emailAddress: contactPanelCustomer?.email_address ?? "",
        contactId: contactPanelCustomer?.contact_id ?? "",
        onEditProfile: activeCustomerForEdit ? () => openContactEditor(activeCustomerForEdit) : undefined,
        onNotesChange: (value) => {
          if (!activeCustomerPhone) {
            return;
          }

          const nextCustomer: Customer = {
            phone: activeCustomerPhone,
            chat_jid: activeCustomerChatJid,
            contact_name:
              activeDashboardTab === "contacts"
                ? contactPanelCustomer?.contact_name || null
                : customerDraft?.contact_name || selectedConversation?.contactName || null,
            is_contact_anchor: contactPanelCustomer?.is_contact_anchor ?? false,
            profile_picture_url: displayProfilePictureUrl,
            about: contactPanelCustomer?.about || null,
            total_messages: contactPanelCustomer?.total_messages,
            incoming_count: contactPanelCustomer?.incoming_count,
            outgoing_count: contactPanelCustomer?.outgoing_count,
            last_message_at: contactPanelCustomer?.last_message_at || null,
            last_message_preview: contactPanelCustomer?.last_message_preview || null,
            last_direction: contactPanelCustomer?.last_direction || null,
            status: selectedStatus,
            contact_status: contactPanelCustomer?.contact_status ?? null,
            notes: value,
            // Pass through new fields if present
            premise_address: contactPanelCustomer?.premise_address,
            business_type: contactPanelCustomer?.business_type,
            age: contactPanelCustomer?.age,
            email_address: contactPanelCustomer?.email_address,
            contact_id: contactPanelCustomer?.contact_id,
          };

          setCustomerDraft(nextCustomer);
          scheduleCustomerSave(nextCustomer);
        }
      }
    : null;

  async function handleEditCustomerSave(updatedCustomer: {
    phone: string;
    chat_jid?: string | null;
    contact_name?: string | null;
    status: Customer["status"];
    contact_status?: Customer["contact_status"];
    notes: string;
    profile_picture_url?: string | null;
    about?: string | null;
    premise_address?: string | null;
    business_type?: string | null;
    age?: number | null;
    email_address?: string | null;
  }) {
    if (!token) {
      return;
    }

    try {
      const savedCustomer = await api.saveCustomer(
        updatedCustomer.phone,
        {
          contact_name: updatedCustomer.contact_name ?? null,
          chat_jid: updatedCustomer.chat_jid || null,
          status: updatedCustomer.status,
          contact_status: updatedCustomer.contact_status ?? null,
          notes: updatedCustomer.notes,
          profile_picture_url: updatedCustomer.profile_picture_url ?? null,
          about: updatedCustomer.about ?? null,
          premise_address: updatedCustomer.premise_address ?? null,
          business_type: updatedCustomer.business_type ?? null,
          age: updatedCustomer.age ?? null,
          email_address: updatedCustomer.email_address ?? null,
          whatsappAccountId: activeConversationSourceAccountId
        },
        token
      );

      syncSavedCustomer(savedCustomer);
      updateConversationStatus({
        phone: savedCustomer.phone,
        chatJid: savedCustomer.chat_jid,
        status: savedCustomer.status
      });

      if (activeDashboardTab === "contacts") {
        await fetchContacts({ page: 1, query: contactsQuery, silent: true });
      }
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : "Failed to save customer.");
      throw error;
    }
  }

  function openContactEditor(contact: Customer) {
    setEditingCustomer(contact);
    setEditingCustomerOpen(true);
  }

  if (!token || !dashboardSessionId) {
    return (
      <main className="min-h-screen bg-app px-4 py-10">
        <div className="mx-auto flex min-h-[calc(100dvh-5rem)] max-w-6xl items-center justify-center">
          <LoginForm
            authReady={authReady}
            confirmPassword={confirmPassword}
            email={email}
            error={authError}
            loading={authLoading}
            mode={mode}
            notice={authNotice}
            onConfirmPasswordChange={setConfirmPassword}
            onEmailChange={setEmail}
            onModeChange={setMode}
            onPasswordChange={setPassword}
            onRequestPasswordReset={handleRequestPasswordReset}
            onResendVerification={handleResendVerification}
            onReplaceActiveSession={handleReplaceActiveSession}
            onSubmit={handleAuthSubmit}
            password={password}
            passwordRecoveryActive={passwordRecoveryActive}
            passwordResetRequestLoading={passwordResetRequestLoading}
            replacingActiveSession={replacingActiveSession}
            sessionConflictMessage={sessionConflictMessage}
            verificationResendLoading={verificationResendLoading}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-dvh flex-col bg-app px-4 py-4 text-ink sm:py-5 lg:py-6">
      <div className="fixed inset-x-0 top-0 z-40 px-4 pt-2 pb-2 sm:pt-3 lg:pt-4">
        <div className="mx-auto max-w-[1600px]">
          <TopBar
            activeTab={activeDashboardTab}
            activeWhatsAppNumber={selectedWhatsAppAccount?.account_phone || null}
            connectActionLabel={connectActionLabel}
            connectingNewWhatsApp={connectingNewWhatsApp}
            disconnectingWhatsApp={disconnectingWhatsApp}
            loadingWhatsApp={loadingWhatsApp}
            onChangeTab={setActiveDashboardTab}
            onCleanupWhatsAppAccounts={handleCleanupWhatsAppAccounts}
            onConnectNewWhatsApp={handleConnectNewWhatsApp}
            onDisconnectWhatsApp={handleDisconnectWhatsApp}
            onLogout={handleLogout}
            selectedWhatsAppAccountId={selectedWhatsAppAccountId}
            token={token}
            userEmail={userEmail}
            whatsAppQr={whatsAppQr}
            whatsAppStatus={effectiveWhatsAppStatus}
          />
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-[1600px] min-h-0 flex-1 flex-col gap-4 pt-44 sm:pt-48 lg:pt-28">
        {dashboardError ? <div className="glass-panel border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">{dashboardError}</div> : null}
        {dashboardNotice ? <div className="glass-panel border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{dashboardNotice}</div> : null}

        {isSalesDashboard ? (
          <div className="min-h-0 flex-1 space-y-4 xl:grid xl:grid-cols-[minmax(320px,360px)_minmax(0,1fr)] xl:items-stretch xl:gap-4 xl:space-y-0 xl:space-x-0">
            <Sidebar
              activeView={activeView}
              activeStatusFilter={activeStatusFilter}
              counts={sidebarCounts}
              onChangeView={setActiveView}
              onStatusFilterChange={setActiveStatusFilter}
              stats={sidebarStats}
            />
            <SalesDashboard
              activeContact={selectedConversation?.contactName || customerDraft?.contact_name || selectedPhone || "None"}
              conversations={leadConversations}
              loading={loadingAllSalesLeadItems}
              onOpenConversation={({ phone, chatJid, messageId }) => {
                const exactId = getConversationIdentifier(phone, chatJid);
                const fallbackConversation =
                  leadConversations.find((conversation) => {
                    const conversationId = getConversationIdentifier(conversation.phone, conversation.chatJid);
                    return exactId ? conversationId === exactId : conversation.phone === phone;
                  }) ||
                  leadConversations.find((conversation) => conversation.phone === phone) ||
                  null;

                const nextConversationId =
                  getConversationIdentifier(fallbackConversation?.phone, fallbackConversation?.chatJid) ||
                  exactId ||
                  getConversationIdentifier(phone, null);

                if (!nextConversationId) {
                  return;
                }

                setActiveStatusFilter(null);
                setActiveView("inbox");
                setActiveDashboardTab("inbox");
                setActiveMessageFilterId(messageId || null);
                setSelectedPhone(nextConversationId);
                setSelectedConversationChatJid(fallbackConversation?.chatJid || chatJid || null);
              }}
              onRefresh={() => {
                if (!token) {
                  return;
                }

                loadWhatsAppState(true);
                loadConversations(token, true);
                loadAllSalesLeadItems(token, true);
              }}
              salesLeadItems={allSalesLeadItems.length ? allSalesLeadItems : salesLeadItems}
            />
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-4 xl:grid xl:grid-cols-[minmax(320px,360px)_minmax(0,3fr)_minmax(0,2fr)] xl:items-stretch xl:gap-4 xl:space-y-0 xl:space-x-0">
            <Sidebar
              activeView={activeView}
              activeStatusFilter={activeStatusFilter}
              counts={sidebarCounts}
              onChangeView={setActiveView}
              onStatusFilterChange={setActiveStatusFilter}
              stats={sidebarStats}
            />

            <div className="min-h-0 space-y-4 xl:contents">
              <div className="grid min-h-0 grid-cols-1 items-start gap-4 lg:grid-cols-[3fr_2fr] lg:items-stretch xl:contents">
                <div className="space-y-4 lg:col-start-1 lg:col-end-2 xl:col-start-2 xl:col-end-3 xl:min-h-0 xl:h-full">
                  {activeDashboardTab === "inbox" ? (
                    <ChatList
                      activeView={activeView}
                      conversations={visibleConversations}
                      deletingConversationKey={deletingConversationKey}
                      loading={loadingChats}
                      onDeleteConversation={handleDeleteConversation}
                      onRefresh={() => {
                        if (!token) {
                          return;
                        }

                        loadWhatsAppState(true);
                        loadConversations(token, true);

                        if (selectedPhone) {
                          loadMessages(selectedPhone, token, activeCustomerChatJid, true, true);
                          loadCustomer(selectedPhone, token, activeCustomerChatJid, true);
                          loadCustomerSalesItems(selectedPhone, token, activeCustomerChatJid, true);
                        }
                      }}
                      onSelect={(phone, chatJid) => {
                        setActiveMessageFilterId(null);
                        setSelectedPhone(phone);
                        setSelectedConversationChatJid(chatJid || null);
                      }}
                      onSelectWhatsAppAccount={(accountId) => setSelectedWhatsAppAccountId(accountId || null)}
                      refreshing={refreshingChats}
                      selectedPhone={selectedPhone}
                      selectedChatJid={selectedConversationChatJid}
                      selectedWhatsAppAccountId={selectedWhatsAppAccountId}
                      whatsAppAccounts={whatsAppAccounts}
                      whatsAppConnected={effectiveWhatsAppStatus?.connected === true}
                    />
                  ) : (
                    <ContactList
                      activeStatusFilter={activeStatusFilter}
                      contacts={contacts}
                      loading={contactsLoading}
                      refreshing={contactsRefreshing}
                      whatsAppAccounts={whatsAppAccounts}
                      selectedConversationId={selectedContactConversationId}
                      selectedChatJid={selectedContactChatJid}
                      page={contactsPage}
                      pageSize={CONTACTS_PAGE_SIZE}
                      total={contactsTotal}
                      onPageChange={(page) => fetchContacts({ page })}
                      onQueryChange={handleContactsQueryChange}
                      query={contactsQuery}
                      onEditContact={openContactEditor}
                      onRefresh={() => fetchContacts({ page: contactsPage, query: contactsQuery })}
                      onSelect={(phone, chatJid, opts) => {
                        setActiveMessageFilterId(null);
                        setSelectedContactConversationId(phone);
                        setSelectedContactChatJid(chatJid || null);
                        if (opts && opts.focusChatInput) {
                          setActiveDashboardTab("inbox");
                          setActiveView("inbox");
                          setSelectedPhone(phone);
                          setSelectedConversationChatJid(chatJid || null);
                          setTimeout(() => {
                            const chatInput = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(".chat-input-editor, .chat-input textarea, .chat-input input");
                            if (chatInput) {
                              chatInput.scrollIntoView({ behavior: "smooth", block: "end" });
                              chatInput.focus();
                            }
                          }, 300);
                        }
                      }}
                    />
                  )}
                </div>

                <div className="order-2 lg:order-none lg:col-start-2 lg:col-end-3 xl:col-start-3 xl:col-end-4 xl:min-h-0 xl:h-full">
                  {activeDashboardTab === "inbox" ? (
                    <ChatWindow
                      canSendMessages={activeConversationCanSend}
                      contactName={customerDraft?.contact_name || selectedConversation?.contactName || null}
                      customerPanelProps={customerPanelProps}
                      chatJid={selectedConversation?.chatJid || customerDraft?.chat_jid || null}
                      disconnectedSourceLabel={activeConversationCanSend ? null : activeConversationSourceLabel}
                      deletingMessageId={deletingMessageId}
                      loading={loadingMessages}
                      loadingSalesLeadItems={loadingSalesLeadItems}
                      messageText={chatInput}
                      messages={messages}
                      onChangeMessage={setChatInput}
                      onCreateSalesLeadItem={handleCreateSalesLeadItem}
                      onUpdateSalesLeadItem={handleUpdateSalesLeadItem}
                      onDeleteMessage={handleDeleteMessage}
                      onSendAttachment={handleSendAttachment}
                      onSendLocation={handleSendLocation}
                      onSend={handleSend}
                      onSendQuickReply={sendTextMessage}
                      messageFilterId={activeMessageFilterId}
                      onClearMessageFilter={() => setActiveMessageFilterId(null)}
                      phone={activeCustomerPhone || null}
                      profilePictureUrl={displayProfilePictureUrl}
                      repopulatingFromWhatsApp={repopulatingConversation}
                      salesLeadItems={salesLeadItems}
                      salesLeadStatus={selectedStatus}
                      savingSalesLeadItem={savingSalesLeadItem}
                      sending={sending}
                      onRepopulateFromWhatsApp={handleRepopulateConversation}
                      onManualRefresh={() => {
                        if (!token) return;
                        loadWhatsAppState(true);
                        loadConversations(token, true);
                        if (selectedPhone) {
                          loadMessages(selectedPhone, token, activeChatJid, true, true);
                          loadCustomer(selectedPhone, token, activeChatJid, true);
                          loadCustomerSalesItems(selectedPhone, token, activeChatJid, true);
                        }
                      }}
                    />
                  ) : activeDashboardTab === "contacts" && customerPanelProps ? (
                    <CustomerPanel
                      {...customerPanelProps}
                      mobileCollapsed={customerPanelCollapsed}
                      onToggleMobileCollapse={() => setCustomerPanelCollapsed((current) => !current)}
                    />
                  ) : (
                    <section className="glass-panel flex min-h-[420px] flex-col items-center justify-center p-6 text-center">
                      <p className="text-xs uppercase tracking-[0.25em] text-whatsapp-muted">Contact details</p>
                      <h3 className="mt-3 text-xl font-semibold text-ink">Select a contact</h3>
                      <p className="mt-2 max-w-sm text-sm leading-6 text-whatsapp-muted">
                        Pick a contact from the CRM list to review profile details, update lead status, and manage notes without leaving the dashboard.
                      </p>
                    </section>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
        <CustomerEditModal
          customer={editingCustomer}
          isOpen={editingCustomerOpen}
          onClose={() => {
            setEditingCustomerOpen(false);
            setEditingCustomer(null);
          }}
          onSave={handleEditCustomerSave}
        />
    </div>
  </main>
);
}

export default App;
