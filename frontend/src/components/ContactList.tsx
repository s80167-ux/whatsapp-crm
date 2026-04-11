import { useMemo, useState } from "react";
// Utility to detect Android/iOS
function isMobileDevice() {
  if (typeof navigator === "undefined") return false;
  return /android|iphone|ipad|ipod/i.test(navigator.userAgent);
}
import { CUSTOMER_STATUS_LABELS, type Conversation, type CustomerStatus } from "../lib/api";
import { getConversationIdentifier, getDisplayName, getDisplayPhone, getResolvedPhone, formatPhoneDisplay } from "../lib/display";

const STATUS_ORDER: CustomerStatus[] = ["new_lead", "interested", "processing", "closed_won", "closed_lost"];

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

type ContactListProps = {
  contacts: Conversation[];
  selectedPhone: string | null;
  loading: boolean;
  refreshing: boolean;
  activeStatusFilter: CustomerStatus | null;
  onRefresh: () => void;
  onSelect: (conversationId: string, opts?: { focusChatInput?: boolean }) => void;
};

function formatTimestamp(value: string) {
  const date = new Date(value);
  const now = new Date();

  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric"
  });
}

function getInitials(contactName: string | null, phone: string | null) {
  const source = contactName || phone || "?";
  const parts = source
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 2);

  if (!parts.length) {
    return "?";
  }

  return parts.map((part) => part[0]?.toUpperCase() || "").join("");
}

function getStatusBadgeClass(status: CustomerStatus) {
  switch (status) {
    case "new_lead":
      return "border border-yellow-200 bg-yellow-50 text-yellow-700";
    case "interested":
      return "border border-emerald-200 bg-emerald-50 text-emerald-700";
    case "processing":
      return "border border-blue-200 bg-blue-50 text-blue-700";
    case "closed_won":
      return "border border-slate-300 bg-slate-100 text-slate-800";
    case "closed_lost":
      return "border border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border border-whatsapp-line bg-whatsapp-canvas text-whatsapp-deep";
  }
}

