import { CUSTOMER_STATUSES, CUSTOMER_STATUS_LABELS, type CustomerStatus } from "../lib/api";
import { formatPhoneDisplay, formatWhatsAppIdDisplay, getDisplayPhone } from "../lib/display";

export type CustomerPanelProps = {
  about: string | null;
  contactName: string | null;
  phone: string | null;
  chatJid?: string | null;
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
  variant?: "panel" | "inline";
};

function getStatusAccent(status: CustomerStatus) {
  switch (status) {
    case "new_lead":
      return "bg-yellow-500/12 text-yellow-700 border-yellow-200";
    case "interested":
      return "bg-emerald-500/12 text-emerald-700 border-emerald-200";
    case "processing":
      return "bg-blue-500/12 text-blue-700 border-blue-200";
    case "closed_won":
      return "bg-slate-700/12 text-slate-800 border-slate-300";
    case "closed_lost":
      return "bg-rose-500/12 text-rose-700 border-rose-200";
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
    phone,
    chatJid,
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
    variant = "panel"
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
  const contentClasses = isInline
    ? "custom-scrollbar mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1"
    : mobileCollapsed
      ? "hidden"
      : "custom-scrollbar mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1";

  return (
    <aside className={`glass-panel flex flex-col overflow-hidden p-4 ${isInline ? "h-full shadow-soft" : ""}`}>
      {isInline ? (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.25em] text-whatsapp-muted">Customer profile</p>
            <p className="mt-1 truncate text-sm font-medium text-ink">{title}</p>
          </div>
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
              <span className="icon-hover-label">Close profile</span>
            </button>
          ) : null}
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
            {canCollapse ? (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-whatsapp-canvas text-whatsapp-muted shadow-soft transition hover:bg-white hover:text-whatsapp-deep">
                <svg className={`h-4 w-4 transition ${mobileCollapsed ? "" : "rotate-180"}`} fill="none" viewBox="0 0 24 24">
                  <path d="m6 9 6 6 6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                </svg>
              </span>
            ) : null}
          </button>
        </>
      )}

      <div className={contentClasses}>
        <div className="rounded-[28px] border border-whatsapp-line bg-white p-4 shadow-soft">
          <div className="flex flex-col gap-4">
            {profilePictureUrl ? (
              <img
                alt={title}
                className="h-20 w-20 rounded-3xl object-cover shadow-soft"
                src={profilePictureUrl}
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-whatsapp-dark text-xl font-semibold text-white shadow-soft">
                {initials}
              </div>
            )}

            <div className="min-w-0">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="break-words text-lg font-semibold leading-tight text-ink">{title}</h3>
                  <p className="mt-1 text-xs uppercase tracking-[0.2em] text-whatsapp-muted">Customer profile</p>
                </div>
                <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${getStatusAccent(status)}`}>
                  {currentStatusLabel}
                </span>
              </div>

              <div className="mt-4 grid gap-2">
                <div className="flex items-start gap-3 rounded-2xl border border-whatsapp-line bg-whatsapp-canvas px-3 py-3">
                  <DetailIcon>
                    <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
                      <path d="M5 20h14M7 17V8m5 9V4m5 13v-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                    </svg>
                  </DetailIcon>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-whatsapp-muted">Contact name</p>
                    <p className="mt-1 break-words text-sm font-medium text-ink">{contactNameLabel}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3 rounded-2xl border border-whatsapp-line bg-whatsapp-canvas px-3 py-3">
                  <DetailIcon>
                    <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
                      <path d="M7 7h10v10H7z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                      <path d="M10 10h4v4h-4z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                    </svg>
                  </DetailIcon>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-whatsapp-muted">WhatsApp ID</p>
                    <p className="mt-1 break-all text-sm font-medium text-ink">{whatsappIdLabel}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3 rounded-2xl border border-whatsapp-line bg-whatsapp-canvas px-3 py-3">
                  <DetailIcon>
                    <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
                      <path d="M4 7.5C4 6.12 5.12 5 6.5 5h11C18.88 5 20 6.12 20 7.5v9c0 1.38-1.12 2.5-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-9Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                      <path d="M7 9h10M7 13h6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                    </svg>
                  </DetailIcon>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-whatsapp-muted">Phone number</p>
                    <p className="mt-1 break-all text-sm font-medium text-ink">{phoneLabel}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3 rounded-2xl border border-whatsapp-line bg-whatsapp-canvas px-3 py-3">
                  <DetailIcon>
                    <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
                      <path d="M12 7v5l3 3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
                    </svg>
                  </DetailIcon>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-whatsapp-muted">Last activity</p>
                    <p className="mt-1 text-sm font-medium leading-5 text-ink">{formatTime(lastMessageAt)}</p>
                    <p className="mt-1 text-xs text-whatsapp-muted">{activityLabel}</p>
                  </div>
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
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-2xl border border-whatsapp-line bg-whatsapp-canvas p-3 text-center">
                <p className="text-[11px] uppercase tracking-[0.15em] text-whatsapp-muted">Total</p>
                <p className="mt-1 text-lg font-semibold text-ink">{totalMessages ?? 0}</p>
              </div>
              <div className="rounded-2xl border border-whatsapp-line bg-whatsapp-canvas p-3 text-center">
                <p className="text-[11px] uppercase tracking-[0.15em] text-whatsapp-muted">In</p>
                <p className="mt-1 text-lg font-semibold text-ink">{incomingCount ?? 0}</p>
              </div>
              <div className="rounded-2xl border border-whatsapp-line bg-whatsapp-canvas p-3 text-center">
                <p className="text-[11px] uppercase tracking-[0.15em] text-whatsapp-muted">Out</p>
                <p className="mt-1 text-lg font-semibold text-ink">{outgoingCount ?? 0}</p>
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

        <div className="rounded-3xl border border-whatsapp-line bg-white p-4 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-whatsapp-deep">Lead status</p>
            {loading ? <span className="text-xs text-whatsapp-muted">Loading customer details...</span> : null}
          </div>
          <div className="mt-3 flex items-center justify-between rounded-2xl border border-whatsapp-line bg-whatsapp-canvas px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className={`chat-status-dot h-3 w-3 shrink-0 ${getStatusDotClass(status)}`} />
              <span className="text-sm font-medium text-ink">{currentStatusLabel}</span>
            </div>
            <span className="text-xs text-whatsapp-muted">Current</span>
          </div>
          <div className="mt-3 grid grid-cols-5 gap-2">
            {CUSTOMER_STATUSES.map((item) => {
              const isActive = item === status;
              const count = statusCounts[item] ?? 0;

              return (
                <div
                  key={item}
                  className={`icon-hover-trigger flex items-center justify-between rounded-2xl border px-3 py-2.5 transition ${
                    isActive ? getStatusAccent(item) : "border-whatsapp-line bg-whatsapp-canvas text-whatsapp-muted"
                  }`}
                >
                  <span className={`chat-status-dot h-3 w-3 shrink-0 ${getStatusDotClass(item)}`} />
                  <span className="text-sm font-semibold">{count}</span>
                  <span className="icon-hover-label">{`${CUSTOMER_STATUS_LABELS[item]}: ${count}`}</span>
                </div>
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
