import { useEffect, useMemo, useState } from "react";
import { ChatList } from "./components/ChatList";
import { ChatWindow } from "./components/ChatWindow";
import { CustomerPanel } from "./components/CustomerPanel";
import { LoginForm } from "./components/LoginForm";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { api, type Conversation, type Customer, type Message, type WhatsAppQr, type WhatsAppStatus } from "./lib/api";
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

        if (current && data.some((item) => item.phone === current)) {
          return current;
        }

        return data[0]?.phone || null;
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
      setWhatsAppQr(qr);
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : "Failed to load WhatsApp state.");
    } finally {
      if (!silent) {
        setLoadingWhatsApp(false);
      }
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
    if (!token) {
      return;
    }

    loadConversations(token);
    loadWhatsAppState();
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
    () => conversations.find((conversation) => conversation.phone === selectedPhone) || null,
    [conversations, selectedPhone]
  );
  const activeChatJid = selectedConversation?.chatJid || customerDraft?.chat_jid || null;

  const sidebarCounts = useMemo(() => {
    const now = Date.now();

    return {
      inbox: conversations.length,
      pipeline: conversations.filter((conversation) => ["hot", "warm"].includes(conversation.status)).length,
      broadcast: conversations.filter((conversation) => now - new Date(conversation.timestamp).getTime() > 24 * 60 * 60 * 1000)
        .length
    };
  }, [conversations]);

  const visibleConversations = useMemo(() => {
    const now = Date.now();

    if (activeView === "pipeline") {
      return conversations.filter((conversation) => ["hot", "warm"].includes(conversation.status));
    }

    if (activeView === "broadcast") {
      return conversations.filter(
        (conversation) => now - new Date(conversation.timestamp).getTime() > 24 * 60 * 60 * 1000
      );
    }

    return conversations;
  }, [activeView, conversations]);

  const responseRate = useMemo(() => {
    if (!conversations.length) {
      return 0;
    }

    const replied = conversations.filter((conversation) => conversation.lastDirection === "outgoing").length;
    return Math.round((replied / conversations.length) * 100);
  }, [conversations]);

  const syncedMessages = useMemo(() => messages.length, [messages]);

  useEffect(() => {
    if (!visibleConversations.length) {
      setSelectedPhone(null);
      return;
    }

    if (selectedPhone && visibleConversations.some((conversation) => conversation.phone === selectedPhone)) {
      return;
    }

    setSelectedPhone(visibleConversations[0].phone);
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

  const selectedStatus = customerDraft?.status || "warm";
  const selectedNotes = customerDraft?.notes || "";

  if (!token) {
    return (
      <main className="min-h-screen bg-app px-4 py-10">
        <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-6xl items-center justify-center">
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
      <div className="mx-auto grid max-w-[1600px] gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
        <Sidebar
          activeView={activeView}
          counts={sidebarCounts}
          loadingWhatsApp={loadingWhatsApp}
          onChangeView={setActiveView}
          onLogout={handleLogout}
          userEmail={userEmail}
          whatsAppQr={whatsAppQr}
          whatsAppStatus={whatsAppStatus}
        />

        <div className="space-y-4">
          <TopBar
            activeContactName={selectedConversation?.contactName || customerDraft?.contact_name || null}
            openChats={visibleConversations.length}
            responseRate={responseRate}
            selectedPhone={selectedConversation?.phone || null}
            syncedMessages={syncedMessages}
          />

          {dashboardError ? (
            <div className="glass-panel px-4 py-3 text-sm text-rose-500">{dashboardError}</div>
          ) : null}

          <div className="grid min-h-[80vh] gap-4 xl:h-[calc(100vh-210px)] xl:min-h-0 xl:grid-cols-[300px_minmax(0,1fr)_340px]">
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

            <ChatWindow
              contactName={selectedConversation?.contactName || customerDraft?.contact_name || null}
              loading={loadingMessages}
              messageText={chatInput}
              messages={messages}
              onChangeMessage={setChatInput}
              onSendAttachment={handleSendAttachment}
              onSendLocation={handleSendLocation}
              onSend={handleSend}
              phone={selectedPhone}
              sending={sending}
            />

            <CustomerPanel
              contactName={selectedConversation?.contactName || customerDraft?.contact_name || null}
              about={customerDraft?.about || null}
              incomingCount={customerDraft?.incoming_count}
              lastDirection={customerDraft?.last_direction || null}
              lastMessageAt={customerDraft?.last_message_at || null}
              lastMessagePreview={customerDraft?.last_message_preview || null}
              loading={loadingCustomer}
              notes={selectedNotes}
              outgoingCount={customerDraft?.outgoing_count}
              profilePictureUrl={customerDraft?.profile_picture_url || null}
              saving={savingCustomer}
              onNotesChange={(value) => {
                if (!selectedPhone) {
                  return;
                }

                const nextCustomer: Customer = {
                  phone: selectedPhone,
                  chat_jid: customerDraft?.chat_jid || selectedConversation?.chatJid || null,
                  contact_name: customerDraft?.contact_name || selectedConversation?.contactName || null,
                  profile_picture_url: customerDraft?.profile_picture_url || null,
                  about: customerDraft?.about || null,
                  total_messages: customerDraft?.total_messages,
                  incoming_count: customerDraft?.incoming_count,
                  outgoing_count: customerDraft?.outgoing_count,
                  last_message_at: customerDraft?.last_message_at || null,
                  last_message_preview: customerDraft?.last_message_preview || null,
                  last_direction: customerDraft?.last_direction || null,
                  status: customerDraft?.status || "warm",
                  notes: value
                };

                setCustomerDraft(nextCustomer);
                scheduleCustomerSave(nextCustomer);
              }}
              onStatusChange={(value) => {
                if (!selectedPhone) {
                  return;
                }

                const nextCustomer: Customer = {
                  phone: selectedPhone,
                  chat_jid: customerDraft?.chat_jid || selectedConversation?.chatJid || null,
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
                scheduleCustomerSave(nextCustomer, true);
              }}
              phone={selectedPhone}
              status={selectedStatus}
              totalMessages={customerDraft?.total_messages}
            />
          </div>
        </div>
      </div>
    </main>
  );
}

export default App;
