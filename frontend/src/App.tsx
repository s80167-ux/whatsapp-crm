import { useEffect, useMemo, useState } from "react";
import { ChatList } from "./components/ChatList";
import { ChatWindow } from "./components/ChatWindow";
import type { CustomerPanelProps } from "./components/CustomerPanel";
import { LoginForm } from "./components/LoginForm";
import { Sidebar } from "./components/Sidebar";
import { WhatsAppConnectCard } from "./components/WhatsAppConnectCard";
import { api, CUSTOMER_STATUSES, type Conversation, type Customer, type CustomerStatus, type Message, type WhatsAppQr, type WhatsAppStatus } from "./lib/api";
import { getResolvedPhone } from "./lib/display";
import { supabase } from "./lib/supabase";

type AuthMode = "login" | "register";
type SidebarView = "inbox" | "pipeline" | "broadcast";
const conversationPollMs = 8000;

function App() {
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [token, setToken] = useState("");
  const [userEmail, setUserEmail] = useState("");
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
  const [saveTimer, setSaveTimer] = useState<number | null>(null);
  const [whatsAppStatus, setWhatsAppStatus] = useState<WhatsAppStatus | null>(null);
  const [whatsAppQr, setWhatsAppQr] = useState<WhatsAppQr | null>(null);
  const [loadingWhatsApp, setLoadingWhatsApp] = useState(true);
  const [disconnectingWhatsApp, setDisconnectingWhatsApp] = useState(false);

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
      return;
    }

    loadConversations(token);
  }, [token]);

  useEffect(() => {
    if (!token || !selectedPhone) {
      setMessages([]);
      setCustomerDraft(null);
      return;
    }

    loadMessages(selectedPhone, token);
    loadCustomer(selectedPhone, token);
  }, [selectedPhone, token]);

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

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => getResolvedPhone(conversation.phone, conversation.chatJid) === selectedPhone) || null,
    [conversations, selectedPhone]
  );
  const activeChatJid = selectedConversation?.chatJid || customerDraft?.chat_jid || null;

  const sidebarCounts = useMemo(() => {
    return {
      inbox: conversations.length
    };
  }, [conversations]);

  const visibleConversations = useMemo(() => {
    if (activeStatusFilter) {
      return conversations.filter((conversation) => conversation.status === activeStatusFilter);
    }

    return conversations;
  }, [activeStatusFilter, conversations]);

  const sidebarStats = useMemo(
    () => ({
      statusCounts: {
        new_lead: conversations.filter((conversation) => conversation.status === "new_lead").length,
        interested: conversations.filter((conversation) => conversation.status === "interested").length,
        processing: conversations.filter((conversation) => conversation.status === "processing").length,
        closed_won: conversations.filter((conversation) => conversation.status === "closed_won").length,
        closed_lost: conversations.filter((conversation) => conversation.status === "closed_lost").length
      },
      currentThreadMessages: messages.length,
      activeContact: selectedConversation?.contactName || customerDraft?.contact_name || selectedPhone || "None"
    }),
    [conversations, customerDraft?.contact_name, messages.length, selectedConversation?.contactName, selectedPhone]
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
    if (!selectedPhone || !chatInput.trim() || !token) {
      return;
    }

    const outgoingText = chatInput.trim();
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
    setChatInput("");

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

    const isImage = file.type.startsWith("image/");
    const previewText = caption.trim()
      ? `[${isImage ? "Image" : "Document"}] ${file.name} - ${caption.trim()}`
      : `[${isImage ? "Image" : "Document"}] ${file.name}`;

    const optimisticMessage: Message = {
      id: `temp-attachment-${Date.now()}`,
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
        },
        onStatusChange: (value) => {
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
            status: value as Customer["status"],
            notes: customerDraft?.notes || ""
          };

          setCustomerDraft(nextCustomer);
          updateConversationStatus({
            phone: nextCustomer.phone,
            chatJid: nextCustomer.chat_jid,
            status: nextCustomer.status
          });
          scheduleCustomerSave(nextCustomer, true);
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
    <main className="min-h-screen bg-app px-4 py-6 text-slate-700">
      <div className="mx-auto max-w-[1600px] space-y-4 xl:grid xl:grid-cols-[minmax(240px,1fr)_minmax(280px,1fr)_minmax(0,2fr)] xl:items-start xl:gap-4 xl:space-y-0">
        <Sidebar
          activeView={activeView}
          activeStatusFilter={activeStatusFilter}
          counts={sidebarCounts}
          disconnectingWhatsApp={disconnectingWhatsApp}
          loadingWhatsApp={loadingWhatsApp}
          onChangeView={setActiveView}
          onStatusFilterChange={setActiveStatusFilter}
          onDisconnectWhatsApp={handleDisconnectWhatsApp}
          onLogout={handleLogout}
          stats={sidebarStats}
          token={token}
          userEmail={userEmail}
          whatsAppQr={whatsAppQr}
          whatsAppStatus={whatsAppStatus}
        />

        <div className="space-y-4 xl:contents">
          {dashboardError ? (
            <div className="glass-panel px-4 py-3 text-sm text-rose-500 xl:col-start-2 xl:col-end-4">{dashboardError}</div>
          ) : null}

          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(260px,_0.95fr)_minmax(0,_1.55fr)] xl:contents">
            <div className="space-y-4 lg:col-start-1 lg:col-end-2 xl:col-start-2 xl:col-end-3">
              <ChatList
                activeView={activeView}
                conversations={visibleConversations}
                loading={loadingChats}
                onRefresh={() => {
                  if (!token) {
                    return;
                  }

                  loadWhatsAppState(true);
                  loadConversations(token, true);

                  if (selectedPhone) {
                    loadMessages(selectedPhone, token, true);
                    loadCustomer(selectedPhone, token, true);
                  }
                }}
                onSelect={setSelectedPhone}
                refreshing={refreshingChats}
                selectedPhone={selectedPhone}
                whatsAppConnected={Boolean(whatsAppStatus?.connected)}
              />
            </div>

            <div className="order-2 lg:order-none lg:col-start-2 lg:col-end-3 xl:col-start-3 xl:col-end-4">
              <ChatWindow
                contactName={selectedConversation?.contactName || customerDraft?.contact_name || null}
                customerPanelProps={customerPanelProps}
                chatJid={customerDraft?.chat_jid || selectedConversation?.chatJid || null}
                loading={loadingMessages}
                messageText={chatInput}
                messages={messages}
                onChangeMessage={setChatInput}
                onSendAttachment={handleSendAttachment}
                onSendLocation={handleSendLocation}
                onSend={handleSend}
                phone={selectedPhone}
                profilePictureUrl={customerDraft?.profile_picture_url || null}
                sending={sending}
              />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

export default App;
