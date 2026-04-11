import { useEffect, useMemo, useRef, useState } from "react";
import { ChatList } from "./components/ChatList";
import { ChatWindow } from "./components/ChatWindow";
import { ContactList } from "./components/ContactList";
import { CustomerPanel } from "./components/CustomerPanel";
import type { CustomerPanelProps } from "./components/CustomerPanel";
import { LoginForm } from "./components/LoginForm";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { SalesDashboard } from "./components/SalesDashboard";
import { ApiError, api, CUSTOMER_STATUSES, setApiSessionId, setApiUnauthorizedHandler, type Conversation, type Customer, type CustomerStatus, type Message, type SalesLeadItem, type WhatsAppQr, type WhatsAppStatus } from "./lib/api";
import { getConversationIdentifier, getResolvedPhone } from "./lib/display";
import { clearPasswordRecoveryCallback, getEmailVerificationRedirectUrl, getPasswordRecoveryRedirectUrl, isPasswordRecoveryCallback, supabase } from "./lib/supabase";

type AuthMode = "login" | "register";
type DashboardTab = "inbox" | "contacts" | "sales";
type SidebarView = "inbox" | "pipeline" | "broadcast";
const conversationPollMs = 8000;
const dashboardSessionStorageKey = "whatsapp-crm-dashboard-session-id";

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
  const [activeMessageFilterId, setActiveMessageFilterId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [loadingChats, setLoadingChats] = useState(false);
  const [refreshingChats, setRefreshingChats] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [dashboardError, setDashboardError] = useState("");
  const [loadingCustomer, setLoadingCustomer] = useState(false);
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [customerDraft, setCustomerDraft] = useState<Customer | null>(null);
  const [salesLeadItems, setSalesLeadItems] = useState<SalesLeadItem[]>([]);
  const [allSalesLeadItems, setAllSalesLeadItems] = useState<SalesLeadItem[]>([]);
  const [loadingSalesLeadItems, setLoadingSalesLeadItems] = useState(false);
  const [loadingAllSalesLeadItems, setLoadingAllSalesLeadItems] = useState(false);
  const [savingSalesLeadItem, setSavingSalesLeadItem] = useState(false);
  const [customerPanelCollapsed, setCustomerPanelCollapsed] = useState(true);
  const [saveTimer, setSaveTimer] = useState<number | null>(null);
  const [whatsAppStatus, setWhatsAppStatus] = useState<WhatsAppStatus | null>(null);
  const [whatsAppQr, setWhatsAppQr] = useState<WhatsAppQr | null>(null);
  const [connectedWhatsAppPhone, setConnectedWhatsAppPhone] = useState<string | null>(null);
  const [loadingWhatsApp, setLoadingWhatsApp] = useState(true);
  const [disconnectingWhatsApp, setDisconnectingWhatsApp] = useState(false);
  const [deletingConversationKey, setDeletingConversationKey] = useState<string | null>(null);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const handlingSessionRevocationRef = useRef(false);
  const isSalesDashboard = activeDashboardTab === "sales";

  function resetDashboardState() {
    setToken("");
    setDashboardSessionId("");
    setSessionConflictMessage("");
    setUserEmail("");
    setConversations([]);
    setSelectedPhone(null);
    setActiveMessageFilterId(null);
    setMessages([]);
    setCustomerDraft(null);
    setSalesLeadItems([]);
    setAllSalesLeadItems([]);
    setConnectedWhatsAppPhone(null);
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
      await api.markConversationRead(phone, token, chatJid);
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : "Failed to clear unread count.");
      loadConversations(token, true);
    }
  }

  async function loadConversations(activeToken: string, silent = false) {
    if (!silent) {
      setLoadingChats(true);
      setDashboardError("");
    } else {
      setRefreshingChats(true);
    }

    try {
      const data = await api.getConversations(activeToken);
      setConversations(data);
      setSelectedPhone((current) => {
        if (!data.length) {
          return null;
        }

        if (current && data.some((item) => getConversationIdentifier(item.phone, item.chatJid) === current)) {
          return current;
        }

        return getConversationIdentifier(data[0]?.phone, data[0]?.chatJid) || null;
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

  async function loadMessages(phone: string, activeToken: string, chatJid?: string | null, silent = false) {
    if (!silent) {
      setLoadingMessages(true);
    }

    try {
      const data = await api.getMessages(phone, activeToken, chatJid);
      setMessages(data);
    } catch (error) {
      if (!silent) {
        setDashboardError(error instanceof Error ? error.message : "Failed to load messages.");
      } else {
        console.warn("Silent message refresh failed:", error);
      }
    } finally {
      if (!silent) {
        setLoadingMessages(false);
      }
    }
  }

  async function loadCustomer(phone: string, activeToken: string, chatJid?: string | null, silent = false) {
    if (!silent) {
      setLoadingCustomer(true);
    }

    try {
      const data = await api.getCustomer(phone, activeToken, chatJid);
      setCustomerDraft(data);
      setSelectedPhone((current) => data.phone || current);
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
    if (!silent) {
      setLoadingSalesLeadItems(true);
    }

    try {
      const data = await api.getCustomerSalesItems(phone, activeToken, chatJid);
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
      const data = await api.getSalesLeadItems(activeToken);
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
      await api.deleteConversation(phone, token, chatJid);

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
        setMessages([]);
        setCustomerDraft(null);
        setSalesLeadItems([]);
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

      setMessages((current) => current.filter((item) => item.id !== message.id));

      await loadConversations(token, true);

      if (selectedPhone && selectedPhone === targetPhone) {
        await Promise.allSettled([
          loadMessages(targetPhone, token, targetChatJid, true),
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
          chat_jid: nextCustomer.chat_jid || null,
          status: nextCustomer.status,
          notes: nextCustomer.notes
        },
        token
      );
      setCustomerDraft(savedCustomer);
      updateConversationStatus({
        phone: savedCustomer.phone,
        chatJid: savedCustomer.chat_jid,
        status: savedCustomer.status
      });
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
          chatJid: activeCustomerChatJid
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
          notes: selectedNotes
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
          chatJid: activeCustomerChatJid
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
          notes: selectedNotes
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

  async function loadWhatsAppState(silent = false) {
    if (!silent) {
      setLoadingWhatsApp(true);
    }

    try {
      const [status, qr] = await Promise.all([api.getWhatsAppStatus(), api.getWhatsAppQr()]);
      setWhatsAppStatus(status);
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

      if (token) {
        const profile = await api.getWhatsAppProfile(token).catch(() => null);
        setConnectedWhatsAppPhone(normalizePhoneValue(profile?.phone));
      } else {
        setConnectedWhatsAppPhone(null);
      }
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : "Failed to load WhatsApp state.");
    } finally {
      if (!silent) {
        setLoadingWhatsApp(false);
      }
    }
  }

  async function handleDisconnectWhatsApp() {
    if (!token || disconnectingWhatsApp) {
      return;
    }

    setDisconnectingWhatsApp(true);
    setDashboardError("");

    try {
      const status = await api.disconnectWhatsApp(token);
      setWhatsAppStatus(status);
      setWhatsAppQr({
        connected: status.connected,
        state: status.state,
        qr: null
      });

      window.setTimeout(() => {
        loadWhatsAppState(true);
      }, 3500);
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : "Failed to disconnect WhatsApp.");
    } finally {
      setDisconnectingWhatsApp(false);
    }
  }

  const leadConversations = useMemo(() => {
    if (!connectedWhatsAppPhone) {
      return conversations;
    }

    return conversations.filter((conversation) => normalizePhoneValue(conversation.phone) !== connectedWhatsAppPhone);
  }, [connectedWhatsAppPhone, conversations]);

  const selectedConversation = useMemo(
    () => leadConversations.find((conversation) => getConversationIdentifier(conversation.phone, conversation.chatJid) === selectedPhone) || null,
    [leadConversations, selectedPhone]
  );
  const activeChatJid = selectedConversation?.chatJid || customerDraft?.chat_jid || null;

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
    loadWhatsAppState();
  }, []);

  useEffect(() => {
    if (!token || !dashboardSessionId) {
      setConnectedWhatsAppPhone(null);
      return;
    }

    loadWhatsAppState(true);
    loadConversations(token);
  }, [dashboardSessionId, token]);

  useEffect(() => {
    if (!token || !dashboardSessionId || !selectedPhone) {
      setMessages([]);
      setCustomerDraft(null);
      setSalesLeadItems([]);
      return;
    }

    loadMessages(selectedPhone, token, activeChatJid);
    loadCustomer(selectedPhone, token, activeChatJid);
    loadCustomerSalesItems(selectedPhone, token, activeChatJid);
  }, [activeChatJid, dashboardSessionId, selectedPhone, token]);

  useEffect(() => {
    if (!token || !dashboardSessionId || activeDashboardTab !== "sales") {
      return;
    }

    loadAllSalesLeadItems(token, true);
  }, [activeDashboardTab, dashboardSessionId, token]);

  useEffect(() => {
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
    if (token) {
      return;
    }

    const interval = window.setInterval(() => {
      loadWhatsAppState(true);
    }, conversationPollMs);

    return () => {
      window.clearInterval(interval);
    };
  }, [token]);

  useEffect(() => {
    if (!token || !dashboardSessionId) {
      return;
    }

    const interval = window.setInterval(() => {
      loadWhatsAppState(true);
      loadConversations(token, true);

      if (selectedPhone) {
        loadMessages(selectedPhone, token, activeChatJid, true);
        loadCustomer(selectedPhone, token, activeChatJid, true);
        loadCustomerSalesItems(selectedPhone, token, activeChatJid, true);
      }
    }, conversationPollMs);

    return () => {
      window.clearInterval(interval);
    };
  }, [activeChatJid, dashboardSessionId, selectedPhone, token]);

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
      activeContact: selectedConversation?.contactName || customerDraft?.contact_name || selectedPhone || "None"
    }),
    [customerDraft?.contact_name, leadConversations, messages.length, selectedConversation?.contactName, selectedPhone]
  );

  useEffect(() => {
    if (!visibleConversations.length) {
      setSelectedPhone(null);
      return;
    }

    if (
      selectedPhone &&
      visibleConversations.some((conversation) => getConversationIdentifier(conversation.phone, conversation.chatJid) === selectedPhone)
    ) {
      return;
    }

    setSelectedPhone(getConversationIdentifier(visibleConversations[0].phone, visibleConversations[0].chatJid));
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
    setMessages((current) => [...current, optimisticMessage]);

    if (rawMessage === chatInput) {
      setChatInput("");
    }

    try {
      const sentMessage = await api.sendMessage(
        selectedPhone,
        outgoingText,
        token,
        activeChatJid
      );
      setMessages((current) =>
        current.map((item) => (item.id === tempId ? sentMessage : item))
      );
      setConversations((current) =>
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
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      );
    } catch (error) {
      setMessages((current) =>
        current.map((item) => (item.id === tempId ? { ...item, send_status: "failed" } : item))
      );
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
    setMessages((current) => [...current, optimisticMessage]);

    try {
      const sentMessage = await sendRequest();
      setMessages((current) => current.map((item) => (item.id === optimisticMessage.id ? sentMessage : item)));
      setConversations((current) =>
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
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      );
    } catch (error) {
      setMessages((current) =>
        current.map((item) => (item.id === optimisticMessage.id ? { ...item, send_status: "failed" } : item))
      );
      setDashboardError(error instanceof Error ? error.message : "Failed to send message.");
      throw error;
    } finally {
      setSending(false);
    }
  }

  async function handleSendAttachment(file: File, caption: string) {
    if (!selectedPhone || !token) {
      return;
    }

    const previewText = buildAttachmentPreviewText(file, caption);
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
          caption: caption.trim()
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
            chatJid: activeChatJid
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

  const activeCustomerPhone = customerDraft?.phone || selectedPhone;
  const selectedStatus = selectedConversation?.status || customerDraft?.status || "new_lead";
  const selectedNotes = customerDraft?.notes || "";
  const activeCustomerChatJid = selectedConversation?.chatJid || customerDraft?.chat_jid || null;

  const customerPanelProps: CustomerPanelProps | null = activeCustomerPhone
    ? {
        contactName: selectedConversation?.contactName || customerDraft?.contact_name || null,
        about: customerDraft?.about || null,
        chatJid: activeCustomerChatJid,
        incomingCount: customerDraft?.incoming_count,
        lastDirection: customerDraft?.last_direction || null,
        lastMessageAt: customerDraft?.last_message_at || null,
        lastMessagePreview: customerDraft?.last_message_preview || null,
        loading: loadingCustomer,
        notes: selectedNotes,
        outgoingCount: customerDraft?.outgoing_count,
        phone: activeCustomerPhone,
        profilePictureUrl: customerDraft?.profile_picture_url || null,
        saving: savingCustomer,
        status: selectedStatus,
        statusCounts: customerStatusCounts,
        totalMessages: customerDraft?.total_messages,
        onNotesChange: (value) => {
          if (!activeCustomerPhone) {
            return;
          }

          const nextCustomer: Customer = {
            phone: activeCustomerPhone,
            chat_jid: activeCustomerChatJid,
            contact_name: customerDraft?.contact_name || selectedConversation?.contactName || null,
            profile_picture_url: customerDraft?.profile_picture_url || null,
            about: customerDraft?.about || null,
            total_messages: customerDraft?.total_messages,
            incoming_count: customerDraft?.incoming_count,
            outgoing_count: customerDraft?.outgoing_count,
            last_message_at: customerDraft?.last_message_at || null,
            last_message_preview: customerDraft?.last_message_preview || null,
            last_direction: customerDraft?.last_direction || null,
            status: selectedStatus,
            notes: value
          };

          setCustomerDraft(nextCustomer);
          scheduleCustomerSave(nextCustomer);
        }
      }
    : null;

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
    <main className="min-h-screen bg-app px-4 py-4 text-ink sm:py-5 lg:py-6">
      <div className="fixed inset-x-0 top-0 z-40 px-4 pt-2 pb-2 sm:pt-3 lg:pt-4">
        <div className="mx-auto max-w-[1600px]">
          <TopBar
            activeTab={activeDashboardTab}
            disconnectingWhatsApp={disconnectingWhatsApp}
            loadingWhatsApp={loadingWhatsApp}
            onChangeTab={setActiveDashboardTab}
            onDisconnectWhatsApp={handleDisconnectWhatsApp}
            onLogout={handleLogout}
            token={token}
            userEmail={userEmail}
            whatsAppQr={whatsAppQr}
            whatsAppStatus={whatsAppStatus}
          />
        </div>
      </div>

      <div className="mx-auto max-w-[1600px] space-y-4 pt-44 sm:pt-48 lg:pt-28">
        {dashboardError ? <div className="glass-panel border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">{dashboardError}</div> : null}

        {isSalesDashboard ? (
          <div className="space-y-4 xl:grid xl:grid-cols-[minmax(240px,1fr)_minmax(0,3fr)] xl:items-start xl:gap-4 xl:space-y-0 xl:space-x-0">
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
          <div className="space-y-4 xl:grid xl:grid-cols-[minmax(240px,1fr)_minmax(280px,1fr)_minmax(0,2fr)] xl:items-start xl:gap-4 xl:space-y-0 xl:space-x-0">
            <Sidebar
              activeView={activeView}
              activeStatusFilter={activeStatusFilter}
              counts={sidebarCounts}
              onChangeView={setActiveView}
              onStatusFilterChange={setActiveStatusFilter}
              stats={sidebarStats}
            />

            <div className="space-y-4 xl:contents">
              <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(260px,_0.95fr)_minmax(0,_1.55fr)] xl:contents">
                <div className="space-y-4 lg:col-start-1 lg:col-end-2 xl:col-start-2 xl:col-end-3">
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
                          loadMessages(selectedPhone, token, activeCustomerChatJid, true);
                          loadCustomer(selectedPhone, token, activeCustomerChatJid, true);
                          loadCustomerSalesItems(selectedPhone, token, activeCustomerChatJid, true);
                        }
                      }}
                      onSelect={(phone) => {
                        setActiveMessageFilterId(null);
                        setSelectedPhone(phone);
                      }}
                      refreshing={refreshingChats}
                      selectedPhone={selectedPhone}
                      whatsAppConnected={Boolean(whatsAppStatus?.connected)}
                    />
                  ) : (
                    <ContactList
                      activeStatusFilter={activeStatusFilter}
                      contacts={visibleConversations}
                      loading={loadingChats}
                      onRefresh={() => {
                        if (!token) {
                          return;
                        }

                        loadWhatsAppState(true);
                        loadConversations(token, true);

                        if (selectedPhone) {
                          loadCustomer(selectedPhone, token, activeCustomerChatJid, true);
                          loadCustomerSalesItems(selectedPhone, token, activeCustomerChatJid, true);
                        }
                      }}
                      onSelect={(phone, opts) => {
                        setActiveMessageFilterId(null);
                        setSelectedPhone(phone);
                        // Only switch to inbox if focusChatInput is requested (i.e., message icon click)
                        if (opts && opts.focusChatInput) {
                          setActiveDashboardTab("inbox");
                          setActiveView("inbox");
                          setTimeout(() => {
                            const chatInput = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(".chat-input-editor, .chat-input textarea, .chat-input input");
                            if (chatInput) {
                              chatInput.scrollIntoView({ behavior: "smooth", block: "end" });
                              chatInput.focus();
                            }
                          }, 300);
                        }
                      }}
                      refreshing={refreshingChats}
                      selectedPhone={selectedPhone}
                    />
                  )}
                </div>

                <div className="order-2 lg:order-none lg:col-start-2 lg:col-end-3 xl:col-start-3 xl:col-end-4">
                  {activeDashboardTab === "inbox" ? (
                    <ChatWindow
                      contactName={selectedConversation?.contactName || customerDraft?.contact_name || null}
                      customerPanelProps={customerPanelProps}
                      chatJid={selectedConversation?.chatJid || customerDraft?.chat_jid || null}
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
                      phone={activeCustomerPhone}
                      profilePictureUrl={customerDraft?.profile_picture_url || null}
                      salesLeadItems={salesLeadItems}
                      salesLeadStatus={selectedStatus}
                      savingSalesLeadItem={savingSalesLeadItem}
                      sending={sending}
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
    </div>
  </main>
);
}

export default App;
