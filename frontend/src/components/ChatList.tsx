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
    <section className="glass-panel flex min-h-[220px] flex-col border border-white/70 bg-white/58 p-3 sm:min-h-[420px] sm:p-4">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="hidden text-xs uppercase tracking-[0.25em] text-emerald-800/65 md:block">Conversations</p>
          <h3 className="text-sm font-semibold leading-5 text-ink sm:text-xl">Recent chats</h3>
        </div>
        <div className="flex items-center justify-between gap-1 sm:justify-end sm:gap-2">
          <button
            className="hidden rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-900 shadow-soft transition hover:bg-white sm:inline-flex"
            onClick={onRefresh}
            type="button"
          >
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
          <button
            className="inline-flex rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-900 shadow-soft transition hover:bg-white sm:hidden"
            onClick={onRefresh}
            type="button"
          >
            Sync
          </button>
          <div className="shrink-0 rounded-full bg-emerald-950/6 px-2 py-1 text-[10px] font-medium text-emerald-900/65 shadow-soft sm:px-3 sm:text-xs">
            {conversations.length}
          </div>
        </div>
      </div>

      <div className="mb-3 hidden space-y-3 md:block">
        <input
          className="input-glass border-emerald-950/20 bg-white/70 focus:bg-white focus:ring-emerald-500/20"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search phone or message..."
          value={query}
        />
        <div className="flex gap-2">
          {(["all", "today", "recent"] as const).map((item) => (
            <button
              key={item}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold capitalize transition-all duration-200 ${
                filter === item ? "bg-emerald-600 text-white shadow-soft" : "bg-emerald-950/10 text-emerald-950/60 hover:bg-emerald-950/20"
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
        <div className="flex flex-1 items-center justify-center text-sm text-slate-500">Loading chats...</div>
      ) : filteredConversations.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-3xl border border-dashed border-emerald-200 bg-white/35 px-6 text-center text-sm text-emerald-950/60">
          {conversations.length === 0 ? (
            <>
              <p className="font-medium text-emerald-950/78">
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
                className={`group relative w-full max-w-full min-w-0 overflow-hidden rounded-[20px] border px-3 py-3 text-left transition-all duration-300 sm:rounded-[24px] sm:px-4 sm:py-3 ${
                  active
                    ? "border-emerald-400/50 bg-white shadow-glass translate-y-[-1px]"
                    : "border-white/70 bg-white/45 hover:bg-white/95 shadow-sm hover:shadow-soft"
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
                       <p className={`truncate text-sm font-bold leading-5 transition-colors sm:text-sm ${active ? "text-emerald-950" : "text-ink group-hover:text-emerald-950"}`} title={getDisplayName(conversation.contactName, displayPhone)}>
                        {getDisplayName(conversation.contactName, displayPhone)}
                      </p>
                      <div className="flex items-center gap-2">
                        {conversation.status && (
                          <div
                            className="h-3 w-3 shrink-0 shadow-sm transition-transform hover:scale-110 active:scale-95"
                            style={{
                              borderRadius: "9999px",
                              outline: "2px solid rgba(255,255,255,0.5)",
                              outlineOffset: "1px",
                              backgroundColor:
                                conversation.status === "new_lead"
                                  ? "#fbbf24"
                                  : conversation.status === "interested"
                                  ? "#22c55e"
                                  : conversation.status === "processing"
                                  ? "#38bdf8"
                                  : conversation.status === "closed_won"
                                  ? "#1e40af"
                                  : "#ef4444"
                            }}
                            title={`Status: ${
                              conversation.status.charAt(0).toUpperCase() +
                              conversation.status.slice(1).replace(/_/g, " ")
                            }`}
                          />
                        )}
                        {conversation.unreadCount && conversation.unreadCount > 0 ? (
                          <span
                            className="flex h-5 min-w-[20px] items-center justify-center bg-blue-500 px-1 text-[10px] font-bold text-white shadow-sm"
                            style={{ borderRadius: "9999px", outline: "2px solid rgba(255,255,255,0.5)", outlineOffset: "1px" }}
                            title={`${conversation.unreadCount} unread message${conversation.unreadCount === 1 ? "" : "s"}`}
                          >
                            {conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}
                          </span>
                        ) : null}
                        <span className={`shrink-0 text-[10px] font-medium transition-colors sm:text-[10px] ${active ? "text-emerald-600" : "text-emerald-900/40"}`}>{formatTimestamp(conversation.timestamp)}</span>
                      </div>
                    </div>
                    <p className={`mt-0.5 truncate text-[11px] font-medium transition-colors sm:text-[11px] ${active ? "text-emerald-700/60" : "text-emerald-900/45"}`} title={formatPhoneDisplay(conversation.phone, conversation.chatJid)}>
                      {formatPhoneDisplay(conversation.phone, conversation.chatJid)}
                    </p>
                    <p className={`mt-1.5 hidden truncate text-xs leading-4 transition-colors md:block ${active ? "text-emerald-950/70" : "text-emerald-950/50 group-hover:text-emerald-950/70"}`} title={conversation.lastMessage}>
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
