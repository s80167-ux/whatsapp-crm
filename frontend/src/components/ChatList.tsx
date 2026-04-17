import { useEffect, useMemo, useState } from "react";
import { CUSTOMER_STATUS_LABELS, type Conversation, type CustomerStatus, type WhatsAppAccount } from "../lib/api";
import { getConversationIdentifier, getConversationSortTimestamp, getDisplayName, getDisplayPhone, getResolvedPhone, formatPhoneDisplay } from "../lib/display";

const STATUS_ORDER: CustomerStatus[] = ["new_lead", "interested", "processing", "closed_won", "closed_lost"];
const CONVERSATIONS_PAGE_SIZE = 10;

function getStatusDotClass(status: CustomerStatus) {
  switch (status) {
    case "new_lead":
      return "chat-status-dot-new-lead";
    case "interested":
      return "chat-status-dot-interested";
    case "processing":
      return "chat-status-dot-processing";
    case "closed_won":
      return "chat-status-dot-closed-won";
    case "closed_lost":
      return "chat-status-dot-closed-lost";
    default:
      return "";
  }
}

type ChatListProps = {
  activeView: "inbox" | "pipeline" | "broadcast";
  conversations: Conversation[];
  deletingConversationKey: string | null;
  onRefresh: () => void;
  onDeleteConversation: (phone: string, chatJid?: string | null) => void;
  selectedPhone: string | null;
  selectedChatJid?: string | null;
  loading: boolean;
  onSelectWhatsAppAccount: (accountId: string) => void;
  refreshing: boolean;
  selectedWhatsAppAccountId: string | null;
  whatsAppAccounts: WhatsAppAccount[];
  whatsAppConnected: boolean;
  onSelect: (conversationId: string, chatJid?: string | null) => void;
};

