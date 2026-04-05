import { useMemo, useState } from "react";
import type { Conversation, CustomerStatus } from "../lib/api";
import { getDisplayName, getDisplayPhone, getResolvedPhone, formatPhoneDisplay } from "../lib/display";

type ContactListProps = {
  contacts: Conversation[];
  selectedPhone: string | null;
  loading: boolean;
  refreshing: boolean;
  activeStatusFilter: CustomerStatus | null;
  onRefresh: () => void;
  onSelect: (phone: string) => void;
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
        const displayPhone = getDisplayPhone(contact.phone, contact.chatJid) || resolvedPhone;
        const displayName = getDisplayName(contact.contactName, displayPhone).toLowerCase();

        if (!normalizedQuery) {
          return true;
        }

        return (
          resolvedPhone.toLowerCase().includes(normalizedQuery) ||
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
            const displayPhone = getDisplayPhone(contact.phone, contact.chatJid);
            const active = selectedPhone === resolvedPhone;

            return (
              <button
                key={contact.chatJid || resolvedPhone || contact.timestamp}
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
                        <p className={`truncate text-sm font-bold leading-5 transition-colors ${active ? "text-whatsapp-deep" : "text-ink group-hover:text-whatsapp-deep"}`}>
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

                    <div className="mt-2 flex items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${getStatusBadgeClass(contact.status)}`}>
                        {getStatusLabel(contact.status)}
                      </span>
                    </div>

                    <p className={`mt-2 line-clamp-2 text-xs leading-5 transition-colors ${active ? "text-ink/80" : "text-whatsapp-muted group-hover:text-ink/80"}`}>
                      {contact.lastMessage}
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