function getStatusLabel(status: CustomerStatus) {
  return status
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

export function ContactList({ contacts, selectedPhone, loading, refreshing, activeStatusFilter, onRefresh, onSelect }: ContactListProps) {
  const [query, setQuery] = useState("");

  const filteredContacts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return contacts
      .filter((contact) => {
        const resolvedPhone = getResolvedPhone(contact.phone, contact.chatJid) || "";
        const conversationId = getConversationIdentifier(contact.phone, contact.chatJid) || "";
        const displayPhone = getDisplayPhone(contact.phone, contact.chatJid) || resolvedPhone;
        const displayName = getDisplayName(contact.contactName, displayPhone).toLowerCase();

        if (!normalizedQuery) {
          return true;
        }

        return (
          resolvedPhone.toLowerCase().includes(normalizedQuery) ||
          conversationId.toLowerCase().includes(normalizedQuery) ||
          displayPhone.toLowerCase().includes(normalizedQuery) ||
          displayName.includes(normalizedQuery) ||
          contact.lastMessage.toLowerCase().includes(normalizedQuery)
        );
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [contacts, query]);

  return (
    <section className="glass-panel flex min-h-[220px] flex-col p-3 sm:min-h-[420px] sm:p-4">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="hidden text-xs uppercase tracking-[0.25em] text-whatsapp-muted md:block">CRM workspace</p>
          <h3 className="text-sm font-semibold leading-5 text-ink sm:text-xl">Contacts</h3>
          <p className="mt-1 text-xs text-whatsapp-muted">
            {activeStatusFilter ? `Filtered by ${getStatusLabel(activeStatusFilter)}` : "Browse and manage synced contacts"}
          </p>
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
            {contacts.length}
          </div>
        </div>
      </div>

      <div className="mb-3 hidden md:block">
        <input
          className="input-glass"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name, phone, or activity..."
          value={query}
        />
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-whatsapp-muted">Loading contacts...</div>
      ) : filteredContacts.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-3xl border border-dashed border-whatsapp-line bg-whatsapp-canvas px-6 text-center text-sm text-whatsapp-muted">
          <p className="font-medium text-ink">No contacts match the current selection.</p>
          <p className="mt-2 max-w-xs">Try a different search or status filter, or refresh after new WhatsApp activity syncs in.</p>
        </div>
      ) : (
        <div className="flex flex-col space-y-2 pr-1">
          {filteredContacts.map((contact) => {
            const resolvedPhone = getResolvedPhone(contact.phone, contact.chatJid);
            const conversationId = getConversationIdentifier(contact.phone, contact.chatJid);
            const displayPhone = getDisplayPhone(contact.phone, contact.chatJid);
            const activeStatuses = STATUS_ORDER.filter((status) => (contact.status_counts?.[status] ?? 0) > 0);
            const active = selectedPhone === conversationId;

            return (
              <div
                key={contact.chatJid || conversationId || contact.timestamp}
                className={`group relative w-full max-w-full min-w-0 overflow-hidden rounded-lg border px-3 py-3 text-left transition-all duration-300 sm:px-4 sm:py-3 ${
                  active
                    ? "border-transparent bg-[#e9edef] shadow-none"
                    : "border-transparent bg-white hover:bg-[#f5f6f6] shadow-none"
                }`}
                // ...existing code...
              >
                <div className="flex items-start gap-3">
                  {contact.profilePictureUrl ? (
                    <img
                      alt={getDisplayName(contact.contactName, displayPhone || resolvedPhone)}
                      className="h-11 w-11 shrink-0 rounded-[18px] object-cover shadow-soft"
                      src={contact.profilePictureUrl}
                    />
                  ) : (
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[18px] bg-whatsapp-dark text-sm font-semibold text-white shadow-soft">
                      {getInitials(contact.contactName, displayPhone)}
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p
                          className={`truncate text-sm font-bold leading-5 transition-colors ${active ? "text-whatsapp-deep" : "text-ink group-hover:text-whatsapp-deep"} cursor-pointer`}
                          onClick={() => conversationId && onSelect(conversationId)}
                        >
                          {getDisplayName(contact.contactName, displayPhone || resolvedPhone)}
                        </p>
                        <p className={`mt-0.5 truncate text-[11px] font-medium transition-colors ${active ? "text-whatsapp-dark/80" : "text-whatsapp-muted"}`}>
                          {formatPhoneDisplay(contact.phone, contact.chatJid)}
                        </p>
                      </div>

                      <div className="shrink-0 text-right">
                        <p className={`text-[10px] font-medium transition-colors ${active ? "text-whatsapp-dark" : "text-whatsapp-muted"}`}>
                          {formatTimestamp(contact.timestamp)}
                        </p>
                        {contact.unreadCount && contact.unreadCount > 0 ? (
                          <span className="mt-1 inline-flex min-w-[22px] items-center justify-center rounded-full bg-blue-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                            {contact.unreadCount > 99 ? "99+" : contact.unreadCount}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {activeStatuses.length ? (
                      <div className="mt-2 flex items-center gap-2">
                        {activeStatuses.map((status) => (
                          <span key={status} className="icon-hover-trigger flex h-5 w-5 items-center justify-center rounded-full border border-whatsapp-line bg-white shadow-soft">
                            <span className={`chat-status-dot h-2.5 w-2.5 shrink-0 ${getStatusDotClass(status)}`} />
                            <span className="icon-hover-label">{`${CUSTOMER_STATUS_LABELS[status]}: ${contact.status_counts?.[status] ?? 0}`}</span>
                          </span>
                        ))}
                      </div>
                    ) : null}

                    {/* Action icons row */}
                    <div className="mt-2 mb-4 flex items-center gap-2">
                      {/* Call icon (mobile only) */}
                      {isMobileDevice() && contact.phone && (
                        <a
                          href={`tel:${getResolvedPhone(contact.phone, contact.chatJid)}`}
                          className="icon-hover-trigger flex flex-col items-center w-14 px-0 py-1 rounded-xl border border-whatsapp-line bg-white/80 text-whatsapp-deep shadow transition hover:bg-whatsapp-soft"
                          tabIndex={-1}
                          onClick={e => e.stopPropagation()}
                        >
                          <svg width="24" height="24" fill="none" viewBox="0 0 24 24" className="mb-1"><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.86 19.86 0 0 1 3.08 5.18 2 2 0 0 1 5 3h3a2 2 0 0 1 2 1.72c.13.81.36 1.6.68 2.34a2 2 0 0 1-.45 2.11l-1.27 1.27a16 16 0 0 0 6.29 6.29l1.27-1.27a2 2 0 0 1 2.11-.45c.74.32 1.53.55 2.34.68A2 2 0 0 1 22 16.92z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          <span className="block text-[10px] font-normal text-gray-500 sm:hidden text-[min(3vw,11px)]">Call</span>
                          <span className="icon-hover-label hidden sm:inline">Call</span>
                        </a>
                      )}
                      {/* Message icon */}
                      <button
                        className="icon-hover-trigger flex flex-col items-center w-14 px-0 py-1 rounded-xl border border-whatsapp-line bg-white/80 text-whatsapp-deep shadow transition hover:bg-whatsapp-soft"
                        type="button"
                        tabIndex={-1}
                        onClick={e => { e.stopPropagation(); if (conversationId) onSelect(conversationId, { focusChatInput: true }); }}
                      >
                        <svg width="24" height="24" fill="none" viewBox="0 0 24 24" className="mb-1"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        <span className="block text-[10px] font-normal text-gray-500 sm:hidden text-[min(3vw,11px)]">Message</span>
                        <span className="icon-hover-label hidden sm:inline">Message</span>
                      </button>
                      {/* Edit icon */}
                      <button
                        className="icon-hover-trigger flex flex-col items-center w-14 px-0 py-1 rounded-xl border border-whatsapp-line bg-white/80 text-whatsapp-deep shadow transition hover:bg-whatsapp-soft"
                        type="button"
                        tabIndex={-1}
                        onClick={e => { e.stopPropagation(); /* TODO: implement edit action */ }}
                      >
                        <svg width="24" height="24" fill="none" viewBox="0 0 24 24" className="mb-1"><path d="M12 20h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19.5 3 21l1.5-4L16.5 3.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        <span className="block text-[10px] font-normal text-gray-500 sm:hidden text-[min(3vw,11px)]">Edit</span>
                        <span className="icon-hover-label hidden sm:inline">Edit</span>
                      </button>
                      {/* Delete icon */}
                      <button
                        className="icon-hover-trigger flex flex-col items-center w-14 px-0 py-1 rounded-xl border border-whatsapp-line bg-white/80 text-red-500 shadow transition hover:bg-red-100"
                        type="button"
                        tabIndex={-1}
                        onClick={e => { e.stopPropagation(); /* TODO: implement delete action */ }}
                      >
                        <svg width="24" height="24" fill="none" viewBox="0 0 24 24" className="mb-1"><path d="M3 6h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6h16z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        <span className="block text-[10px] font-normal text-rose-500 sm:hidden text-[min(3vw,11px)]">Delete</span>
                        <span className="icon-hover-label hidden sm:inline">Delete</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}