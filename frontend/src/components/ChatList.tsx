import { useMemo, useState } from "react";
import type { Conversation } from "../lib/api";
import { getDisplayName, getDisplayPhone, getResolvedPhone, formatPhoneDisplay } from "../lib/display";

type ChatListProps = {
  activeView: "inbox" | "pipeline" | "broadcast";
  conversations: Conversation[];
  onRefresh: () => void;
  selectedPhone: string | null;
  loading: boolean;
  refreshing: boolean;
  whatsAppConnected: boolean;
  onSelect: (phone: string) => void;
};

function formatTimestamp(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function ChatList({
  activeView,
  conversations,
  onRefresh,
  selectedPhone,
  loading,
  refreshing,
  whatsAppConnected,
  onSelect
}: ChatListProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "today" | "recent">("all");

  const filteredConversations = useMemo(() => {
    const now = new Date();

    return conversations
      .filter((conversation) => {
        const resolvedPhone = getResolvedPhone(conversation.phone, conversation.chatJid) || "";
        const matchesQuery =
          resolvedPhone.toLowerCase().includes(query.toLowerCase()) ||
          getDisplayName(conversation.contactName, resolvedPhone).toLowerCase().includes(query.toLowerCase()) ||
          conversation.lastMessage.toLowerCase().includes(query.toLowerCase());

        if (!matchesQuery) {
          return false;
        }

        const timestamp = new Date(conversation.timestamp);

        if (filter === "today") {
          return timestamp.toDateString() === now.toDateString();
        }

        if (filter === "recent") {
          return now.getTime() - timestamp.getTime() <= 24 * 60 * 60 * 1000;
        }

        return true;
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [conversations, filter, query]);

  return (
    <section className="glass-panel flex min-h-[220px] flex-col p-3 sm:min-h-[420px] sm:p-4">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="hidden text-xs uppercase tracking-[0.25em] text-whatsapp-muted md:block">Conversations</p>
          <h3 className="text-sm font-semibold leading-5 text-ink sm:text-xl">Recent chats</h3>
        </div>
        <div className="flex items-center justify-between gap-1 sm:justify-end sm:gap-2">
          <button
            className="hidden rounded-full border border-whatsapp-line bg-whatsapp-soft px-3 py-1 text-xs font-medium text-whatsapp-deep shadow-soft transition hover:bg-white sm:inline-flex"
            onClick={onRefresh}
            type="button"
          >
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
          <button
            className="inline-flex rounded-full border border-whatsapp-line bg-whatsapp-soft px-2 py-1 text-[10px] font-medium text-whatsapp-deep shadow-soft transition hover:bg-white sm:hidden"
            onClick={onRefresh}
            type="button"
          >
            Sync
          </button>
          <div className="shrink-0 rounded-full border border-whatsapp-line bg-white px-2 py-1 text-[10px] font-medium text-whatsapp-muted shadow-soft sm:px-3 sm:text-xs">
            {conversations.length}
          </div>
        </div>
      </div>

      <div className="mb-3 hidden space-y-3 md:block">
        <input
          className="input-glass"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search phone or message..."
          value={query}
        />
        <div className="flex gap-2">
          {(["all", "today", "recent"] as const).map((item) => (
            <button
              key={item}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold capitalize transition-all duration-200 ${
                filter === item ? "bg-whatsapp-dark text-white shadow-soft" : "border border-whatsapp-line bg-white text-whatsapp-muted hover:bg-whatsapp-soft"
              }`}
              onClick={() => setFilter(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-whatsapp-muted">Loading chats...</div>
      ) : filteredConversations.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-3xl border border-dashed border-whatsapp-line bg-whatsapp-canvas px-6 text-center text-sm text-whatsapp-muted">
          {conversations.length === 0 ? (
            <>
              <p className="font-medium text-ink">
                {whatsAppConnected
                  ? activeView === "inbox"
                    ? "WhatsApp is connected, but no chats have been synced yet."
                    : `No conversations match the ${activeView} view yet.`
                  : "Connect WhatsApp first to start syncing conversations."}
              </p>
              <p className="mt-2 max-w-xs">
                {whatsAppConnected
                  ? "Send or receive one WhatsApp message, then press Refresh to pull it into the dashboard."
                  : "Use the connection card above to link your device and keep this page open while the session starts."}
              </p>
            </>
          ) : (
            <p>No conversations match your current search or filter.</p>
          )}
        </div>
      ) : (
        <div className="flex flex-col space-y-2 pr-1">
          {filteredConversations.map((conversation) => {
            const resolvedPhone = getResolvedPhone(conversation.phone, conversation.chatJid);
            const displayPhone = getDisplayPhone(conversation.phone, conversation.chatJid);
            const active = selectedPhone === resolvedPhone;

            return (
              <button
                key={conversation.chatJid || resolvedPhone || conversation.timestamp}
                className={`group relative w-full max-w-full min-w-0 overflow-hidden rounded-lg border px-3 py-3 text-left transition-all duration-300 sm:px-4 sm:py-3 ${
                  active
                    ? "border-transparent bg-[#e9edef] shadow-none"
                    : "border-transparent bg-white hover:bg-[#f5f6f6] shadow-none"
                }`}
                disabled={!resolvedPhone}
                onClick={() => {
                  if (resolvedPhone) {
                    onSelect(resolvedPhone);
                  }
                }}
                type="button"
              >
                <div className="min-w-0 flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                       <p className={`truncate text-sm font-bold leading-5 transition-colors sm:text-sm ${active ? "text-whatsapp-deep" : "text-ink group-hover:text-whatsapp-deep"}`}>
                        {getDisplayName(conversation.contactName, displayPhone)}
                      </p>
                      <div className="flex items-center gap-2">
                        {conversation.status && (
                          <div
                            className={`icon-hover-trigger chat-status-dot h-3 w-3 shrink-0 shadow-sm transition-transform hover:scale-110 active:scale-95 ${
                              conversation.status === "new_lead"
                                ? "chat-status-dot-new-lead"
                                : conversation.status === "interested"
                                ? "chat-status-dot-interested"
                                : conversation.status === "processing"
                                ? "chat-status-dot-processing"
                                : conversation.status === "closed_won"
                                ? "chat-status-dot-closed-won"
                                : "chat-status-dot-closed-lost"
                            }`}
                          >
                            <span className="icon-hover-label">
                              {`Status: ${
                                conversation.status.charAt(0).toUpperCase() +
                                conversation.status.slice(1).replace(/_/g, " ")
                              }`}
                            </span>
                          </div>
                        )}
                        {conversation.unreadCount && conversation.unreadCount > 0 ? (
                          <span
                            className="icon-hover-trigger chat-unread-badge flex h-5 min-w-[20px] items-center justify-center bg-blue-500 px-1 text-[10px] font-bold text-white shadow-sm"
                          >
                            {conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}
                            <span className="icon-hover-label">
                              {`${conversation.unreadCount} unread message${conversation.unreadCount === 1 ? "" : "s"}`}
                            </span>
                          </span>
                        ) : null}
                        <span className={`shrink-0 text-[10px] font-medium transition-colors sm:text-[10px] ${active ? "text-whatsapp-dark" : "text-whatsapp-muted"}`}>{formatTimestamp(conversation.timestamp)}</span>
                      </div>
                    </div>
                    <p className={`mt-0.5 truncate text-[11px] font-medium transition-colors sm:text-[11px] ${active ? "text-whatsapp-dark/80" : "text-whatsapp-muted"}`}>
                      {formatPhoneDisplay(conversation.phone, conversation.chatJid)}
                    </p>
                    <p className={`mt-1.5 hidden truncate text-xs leading-4 transition-colors md:block ${active ? "text-ink/80" : "text-whatsapp-muted group-hover:text-ink/80"}`}>
                      {conversation.lastMessage}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
