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
    <section className="glass-panel flex min-h-[420px] flex-col border border-white/70 bg-white/58 p-3 sm:p-4 xl:max-h-[calc(100dvh-210px)]">
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
                filter === item ? "bg-emerald-500 text-white shadow-soft" : "bg-white/50 text-emerald-900/65 hover:bg-white/80"
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
        <div className="flex-1 space-y-2 overflow-y-auto pr-1">
          {filteredConversations.map((conversation) => {
            const active = selectedPhone === conversation.phone;

            return (
              <button
                key={conversation.phone}
                className={`w-full rounded-[20px] border px-2 py-2 text-left transition sm:rounded-[24px] sm:px-4 sm:py-3 ${
                  active
                    ? "border-emerald-200 bg-emerald-50/88 shadow-soft"
                    : "border-white/45 bg-white/35 hover:bg-white/60"
                }`}
                onClick={() => onSelect(conversation.phone)}
                type="button"
              >
                <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                  <div className="min-w-0">
                    <p className="break-words text-[11px] font-semibold leading-4 text-ink sm:text-sm sm:leading-5">
                      {getDisplayName(conversation.contactName, conversation.phone)}
                    </p>
                    <p className="mt-1 break-all text-[10px] text-emerald-900/45 sm:text-xs">{conversation.phone}</p>
                    <p className="mt-1 hidden break-words text-sm leading-5 text-emerald-950/62 md:block">
                      {conversation.lastMessage}
                    </p>
                  </div>
                  <span className="text-[10px] text-emerald-900/45 sm:shrink-0 sm:text-xs">{formatTimestamp(conversation.timestamp)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