function formatTimestamp(value?: string | number | null) {
  if (value === null || value === undefined) return "";

  if (typeof value === "number") {
    const date = new Date(value < 1e12 ? value * 1000 : value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  const normalized = String(value).trim();
  if (!normalized) return "";

  const directDate = new Date(normalized);
  if (!Number.isNaN(directDate.getTime())) {
    return directDate.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  const numeric = Number(normalized);
  if (Number.isFinite(numeric) && numeric > 0) {
    const numericDate = new Date(numeric < 1e12 ? numeric * 1000 : numeric);
    if (!Number.isNaN(numericDate.getTime())) {
      return numericDate.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      });
    }
  }

  return "";
}

function formatAccountPhone(value: string | null | undefined) {
  if (!value) {
    return "Awaiting number";
  }

  return value.startsWith("+") ? value : `+${value}`;
}

function formatAccountState(value: string | null | undefined) {
  const normalized = String(value || "disconnected").trim().toLowerCase();

  switch (normalized) {
    case "open":
      return "Connected";
    case "connecting":
      return "Connecting";
    case "qr":
      return "Awaiting QR";
    case "reconnect_failed":
      return "Reconnect Paused";
    case "disconnecting":
      return "Disconnecting";
    default:
      return "Offline";
  }
}

function getAccountStateBadgeClasses(value: string | null | undefined) {
  const normalized = String(value || "disconnected").trim().toLowerCase();

  switch (normalized) {
    case "open":
      return "bg-emerald-100 text-emerald-700";
    case "connecting":
      return "bg-amber-100 text-amber-700";
    case "qr":
      return "bg-sky-100 text-sky-700";
    case "reconnect_failed":
      return "bg-rose-100 text-rose-700";
    case "disconnecting":
      return "bg-orange-100 text-orange-700";
    default:
      return "bg-slate-200 text-slate-700";
  }
}

function getConversationSourceLabel(conversation: Conversation) {
  return conversation.sourceDisplayName || conversation.sourceAccountPhone || "Historical source";
}

function normalizeSearchValue(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function compareConversationAlphabetically(left: Conversation, right: Conversation) {
  const leftDisplayPhone = getDisplayPhone(left.phone, left.chatJid) || getResolvedPhone(left.phone, left.chatJid) || "";
  const rightDisplayPhone = getDisplayPhone(right.phone, right.chatJid) || getResolvedPhone(right.phone, right.chatJid) || "";
  const leftLabel = normalizeSearchValue(getDisplayName(left.contactName, leftDisplayPhone));
  const rightLabel = normalizeSearchValue(getDisplayName(right.contactName, rightDisplayPhone));

  return leftLabel.localeCompare(rightLabel, undefined, { sensitivity: "base", numeric: true });
}

export function ChatList({
  activeView,
  conversations,
  deletingConversationKey,
  onRefresh,
  onDeleteConversation,
  selectedPhone,
  selectedChatJid,
  loading,
  onSelectWhatsAppAccount,
  refreshing,
  selectedWhatsAppAccountId,
  whatsAppAccounts,
  whatsAppConnected,
  onSelect
}: ChatListProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "today" | "recent">("all");
  const [sortField, setSortField] = useState<"timestamp" | "alphabet">("timestamp");
  const [sortOrder, setSortOrder] = useState<"latest" | "oldest" | "asc" | "desc">("latest");
  const [page, setPage] = useState(1);
  const visibleWhatsAppAccounts = useMemo(
    () =>
      [...whatsAppAccounts].sort(
        (left, right) => new Date(right.updated_at || 0).getTime() - new Date(left.updated_at || 0).getTime()
      ),
    [whatsAppAccounts]
  );
  const selectedAccount =
    visibleWhatsAppAccounts.find((account) => account.id === selectedWhatsAppAccountId) ||
    visibleWhatsAppAccounts[0] ||
    null;
  const selectedAccountLabel = selectedAccount?.display_name || selectedAccount?.account_phone || "WhatsApp account";
  const selectedAccountPhone = formatAccountPhone(selectedAccount?.account_phone);
  const selectedAccountState = formatAccountState(selectedAccount?.connection_state);

  const filteredConversations = useMemo(() => {
    const now = new Date();
    const normalizedQuery = normalizeSearchValue(query);

    return conversations
      .filter((conversation) => {
        const resolvedPhone = getResolvedPhone(conversation.phone, conversation.chatJid) || "";
        const conversationId = getConversationIdentifier(conversation.phone, conversation.chatJid) || "";
        const displayPhone = getDisplayPhone(conversation.phone, conversation.chatJid) || "";
        const searchableFields = [
          resolvedPhone,
          displayPhone,
          conversationId,
          conversation.chatJid,
          getDisplayName(conversation.contactName, displayPhone || resolvedPhone),
          conversation.lastMessage,
          getConversationSourceLabel(conversation)
        ]
          .map((value) => normalizeSearchValue(value))
          .filter(Boolean);
        const matchesQuery =
          !normalizedQuery || searchableFields.some((value) => value.includes(normalizedQuery));

        if (!matchesQuery) {
          return false;
        }

        const timestampValue = getConversationSortTimestamp(conversation);
        const timestamp = new Date(timestampValue);
        if (Number.isNaN(timestamp.getTime())) {
          return filter === "all";
        }

        if (filter === "today") {
          return timestamp.toDateString() === now.toDateString();
        }

        if (filter === "recent") {
          return now.getTime() - timestamp.getTime() <= 24 * 60 * 60 * 1000;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortField === "alphabet") {
          const alphabeticalComparison = compareConversationAlphabetically(a, b);
          return sortOrder === "desc" ? alphabeticalComparison * -1 : alphabeticalComparison;
        }

        const leftTimestamp = new Date(getConversationSortTimestamp(a)).getTime();
        const rightTimestamp = new Date(getConversationSortTimestamp(b)).getTime();
        const safeLeftTimestamp = Number.isNaN(leftTimestamp) ? 0 : leftTimestamp;
        const safeRightTimestamp = Number.isNaN(rightTimestamp) ? 0 : rightTimestamp;
        return sortOrder === "oldest" ? safeLeftTimestamp - safeRightTimestamp : safeRightTimestamp - safeLeftTimestamp;
      });
  }, [conversations, filter, query, sortField, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(filteredConversations.length / CONVERSATIONS_PAGE_SIZE));
  const paginatedConversations = filteredConversations.slice((page - 1) * CONVERSATIONS_PAGE_SIZE, page * CONVERSATIONS_PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [filter, query, selectedWhatsAppAccountId, sortOrder]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  return (
    <section className="glass-panel flex h-full min-h-[220px] flex-col overflow-hidden p-3 sm:min-h-[420px] sm:p-4 xl:h-[calc(100dvh-24px)] xl:min-h-[calc(100dvh-24px)]">
      <div className="sticky top-0 z-10 -mx-3 -mt-3 mb-3 border-b border-white/60 bg-[rgba(248,249,250,0.94)] px-3 py-3 backdrop-blur sm:-mx-4 sm:-mt-4 sm:px-4 sm:py-4">
        <div className="mb-3 rounded-[22px] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.98),rgba(243,247,246,0.92))] p-3 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.2em] text-whatsapp-muted">Send replies with</p>
              <div className="mt-1 flex items-center gap-2">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-[#e7f5ee] text-[#0f8f63] shadow-sm">
                  <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v9c0 1.1-.9 2-2 2H8l-4 4V6c0-1.1.9-2 2-2Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold leading-5 text-ink">{selectedAccountLabel}</p>
                  <p className="truncate text-[11px] font-medium text-whatsapp-muted">{selectedAccountPhone}</p>
                </div>
              </div>
            </div>
            <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${getAccountStateBadgeClasses(selectedAccount?.connection_state)}`}>
              {selectedAccountState}
            </span>
          </div>

          <div className="relative mt-3">
            <select
              aria-label="Select WhatsApp account"
              className="w-full appearance-none rounded-2xl border border-white/70 bg-white/92 px-3 py-3 pr-10 text-sm font-medium text-ink outline-none transition focus:border-whatsapp-deep/30"
              onChange={(event) => onSelectWhatsAppAccount(event.target.value)}
              value={selectedWhatsAppAccountId || ""}
            >
              {visibleWhatsAppAccounts.length ? null : <option value="">No WhatsApp accounts yet</option>}
              {visibleWhatsAppAccounts.map((account) => {
                const label = account.display_name || account.account_phone || "WhatsApp account";
                const phone = formatAccountPhone(account.account_phone);
                const state = formatAccountState(account.connection_state);
                return (
                  <option key={account.id} value={account.id}>
                    {`${label} - ${phone} - ${state}`}
                  </option>
                );
              })}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-whatsapp-muted">
              <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16">
                <path d="m6 9 6 6 6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
              </svg>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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

        <div className="mt-3 space-y-3">
          <input
            className="input-glass"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, phone, message..."
            value={query}
          />
          <div className="flex flex-wrap gap-2">
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
            <button
              className="rounded-full border border-whatsapp-line bg-white px-3 py-1.5 text-xs font-semibold text-whatsapp-muted transition-all duration-200 hover:bg-whatsapp-soft"
              onClick={() => {
                setSortField("timestamp");
                setSortOrder((current) => (current === "oldest" ? "latest" : "oldest"));
              }}
              type="button"
            >
              {sortField === "timestamp" && sortOrder === "oldest" ? "Oldest first" : "Latest first"}
            </button>
            <button
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all duration-200 ${
                sortField === "alphabet"
                  ? "bg-whatsapp-dark text-white shadow-soft"
                  : "border border-whatsapp-line bg-white text-whatsapp-muted hover:bg-whatsapp-soft"
              }`}
              onClick={() => {
                setSortField("alphabet");
                setSortOrder((current) => (current === "asc" ? "desc" : "asc"));
              }}
              type="button"
            >
              {sortField === "alphabet" && sortOrder === "desc" ? "Z-A" : "A-Z"}
            </button>
          </div>
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
                  : "No historical chats are available yet."}
              </p>
              <p className="mt-2 max-w-xs">
                {whatsAppConnected
                  ? "Send or receive one WhatsApp message, then press Refresh to pull it into the dashboard."
                  : "Previously synced chats stay here even if a number disconnects. Connect a WhatsApp source when you want to sync new activity."}
              </p>
            </>
          ) : (
            <p>No conversations match your current search or filter.</p>
          )}
        </div>
      ) : (
        <>
          <div className="custom-scrollbar scrollbar-hidden flex min-h-0 flex-1 flex-col space-y-2 overflow-y-auto pr-1">
            {paginatedConversations.map((conversation) => {
              const resolvedPhone = getResolvedPhone(conversation.phone, conversation.chatJid);
              const conversationId = getConversationIdentifier(conversation.phone, conversation.chatJid);
              const displayPhone = getDisplayPhone(conversation.phone, conversation.chatJid);
              const activeStatuses = STATUS_ORDER.filter((status) => (conversation.status_counts?.[status] ?? 0) > 0);
              const active =
                selectedPhone === conversationId &&
                (!selectedChatJid || String(conversation.chatJid || "").trim() === String(selectedChatJid).trim());
              const conversationKey = conversation.chatJid || conversationId || conversation.timestamp;
              const deleting = deletingConversationKey === conversationKey;

              return (
                <div key={conversationKey} className="group relative">
                  <button
                    className={`relative w-full max-w-full min-w-0 overflow-hidden rounded-lg border px-3 py-3 text-left transition-colors duration-200 sm:px-4 sm:py-3 ${
                      active
                        ? "border-transparent bg-[#e9edef] shadow-none"
                        : "border-transparent bg-white hover:bg-[#f5f6f6] shadow-none"
                    }`}
                    disabled={!conversationId || deleting}
                    onClick={() => {
                      if (conversationId) {
                        onSelect(conversationId, conversation.chatJid);
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
                            {activeStatuses.length ? (
                              <div className="flex items-center gap-1">
                                {activeStatuses.map((status) => (
                                  <div
                                    key={status}
                                    className={`icon-hover-trigger chat-status-dot h-3 w-3 shrink-0 shadow-sm transition-transform hover:scale-110 active:scale-95 ${getStatusDotClass(status)}`}
                                  >
                                    <span className="icon-hover-label">{`${CUSTOMER_STATUS_LABELS[status]}: ${conversation.status_counts?.[status] ?? 0}`}</span>
                                  </div>
                                ))}
                              </div>
                            ) : null}
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
                            <button
                              aria-label={deleting ? "Deleting chat" : "Delete chat"}
                              className="icon-hover-trigger flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-whatsapp-muted transition hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-60"
                              disabled={deleting || !conversationId}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();

                                if (!conversationId) {
                                  return;
                                }

                                if (!window.confirm(`Delete chat with ${getDisplayName(conversation.contactName, displayPhone)}? This will remove the conversation from the database.`)) {
                                  return;
                                }

                                onDeleteConversation(conversationId, conversation.chatJid);
                              }}
                              type="button"
                            >
                              {deleting ? (
                                <span className="text-[10px] font-semibold">...</span>
                              ) : (
                                <svg aria-hidden="true" fill="none" height="15" viewBox="0 0 24 24" width="15">
                                  <path d="M3 6h18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                                  <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                                  <path d="M10 11v6M14 11v6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                                </svg>
                              )}
                              <span className="icon-hover-label">{deleting ? "Deleting chat" : "Delete chat"}</span>
                            </button>
                            <span className={`shrink-0 text-[10px] font-medium transition-colors sm:text-[10px] ${active ? "text-whatsapp-dark" : "text-whatsapp-muted"}`}>
                              {formatTimestamp(getConversationSortTimestamp(conversation))}
                            </span>
                          </div>
                        </div>
                        <p className={`mt-0.5 truncate text-[11px] font-medium transition-colors sm:text-[11px] ${active ? "text-whatsapp-dark/80" : "text-whatsapp-muted"}`}>
                          {formatPhoneDisplay(conversation.phone, conversation.chatJid)}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          {conversation.sourceConnectionState ? (
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${getAccountStateBadgeClasses(conversation.sourceConnectionState)}`}>
                              {getConversationSourceLabel(conversation)} - {formatAccountState(conversation.sourceConnectionState)}
                            </span>
                          ) : conversation.sourceAccountPhone || conversation.sourceDisplayName ? (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700">
                              {getConversationSourceLabel(conversation)}
                            </span>
                          ) : (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700">
                              Historical source unavailable
                            </span>
                          )}
                        </div>
                        <p className={`mt-1.5 hidden truncate text-xs leading-4 transition-colors md:block ${active ? "text-ink/80" : "text-whatsapp-muted group-hover:text-ink/80"}`}>
                          {conversation.lastMessage}
                        </p>
                      </div>
                    </div>
                  </button>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex shrink-0 items-center justify-between gap-2 border-t border-white/60 pt-3">
            <button
              className="rounded-full border border-whatsapp-line bg-white px-3 py-1 text-xs font-medium text-whatsapp-muted transition hover:bg-whatsapp-soft disabled:cursor-not-allowed disabled:opacity-50"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              type="button"
            >
              Previous
            </button>
            <span className="text-xs font-medium text-whatsapp-muted">
              Page {page} / {totalPages}
            </span>
            <button
              className="rounded-full border border-whatsapp-line bg-white px-3 py-1 text-xs font-medium text-whatsapp-muted transition hover:bg-whatsapp-soft disabled:cursor-not-allowed disabled:opacity-50"
              disabled={page >= totalPages}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              type="button"
            >
              Next
            </button>
          </div>
        </>
      )}
    </section>
  );
}
