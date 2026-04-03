import type { WhatsAppQr, WhatsAppStatus } from "../lib/api";

type WhatsAppConnectCardProps = {
  status: WhatsAppStatus | null;
  qr: WhatsAppQr | null;
  loading: boolean;
  compact?: boolean;
  onDisconnect?: () => void;
  disconnecting?: boolean;
};

function statusLabel(status: WhatsAppStatus | null) {
  if (!status) {
    return "Checking connection...";
  }

  if (status.connected) {
    return "Connected";
  }

  if (status.hasQr) {
    return "Waiting for scan";
  }

  return status.state || "Connecting";
}

export function WhatsAppConnectCard({
  status,
  qr,
  loading,
  compact = false,
  onDisconnect,
  disconnecting = false
}: WhatsAppConnectCardProps) {
  const helperText = status?.connected
    ? "Your WhatsApp session is active and ready to sync messages."
    : "Scan the QR below with WhatsApp on your phone to connect this CRM workspace.";

  const instructionTitle = status?.connected ? "Connection ready" : "How to connect";
  const shouldShowQrPanel = !status?.connected && (Boolean(qr?.qr) || Boolean(status?.hasQr) || loading);
  const canDisconnect = Boolean(onDisconnect) && Boolean(status?.connected || disconnecting);
  const disconnectLabel = disconnecting ? "Disconnecting WhatsApp" : "Disconnect WhatsApp";

  const disconnectIconButton = canDisconnect ? (
    <button
      aria-label={disconnectLabel}
      className="secondary-button flex h-10 w-10 items-center justify-center rounded-full p-0"
      disabled={disconnecting}
      onClick={onDisconnect}
      title={disconnectLabel}
      type="button"
    >
      <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
        <path
          d="M15 9l-6 6M9 9l6 6"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
        <path
          d="M8 4h8a2 2 0 0 1 2 2v12l-2.8-2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      </svg>
    </button>
  ) : null;

  if (compact) {
    return (
      <div className="rounded-[28px] border border-white/60 bg-white/62 p-4 shadow-soft">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] text-emerald-800/65">WhatsApp</p>
            <h3 className="mt-1 text-sm font-semibold text-ink">Connection</h3>
          </div>
          <div className="flex items-center gap-2">
            {disconnectIconButton}
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                status?.connected ? "bg-emerald-100 text-emerald-800" : "bg-emerald-950/6 text-emerald-900/60"
              }`}
            >
              {loading ? "Loading..." : statusLabel(status)}
            </span>
          </div>
        </div>

        {shouldShowQrPanel ? (
          <div className="mt-3 flex min-h-[148px] items-center justify-center rounded-[22px] bg-emerald-50/80 p-3 shadow-soft">
            {qr?.qr ? (
              <img alt="WhatsApp QR code" className="h-28 w-28 rounded-xl object-contain" src={qr.qr} />
            ) : (
              <p className="max-w-[160px] text-center text-xs leading-5 text-emerald-900/42">
                {loading ? "Refreshing QR..." : "Waiting for a fresh QR from the WhatsApp session..."}
              </p>
            )}
          </div>
        ) : (
          <p className="mt-3 text-xs leading-5 text-emerald-950/62">
            {status?.connected ? "Phone linked and ready to sync." : helperText}
          </p>
        )}

      </div>
    );
  }

  return (
    <div className="glass-panel border border-white/70 bg-white/62 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-emerald-800/65">WhatsApp</p>
          <h3 className="mt-1.5 text-xl font-semibold text-ink">Connection</h3>
          <p className="mt-1.5 text-sm text-emerald-950/62">{helperText}</p>
        </div>
        <div className="flex items-center gap-2">
          {disconnectIconButton}
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              status?.connected ? "bg-emerald-100 text-emerald-800" : "bg-emerald-950/6 text-emerald-900/60"
            }`}
          >
            {loading ? "Loading..." : statusLabel(status)}
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-col items-center justify-center rounded-[24px] bg-white/55 p-4 shadow-soft md:flex-row md:items-center md:justify-between">
        <div className="flex min-h-[160px] w-full max-w-[220px] items-center justify-center rounded-[20px] bg-emerald-50/85 p-4 shadow-soft">
          {qr?.qr ? (
            <img alt="WhatsApp QR code" className="h-40 w-40 rounded-2xl object-contain" src={qr.qr} />
          ) : status?.connected ? (
            <div className="text-center text-sm text-emerald-700">
              <p className="font-semibold">WhatsApp is connected.</p>
              <p className="mt-1.5 text-emerald-600">You can start syncing and replying now.</p>
            </div>
          ) : status?.hasQr || loading ? (
            <div className="text-center text-sm text-emerald-900/42">
              {loading ? "Refreshing QR..." : "Waiting for a fresh QR from the backend session."}
            </div>
          ) : (
            <div className="text-center text-sm text-emerald-900/42">
              QR code not ready yet. Keep this page open while the backend connects.
            </div>
          )}
        </div>

        <div className="mt-4 max-w-sm md:mt-0 md:pl-5">
          <p className="text-sm font-medium text-emerald-950/72">{instructionTitle}</p>
          <div className="mt-2 space-y-1.5 text-sm text-emerald-950/62">
            {status?.connected ? (
              <>
                <p>1. Your phone is already linked to this workspace.</p>
                <p>2. New messages will sync into the dashboard automatically.</p>
                <p>3. Open a conversation to reply and manage notes.</p>
                <p>4. Reconnect from the backend session if you need a fresh QR.</p>
              </>
            ) : (
              <>
                <p>1. Open WhatsApp on your phone.</p>
                <p>2. Go to Linked Devices.</p>
                <p>3. Tap Link a Device and scan this QR.</p>
                <p>4. Wait for the status badge to change to Connected.</p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
