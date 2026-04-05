import { CUSTOMER_STATUSES, CUSTOMER_STATUS_LABELS, type CustomerStatus } from "../lib/api";
import { formatPhoneDisplay, getDisplayPhone } from "../lib/display";

export type CustomerPanelProps = {
  about: string | null;
  contactName: string | null;
  phone: string | null;
  chatJid?: string | null;
  profilePictureUrl: string | null;
  status: CustomerStatus;
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
  onStatusChange: (value: CustomerStatus) => void;
  onNotesChange: (value: string) => void;
  onClose?: () => void;
  variant?: "panel" | "inline";
};

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
    onStatusChange,
    onNotesChange,
    onClose,
    variant = "panel"
  } = props;

  const visiblePhone = getDisplayPhone(phone, chatJid);
  const title = contactName || visiblePhone || "No customer selected";
  const initials = getInitials(contactName, phone);
  const activityLabel = lastDirection ? `${lastDirection === "incoming" ? "Incoming" : "Outgoing"} message` : "No synced messages";
  const usernameLabel = contactName || "Unavailable";
  const phoneLabel = formatPhoneDisplay(phone, chatJid);
  const isInline = variant === "inline";
  const canCollapse = !isInline && Boolean(onToggleMobileCollapse);
  const contentClasses = isInline
    ? "custom-scrollbar mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1"
    : mobileCollapsed
      ? "hidden"
      : "custom-scrollbar mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1";

  return (
    <aside className={`glass-panel flex flex-col overflow-hidden p-4 ${isInline ? "shadow-soft" : ""}`}>
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
          <div className="flex flex-col gap-4 sm:items-center sm:text-center lg:items-start lg:text-left xl:items-center xl:text-center">
            {profilePictureUrl ? (
              <img
                alt={title}
                className="h-24 w-24 rounded-3xl object-cover shadow-soft"
                src={profilePictureUrl}
              />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-whatsapp-dark text-2xl font-semibold text-white shadow-soft">
                {initials}
              </div>
            )}

            <div className="min-w-0 w-full">
              <h3 className="break-words text-lg font-semibold leading-tight text-ink">{title}</h3>
              <div className="mt-3 grid gap-2 text-left sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-1">
                <div className="rounded-2xl border border-whatsapp-line bg-whatsapp-canvas px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-whatsapp-muted">Username</p>
                  <p className="mt-1 break-words text-sm font-medium text-ink">{usernameLabel}</p>
                </div>
                <div className="rounded-2xl border border-whatsapp-line bg-whatsapp-canvas px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-whatsapp-muted">Phone</p>
                  <p className="mt-1 break-all text-sm font-medium text-ink">{phoneLabel}</p>
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
            <div className="rounded-2xl border border-whatsapp-line bg-whatsapp-canvas p-3">
              <p className="text-[11px] uppercase tracking-[0.2em] text-whatsapp-muted">Last activity</p>
              <p className="mt-1 text-sm font-medium leading-5 text-ink">{formatTime(lastMessageAt)}</p>
              <p className="mt-1 text-xs text-whatsapp-muted">{activityLabel}</p>
            </div>

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
          <p className="text-sm font-medium text-whatsapp-deep">Lead status</p>
          {loading ? <p className="mt-2 text-xs text-whatsapp-muted">Loading customer details...</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {CUSTOMER_STATUSES.map((item) => (
              <button
                key={item}
                className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                  status === item
                    ? "bg-whatsapp-dark text-white shadow-soft"
                    : "border border-whatsapp-line bg-whatsapp-canvas text-whatsapp-muted hover:bg-white"
                }`}
                onClick={() => onStatusChange(item)}
                type="button"
              >
                {CUSTOMER_STATUS_LABELS[item]}
              </button>
            ))}
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
