import { CUSTOMER_STATUSES, CUSTOMER_STATUS_LABELS, type CustomerStatus } from "../lib/api";
import { formatPhoneDisplay, formatWhatsAppIdDisplay, getDisplayPhone } from "../lib/display";
import "./CustomerPanel.css";

export type CustomerPanelProps = {
  about: string | null;
  contactName: string | null;
  isContactAnchor?: boolean;
  phone: string | null;
  customerId?: string | null;
  chatJid?: string | null;
  updatedAt?: string | null;
  profilePictureUrl: string | null;
  status: CustomerStatus;
  statusCounts: Record<CustomerStatus, number>;
  notes: string;
  totalMessages?: number;
  incomingCount?: number;
  outgoingCount?: number;
  lastMessageAt?: string | null;
  lastMessagePreview?: string | null;
  lastDirection?: "incoming" | "outgoing" | null;
  loading: boolean;
  saving: boolean;
  mobileCollapsed?: boolean;
  onToggleMobileCollapse?: () => void;
  onNotesChange: (value: string) => void;
  onClose?: () => void;
  onEditProfile?: () => void;
  variant?: "panel" | "inline";
  onLeadStatusFilter?: (status: CustomerStatus) => void;
  premiseAddress?: string | null;
  businessType?: string | null;
  age?: number | null;
  emailAddress?: string | null;
  contactId?: string | null;
};

function getStatusAccent(status: CustomerStatus) {
  switch (status) {
    case "new_lead":
      return "bg-yellow-400/20 text-yellow-700 border-yellow-200";
    case "interested":
      return "bg-emerald-400/20 text-emerald-700 border-emerald-200";
    case "processing":
      return "bg-blue-400/20 text-blue-700 border-blue-200";
    case "closed_won":
      return "bg-slate-700/15 text-slate-800 border-slate-300";
    case "closed_lost":
      return "bg-rose-400/20 text-rose-700 border-rose-200";
    default:
      return "bg-whatsapp-canvas text-whatsapp-deep border-whatsapp-line";
  }
}

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

function DetailIcon(props: { children: React.ReactNode }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-whatsapp-line bg-whatsapp-canvas text-whatsapp-deep shadow-soft">
      {props.children}
    </span>
  );
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

function VerifiedBadge() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-sky-700 shadow-sm">
      <svg aria-hidden="true" fill="none" height="10" viewBox="0 0 12 12" width="10">
        <path d="m2.25 6.25 2.1 2.1L9.75 3.1" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
      </svg>
      Verified
    </span>
  );
}

