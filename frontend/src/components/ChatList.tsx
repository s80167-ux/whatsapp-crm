import { useMemo, useState } from "react";
import type { Conversation } from "../lib/api";
import { getDisplayName } from "../lib/display";

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

    return conversations.filter((conversation) => {
      const matchesQuery =
        conversation.phone.toLowerCase().includes(query.toLowerCase()) ||
        getDisplayName(conversation.contactName, conversation.phone).toLowerCase().includes(query.toLowerCase()) ||
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
    });
  }, [conversations, filter, query]);

  return (
    <section className="glass-panel flex h-full flex-col p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Conversations</p>
          <h3 className="text-xl font-semibold text-ink">Recent chats</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="rounded-full bg-white/70 px-3 py-1 text-xs font-medium text-slate-500 shadow-soft transition hover:bg-white"
            onClick={onRefresh}
            type="button"
          >
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
          <div className="rounded-full bg-white/65 px-3 py-1 text-xs font-medium text-slate-500 shadow-soft">
            {conversations.length}
          </div>
        </div>
      </div>

      <div className="mb-3 space-y-3">
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
              className={`rounded-full px-3 py-1.5 text-xs font-medium capitalize transition ${
                filter === item ? "bg-white text-ink shadow-soft" : "bg-white/45 text-slate-500 hover:bg-white/70"
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
        <div className="flex flex-1 flex-col items-center justify-center rounded-3xl border border-dashed border-white/50 bg-white/25 px-6 text-center text-sm text-slate-500">
          {conversations.length === 0 ? (
            <>
              <p className="font-medium text-slate-600">
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
        <div className="flex-1 space-y-2 overflow-y-auto pr-1">
          {filteredConversations.map((conversation) => {
            const active = selectedPhone === conversation.phone;

            return (
              <button
                key={conversation.phone}
                className={`w-full rounded-[24px] border px-4 py-3 text-left transition ${
                  active
                    ? "border-white/70 bg-white/70 shadow-soft"
                    : "border-white/35 bg-white/25 hover:bg-white/45"
                }`}
                onClick={() => onSelect(conversation.phone)}
                type="button"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">
                      {getDisplayName(conversation.contactName, conversation.phone)}
                    </p>
                    <p className="truncate text-xs text-slate-400">{conversation.phone}</p>
                    <p className="mt-1 truncate text-sm text-slate-500">{conversation.lastMessage}</p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">{formatTimestamp(conversation.timestamp)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
