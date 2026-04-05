import { useEffect, useMemo, useState } from "react";
import { ChatList } from "./components/ChatList";
import { ChatWindow } from "./components/ChatWindow";
import { ContactList } from "./components/ContactList";
import { CustomerPanel } from "./components/CustomerPanel";
import type { CustomerPanelProps } from "./components/CustomerPanel";
import { LoginForm } from "./components/LoginForm";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { api, CUSTOMER_STATUSES, type Conversation, type Customer, type CustomerStatus, type Message, type SalesLeadItem, type WhatsAppQr, type WhatsAppStatus } from "./lib/api";
import { getResolvedPhone } from "./lib/display";
import { supabase } from "./lib/supabase";

type AuthMode = "login" | "register";
type DashboardTab = "inbox" | "contacts";
type SidebarView = "inbox" | "pipeline" | "broadcast";
const conversationPollMs = 8000;

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("Failed to read attachment preview."));
    reader.readAsDataURL(file);
  });
}

function getAttachmentMediaType(file: File) {
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
  const label = mediaType === "image" ? "Image" : mediaType === "video" ? "Video" : "Document";
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
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [token, setToken] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [activeDashboardTab, setActiveDashboardTab] = useState<DashboardTab>("inbox");
  const [activeView, setActiveView] = useState<SidebarView>("inbox");
  const [activeStatusFilter, setActiveStatusFilter] = useState<CustomerStatus | null>(null);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
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
  const [loadingSalesLeadItems, setLoadingSalesLeadItems] = useState(false);
  const [savingSalesLeadItem, setSavingSalesLeadItem] = useState(false);
  const [customerPanelCollapsed, setCustomerPanelCollapsed] = useState(false);
  const [saveTimer, setSaveTimer] = useState<number | null>(null);
  const [whatsAppStatus, setWhatsAppStatus] = useState<WhatsAppStatus | null>(null);
  const [whatsAppQr, setWhatsAppQr] = useState<WhatsAppQr | null>(null);
  const [connectedWhatsAppPhone, setConnectedWhatsAppPhone] = useState<string | null>(null);
  const [loadingWhatsApp, setLoadingWhatsApp] = useState(true);
  const [disconnectingWhatsApp, setDisconnectingWhatsApp] = useState(false);
  const [deletingConversationKey, setDeletingConversationKey] = useState<string | null>(null);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);

  useEffect(() => {
    setCustomerPanelCollapsed(false);
  }, [selectedPhone, activeDashboardTab]);

  function updateConversationStatus(params: {
    phone?: string | null;
    chatJid?: string | null;
    status: CustomerStatus;
  }) {
    const targetResolvedPhone = getResolvedPhone(params.phone, params.chatJid);
    const targetChatJid = String(params.chatJid || "").trim() || null;

    setConversations((current) =>
      current.map((conversation) => {
        const conversationResolvedPhone = getResolvedPhone(conversation.phone, conversation.chatJid);
        const matchesPhone = Boolean(targetResolvedPhone && conversationResolvedPhone === targetResolvedPhone);
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
    const targetResolvedPhone = getResolvedPhone(params.phone, params.chatJid);
    const targetChatJid = String(params.chatJid || "").trim() || null;

    setConversations((current) =>
      current.map((conversation) => {
        const conversationResolvedPhone = getResolvedPhone(conversation.phone, conversation.chatJid);
        const matchesPhone = Boolean(targetResolvedPhone && conversationResolvedPhone === targetResolvedPhone);
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

        if (current && data.some((item) => getResolvedPhone(item.phone, item.chatJid) === current)) {
          return current;
        }

        return getResolvedPhone(data[0]?.phone, data[0]?.chatJid) || null;
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

  async function loadMessages(phone: string, activeToken: string, silent = false) {
    if (!silent) {
      setLoadingMessages(true);
    }

    try {
      const data = await api.getMessages(phone, activeToken);
      setMessages(data);
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : "Failed to load messages.");
    } finally {
      if (!silent) {
        setLoadingMessages(false);
      }
    }
  }

  async function loadCustomer(phone: string, activeToken: string, silent = false) {
    if (!silent) {
      setLoadingCustomer(true);
    }

    try {
      const data = await api.getCustomer(phone, activeToken);
      setCustomerDraft(data);
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

  async function handleDeleteConversation(phone: string, chatJid?: string | null) {
    if (!token) {
      return;
    }

    const resolvedPhone = getResolvedPhone(phone, chatJid);
    const conversationKey = String(chatJid || resolvedPhone || phone || "").trim() || null;

    setDeletingConversationKey(conversationKey);
    setDashboardError("");

    try {
      await api.deleteConversation(phone, token, chatJid);

      setConversations((current) =>
        current.filter((conversation) => {
          const conversationResolvedPhone = getResolvedPhone(conversation.phone, conversation.chatJid);
          const matchesPhone = Boolean(resolvedPhone && conversationResolvedPhone === resolvedPhone);
          const matchesChatJid = Boolean(chatJid && conversation.chatJid === chatJid);

          return !matchesPhone && !matchesChatJid;
        })
      );

      if (selectedPhone && resolvedPhone && selectedPhone === resolvedPhone) {
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

    const targetPhone = getResolvedPhone(message.phone, message.chat_jid) || message.phone;
    const targetChatJid = message.chat_jid || activeChatJid || null;

    setDeletingMessageId(message.id);
    setDashboardError("");

    try {
      await api.deleteMessage(message.id, token);

      setMessages((current) => current.filter((item) => item.id !== message.id));

      await loadConversations(token, true);

      if (selectedPhone && selectedPhone === targetPhone) {
        await Promise.allSettled([
          loadMessages(targetPhone, token, true),
          loadCustomer(targetPhone, token, true),
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

      if (payload.status !== selectedStatus) {
        const savedCustomer = await api.saveCustomer(
          selectedPhone,
          {
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
      }
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : "Failed to save sales lead item.");
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

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) {
        return;
      }

      setToken(data.session?.access_token || "");
      setUserEmail(data.session?.user.email || "");
      setAuthReady(true);
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setToken(session?.access_token || "");
      setUserEmail(session?.user.email || "");
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
    if (!token) {
      setConnectedWhatsAppPhone(null);
      return;
    }

    loadWhatsAppState(true);
    loadConversations(token);
  }, [token]);

  useEffect(() => {
    if (!token || !selectedPhone) {
      setMessages([]);
      setCustomerDraft(null);
      setSalesLeadItems([]);
      return;
    }

    loadMessages(selectedPhone, token);
    loadCustomer(selectedPhone, token);
    loadCustomerSalesItems(selectedPhone, token, customerDraft?.chat_jid || null);
  }, [customerDraft?.chat_jid, selectedPhone, token]);

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
    if (!token) {
      return;
    }

    const interval = window.setInterval(() => {
      loadWhatsAppState(true);
      loadConversations(token, true);

      if (selectedPhone) {
        loadMessages(selectedPhone, token, true);
        loadCustomer(selectedPhone, token, true);
        loadCustomerSalesItems(selectedPhone, token, customerDraft?.chat_jid || null, true);
      }
    }, conversationPollMs);

    return () => {
      window.clearInterval(interval);
    };
  }, [selectedPhone, token]);

  useEffect(() => {
    return () => {
      if (saveTimer) {
        window.clearTimeout(saveTimer);
      }
    };
  }, [saveTimer]);

  const leadConversations = useMemo(() => {
    if (!connectedWhatsAppPhone) {
      return conversations;
    }

    return conversations.filter((conversation) => normalizePhoneValue(conversation.phone) !== connectedWhatsAppPhone);
  }, [connectedWhatsAppPhone, conversations]);

  const selectedConversation = useMemo(
    () => leadConversations.find((conversation) => getResolvedPhone(conversation.phone, conversation.chatJid) === selectedPhone) || null,
    [leadConversations, selectedPhone]
  );
  const activeChatJid = selectedConversation?.chatJid || customerDraft?.chat_jid || null;

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
      return leadConversations.filter((conversation) => conversation.status === activeStatusFilter);
    }

    return leadConversations;
  }, [activeStatusFilter, leadConversations]);

  const sidebarStats = useMemo(
    () => ({
      statusCounts: {
        new_lead: leadConversations.filter((conversation) => conversation.status === "new_lead").length,
        interested: leadConversations.filter((conversation) => conversation.status === "interested").length,
        processing: leadConversations.filter((conversation) => conversation.status === "processing").length,
        closed_won: leadConversations.filter((conversation) => conversation.status === "closed_won").length,
        closed_lost: leadConversations.filter((conversation) => conversation.status === "closed_lost").length
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
      visibleConversations.some((conversation) => getResolvedPhone(conversation.phone, conversation.chatJid) === selectedPhone)
    ) {
      return;
    }

    setSelectedPhone(getResolvedPhone(visibleConversations[0].phone, visibleConversations[0].chatJid));
  }, [selectedPhone, visibleConversations]);

  async function handleAuthSubmit() {
    setAuthLoading(true);
    setAuthError("");

    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password
        });

        if (error) {
          throw error;
        }
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password
        });

        if (error) {
          throw error;
        }

        if (!data.session) {
          setAuthError("Account created. Confirm your email in Supabase before logging in.");
        }
      }

      setPassword("");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setAuthLoading(false);
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
    }
    await supabase.auth.signOut();
    setToken("");
    setUserEmail("");
    setConversations([]);
    setSelectedPhone(null);
    setMessages([]);
    setCustomerDraft(null);
    setSalesLeadItems([]);
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

  const selectedStatus = customerDraft?.status || "new_lead";
  const selectedNotes = customerDraft?.notes || "";
  const activeCustomerChatJid = customerDraft?.chat_jid || selectedConversation?.chatJid || null;

  const customerPanelProps: CustomerPanelProps | null = selectedPhone
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
        phone: selectedPhone,
        profilePictureUrl: customerDraft?.profile_picture_url || null,
        saving: savingCustomer,
        status: selectedStatus,
        statusCounts: sidebarStats.statusCounts,
        totalMessages: customerDraft?.total_messages,
        onNotesChange: (value) => {
          if (!selectedPhone) {
            return;
          }

          const nextCustomer: Customer = {
            phone: selectedPhone,
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
            status: customerDraft?.status || "new_lead",
            notes: value
          };

          setCustomerDraft(nextCustomer);
          scheduleCustomerSave(nextCustomer);
        }
      }
    : null;

  if (!token) {
    return (
      <main className="min-h-screen bg-app px-4 py-10">
        <div className="mx-auto flex min-h-[calc(100dvh-5rem)] max-w-6xl items-center justify-center">
          <LoginForm
            authReady={authReady}
            email={email}
            error={authError}
            loading={authLoading}
            mode={mode}
            onEmailChange={setEmail}
            onModeChange={setMode}
            onPasswordChange={setPassword}
            onSubmit={handleAuthSubmit}
            password={password}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-app px-4 py-6 text-ink">
      <div className="mx-auto max-w-[1600px] space-y-4">
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
          {dashboardError ? (
            <div className="glass-panel border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600 xl:col-start-2 xl:col-end-4">{dashboardError}</div>
          ) : null}

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
                      loadMessages(selectedPhone, token, true);
                      loadCustomer(selectedPhone, token, true);
                      loadCustomerSalesItems(selectedPhone, token, customerDraft?.chat_jid || null, true);
                    }
                  }}
                  onSelect={(phone) => {
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
                      loadCustomer(selectedPhone, token, true);
                      loadCustomerSalesItems(selectedPhone, token, customerDraft?.chat_jid || null, true);
                    }
                  }}
                  onSelect={(phone) => {
                    setSelectedPhone(phone);
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
                  chatJid={customerDraft?.chat_jid || selectedConversation?.chatJid || null}
                  deletingMessageId={deletingMessageId}
                  loading={loadingMessages}
                  loadingSalesLeadItems={loadingSalesLeadItems}
                  messageText={chatInput}
                  messages={messages}
                  onChangeMessage={setChatInput}
                  onCreateSalesLeadItem={handleCreateSalesLeadItem}
                  onDeleteMessage={handleDeleteMessage}
                  onSendAttachment={handleSendAttachment}
                  onSendLocation={handleSendLocation}
                  onSend={handleSend}
                  onSendQuickReply={sendTextMessage}
                  phone={selectedPhone}
                  profilePictureUrl={customerDraft?.profile_picture_url || null}
                  salesLeadItems={salesLeadItems}
                  salesLeadStatus={selectedStatus}
                  savingSalesLeadItem={savingSalesLeadItem}
                  sending={sending}
                />
              ) : customerPanelProps ? (
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
    </div>
  </main>
);
}

export default App;
