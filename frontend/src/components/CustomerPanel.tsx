type CustomerPanelProps = {
  about: string | null;
  contactName: string | null;
  phone: string | null;
  profilePictureUrl: string | null;
  status: string;
  notes: string;
  totalMessages?: number;
  incomingCount?: number;
  outgoingCount?: number;
  lastMessageAt?: string | null;
  lastMessagePreview?: string | null;
  lastDirection?: "incoming" | "outgoing" | null;
  loading: boolean;
  saving: boolean;
  onStatusChange: (value: string) => void;
  onNotesChange: (value: string) => void;
};

const statuses = ["hot", "warm", "cold"];

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
    onStatusChange,
    onNotesChange
  } = props;

  const title = contactName || phone || "No customer selected";
  const initials = getInitials(contactName, phone);
  const activityLabel = lastDirection ? `${lastDirection === "incoming" ? "Incoming" : "Outgoing"} message` : "No synced messages";
  const usernameLabel = contactName || "Unavailable";
  const phoneLabel = phone || "Unavailable";

  return (
    <aside className="glass-panel flex min-h-[420px] flex-col overflow-hidden border border-white/70 bg-white/58 p-4 xl:max-h-[calc(100dvh-210px)]">
      <p className="text-xs uppercase tracking-[0.25em] text-emerald-800/65">Customer info</p>

      <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        <div className="rounded-[28px] bg-white/68 p-4 shadow-soft">
          <div className="flex flex-col items-center text-center">
            {profilePictureUrl ? (
              <img
                alt={title}
                className="h-24 w-24 rounded-3xl object-cover shadow-soft"
                src={profilePictureUrl}
              />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-br from-emerald-500 to-teal-600 text-2xl font-semibold text-white shadow-soft">
                {initials}
              </div>
            )}

            <div className="mt-3 min-w-0 w-full">
              <h3 className="break-words text-lg font-semibold leading-tight text-ink">{title}</h3>
              <div className="mt-3 grid gap-2 text-left">
                <div className="rounded-2xl bg-emerald-50/75 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-emerald-800/55">Username</p>
                  <p className="mt-1 break-words text-sm font-medium text-emerald-950/80">{usernameLabel}</p>
                </div>
                <div className="rounded-2xl bg-emerald-50/75 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-emerald-800/55">Phone</p>
                  <p className="mt-1 break-all text-sm font-medium text-emerald-950/80">{phoneLabel}</p>
                </div>
              </div>
            </div>
          </div>

          {about ? (
            <div className="mt-3 rounded-2xl bg-emerald-50/75 px-3 py-2">
              <p className="text-[11px] uppercase tracking-[0.2em] text-emerald-800/55">WhatsApp bio</p>
              <p className="mt-1 break-words text-sm leading-5 text-emerald-950/66">{about}</p>
            </div>
          ) : null}

          <div className="mt-3 grid gap-2">
            <div className="rounded-2xl bg-emerald-50/75 p-3">
              <p className="text-[11px] uppercase tracking-[0.2em] text-emerald-800/55">Last activity</p>
              <p className="mt-1 text-sm font-medium leading-5 text-emerald-950/78">{formatTime(lastMessageAt)}</p>
              <p className="mt-1 text-xs text-emerald-900/45">{activityLabel}</p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-2xl bg-emerald-50/75 p-3 text-center">
                <p className="text-[11px] uppercase tracking-[0.15em] text-emerald-800/55">Total</p>
                <p className="mt-1 text-lg font-semibold text-ink">{totalMessages ?? 0}</p>
              </div>
              <div className="rounded-2xl bg-emerald-50/75 p-3 text-center">
                <p className="text-[11px] uppercase tracking-[0.15em] text-emerald-800/55">In</p>
                <p className="mt-1 text-lg font-semibold text-ink">{incomingCount ?? 0}</p>
              </div>
              <div className="rounded-2xl bg-emerald-50/75 p-3 text-center">
                <p className="text-[11px] uppercase tracking-[0.15em] text-emerald-800/55">Out</p>
                <p className="mt-1 text-lg font-semibold text-ink">{outgoingCount ?? 0}</p>
              </div>
            </div>
          </div>

          {lastMessagePreview ? (
            <div className="mt-2 rounded-2xl bg-emerald-50/75 p-3">
              <p className="text-[11px] uppercase tracking-[0.2em] text-emerald-800/55">Latest synced message</p>
              <p className="mt-1 break-words text-sm leading-5 text-emerald-950/66">{lastMessagePreview}</p>
            </div>
          ) : null}
        </div>

        <div className="rounded-3xl bg-white/55 p-4 shadow-soft">
          <p className="text-sm font-medium text-emerald-950/70">Lead status</p>
          {loading ? <p className="mt-2 text-xs text-emerald-900/45">Loading customer details...</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {statuses.map((item) => (
              <button
                key={item}
                className={`rounded-full px-4 py-2 text-sm font-medium capitalize transition ${
                  status === item
                    ? "bg-gradient-to-r from-emerald-500 to-green-400 text-white shadow-soft"
                    : "bg-white/80 text-emerald-900/60 hover:bg-white"
                }`}
                onClick={() => onStatusChange(item)}
                type="button"
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-3xl bg-white/55 p-4 shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-emerald-950/70">Notes</p>
            <span className="text-xs text-emerald-900/45">{saving ? "Saving..." : "Saved"}</span>
          </div>
          <textarea
            className="mt-3 min-h-28 w-full rounded-2xl border border-emerald-100 bg-white/85 p-3 text-sm text-slate-700 outline-none transition placeholder:text-emerald-900/35 focus:border-emerald-300"
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