function formatTime(value?: string | null) {
  if (!value) {
    return "No activity yet";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function CustomerPanel(props: CustomerPanelProps) {
  const {
    about,
    contactName,
    isContactAnchor = false,
    phone,
    customerId,
    chatJid,
    updatedAt,
    profilePictureUrl,
    status,
    statusCounts,
    notes,
    totalMessages,
    incomingCount,
    outgoingCount,
    lastMessageAt,
    lastMessagePreview,
    lastDirection,
    loading,
    saving,
    mobileCollapsed = false,
    onToggleMobileCollapse,
    onNotesChange,
    onClose,
    onEditProfile,
    variant = "panel",
    onLeadStatusFilter,
    premiseAddress,
    businessType,
    age,
    emailAddress,
    contactId
  } = props;

  const visiblePhone = getDisplayPhone(phone, chatJid);
  const title = contactName || visiblePhone || "No customer selected";
  const initials = getInitials(contactName, phone);
  const activityLabel = lastDirection ? `${lastDirection === "incoming" ? "Incoming" : "Outgoing"} message` : "No synced messages";
  const contactNameLabel = contactName || "Unavailable";
  const whatsappIdLabel = formatWhatsAppIdDisplay(phone, chatJid);
  const phoneLabel = formatPhoneDisplay(phone, chatJid);
  const currentStatusLabel = CUSTOMER_STATUS_LABELS[status];
  const isInline = variant === "inline";
  const canCollapse = !isInline && Boolean(onToggleMobileCollapse);
  const containerClassName = `glass-panel flex flex-col overflow-hidden p-4 ${isInline ? "h-full shadow-soft" : "h-full min-h-0"}`;
  // Only declare contentClasses once
  const contentClasses = isInline
    ? "custom-scrollbar mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1"
    : mobileCollapsed
      ? "hidden"
      : "custom-scrollbar mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1";

  return (
    <aside className={containerClassName}>
      {isInline ? (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.25em] text-whatsapp-muted">Customer profile</p>
            <div className="mt-1 flex min-w-0 items-center gap-2">
              <p className="truncate text-sm font-medium text-ink">{title}</p>
              {isContactAnchor ? <VerifiedBadge /> : null}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onEditProfile ? (
              <button
                aria-label="Edit customer profile"
                className="icon-hover-trigger flex h-10 shrink-0 items-center gap-2 rounded-full border border-whatsapp-line bg-white px-3 text-whatsapp-deep shadow-soft transition hover:bg-whatsapp-soft"
                onClick={onEditProfile}
                type="button"
              >
                <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
                  <path d="M12 20h9" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                  <path
                    d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19.5 3 21l1.5-4L16.5 3.5z"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                  />
                </svg>
                <span className="hidden text-xs font-medium sm:inline">Edit profile</span>
              </button>
            ) : null}
            {onClose ? (
              <button
                aria-label="Close customer profile"
                className="icon-hover-trigger flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-whatsapp-canvas text-whatsapp-muted shadow-soft transition hover:bg-white hover:text-whatsapp-deep"
                onClick={onClose}
                type="button"
              >
                <svg fill="none" height="18" viewBox="0 0 24 24" width="18">
                  <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                </svg>
                <span className="block text-[10px] font-normal text-gray-500 sm:hidden">Close</span>
                <span className="icon-hover-label hidden sm:inline">Close profile</span>
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          <button
            className="flex w-full items-center justify-between gap-3 text-left"
            disabled={!canCollapse}
            onClick={onToggleMobileCollapse}
            type="button"
          >
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.25em] text-whatsapp-muted">Customer info</p>
              <p className="mt-1 truncate text-sm font-medium text-ink">{title}</p>
            </div>
            <div className="flex items-center gap-2">
              {onEditProfile ? (
                <button
                  aria-label="Edit customer profile"
                  className="icon-hover-trigger flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-whatsapp-line bg-white px-3 text-whatsapp-deep shadow-soft transition hover:bg-whatsapp-soft"
                  onClick={onEditProfile}
                  type="button"
                >
                  <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
                    <path d="M12 20h9" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                    <path
                      d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19.5 3 21l1.5-4L16.5 3.5z"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                    />
                  </svg>
                  <span className="text-[11px] font-medium">Edit</span>
                </button>
              ) : null}
              {canCollapse ? (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-whatsapp-canvas text-whatsapp-muted shadow-soft transition hover:bg-white hover:text-whatsapp-deep">
                  {/* Minimal plus/minus icon for collapse/expand */}
                  {mobileCollapsed ? (
                    <svg className="h-4 w-4 transition" fill="none" viewBox="0 0 24 24">
                      <rect x="5" y="11" width="14" height="2" rx="1" fill="currentColor" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4 transition" fill="none" viewBox="0 0 24 24">
                      <rect x="5" y="11" width="14" height="2" rx="1" fill="currentColor" />
                      <rect x="11" y="5" width="2" height="14" rx="1" fill="currentColor" />
                    </svg>
                  )}
                </span>
              ) : null}
            </div>
          </button>
        </>
      )}

      <div className={contentClasses}>
        <div className="rounded-[20px] border border-whatsapp-line bg-white p-3 shadow-soft sm:p-4">
          <div className="flex flex-col gap-3 sm:gap-4">
            {profilePictureUrl ? (
              <img
                alt={title}
                className="h-14 w-14 sm:h-20 sm:w-20 rounded-2xl sm:rounded-3xl object-cover shadow-soft"
                src={profilePictureUrl}
              />
            ) : (
              <div className="flex h-14 w-14 sm:h-20 sm:w-20 items-center justify-center rounded-2xl sm:rounded-3xl bg-whatsapp-dark text-lg sm:text-xl font-semibold text-white shadow-soft">
                {initials}
              </div>
            )}

            <div className="min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <h3 className="break-words text-base sm:text-lg font-semibold leading-tight text-ink">{title}</h3>
                    {isContactAnchor ? <VerifiedBadge /> : null}
                  </div>
                  <p className="mt-0.5 text-[10px] sm:text-xs uppercase tracking-[0.2em] text-whatsapp-muted">Customer profile</p>
                </div>
                {/* Slimmer status: just dot and label */}
                <span className="flex items-center gap-1">
                  <span className={`chat-status-dot h-3 w-3 shrink-0 ${getStatusDotClass(status)}`}></span>
                  <span className="text-xs font-semibold text-ink">{currentStatusLabel}</span>
                </span>
              </div>

             <div className="mt-3 customer-info-list">
  <div className="info-item">
    <span className="info-label">Premise</span>
    <span className="info-value">{premiseAddress || "-"}</span>
  </div>

  <div className="info-item">
    <span className="info-label">Business</span>
    <span className="info-value">{businessType || "-"}</span>
  </div>

  <div className="info-item">
    <span className="info-label">Age</span>
    <span className="info-value">{age ?? "-"}</span>
  </div>

  <div className="info-item">
    <span className="info-label">Email</span>
    <span className="info-value">{emailAddress || "-"}</span>
  </div>

  <div className="info-item">
    <span className="info-label">WhatsApp ID</span>
    <span className="info-value">{whatsappIdLabel || "-"}</span>
  </div>

  <div className="info-item">
    <span className="info-label">Contact ID</span>
    <span className="info-value">{contactId || "-"}</span>
  </div>

  <div className="info-item">
    <span className="info-label">Customer ID</span>
    <span className="info-value">{customerId || "-"}</span>
  </div>

  <div className="info-item">
    <span className="info-label">Updated</span>
    <span className="info-value">{formatTime(updatedAt)}</span>
  </div>

  <div className="info-item">
    <span className="info-label">Phone</span>
    <span className="info-value">{phoneLabel}</span>
  </div>
</div>
            </div>
          </div>

          {about ? (
            <div className="mt-3 rounded-2xl border border-whatsapp-line bg-whatsapp-canvas px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.2em] text-whatsapp-muted">WhatsApp bio</p>
              <p className="mt-1 break-words text-sm leading-5 text-ink/80">{about}</p>
            </div>
          ) : null}

          <div className="mt-3 grid gap-2">
            <div className="stats-grid">
  <div className="stat-card">
    <p className="stat-label">TOTAL</p>
    <p className="stat-value">{totalMessages ?? 0}</p>
  </div>

  <div className="stat-card">
    <p className="stat-label">IN</p>
    <p className="stat-value">{incomingCount ?? 0}</p>
  </div>

  <div className="stat-card">
    <p className="stat-label">OUT</p>
    <p className="stat-value">{outgoingCount ?? 0}</p>
  </div>
</div>
          </div>

          {lastMessagePreview ? (
            <div className="mt-2 rounded-2xl border border-whatsapp-line bg-whatsapp-canvas p-3">
              <p className="text-[11px] uppercase tracking-[0.2em] text-whatsapp-muted">Latest synced message</p>
              <p className="mt-1 break-words text-sm leading-5 text-ink/80">{lastMessagePreview}</p>
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border border-whatsapp-line bg-white p-3 shadow-soft sm:rounded-3xl sm:p-4">
          <div className="flex items-center justify-between gap-2 sm:gap-3">
            <p className="text-xs sm:text-sm font-medium text-whatsapp-deep">Lead status</p>
            {loading ? <span className="text-xs text-whatsapp-muted">Loading...</span> : null}
          </div>
          <div className="mt-2 status-grid">
            {CUSTOMER_STATUSES.map((item) => {
              const isActive = item === status;
              const count = statusCounts[item] ?? 0;
              // Always use lead status color for button background
              const statusClass = getStatusAccent(item);
              return (
                <button
                  key={item}
                  className={`icon-hover-trigger flex flex-col items-center justify-center rounded-xl border px-1.5 py-1.5 sm:px-3 sm:py-2.5 transition focus:outline-none ${statusClass} `}
                  type="button"
                  onClick={() => props.onLeadStatusFilter && props.onLeadStatusFilter(item)}
                >
                  <span className="text-xs sm:text-sm font-semibold flex-shrink-0">{count}</span>
                  <span
                    className="font-normal text-gray-700 text-center leading-tight mt-0.5 w-full break-words customer-status-label"
                  >
                    {CUSTOMER_STATUS_LABELS[item]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-3xl border border-whatsapp-line bg-white p-4 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-whatsapp-deep">Notes</p>
            <span className="text-xs text-whatsapp-muted">{saving ? "Saving..." : "Saved"}</span>
          </div>
          <textarea
            className="mt-3 min-h-28 w-full rounded-2xl border border-whatsapp-line bg-whatsapp-canvas p-3 text-sm text-ink outline-none transition placeholder:text-whatsapp-muted focus:border-whatsapp-dark focus:bg-white"
            disabled={!phone || loading}
            onChange={(event) => onNotesChange(event.target.value)}
            placeholder="Add context, follow-up reminders, or sales notes..."
            value={notes}
          />
        </div>
      </div>
    </aside>
  );
}
