import type { WhatsAppQr, WhatsAppStatus } from "../lib/api";

type WhatsAppConnectCardProps = {
  status: WhatsAppStatus | null;
  qr: WhatsAppQr | null;
  loading: boolean;
  compact?: boolean;
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

export function WhatsAppConnectCard({ status, qr, loading, compact = false }: WhatsAppConnectCardProps) {
  const helperText = status?.connected
    ? "Your WhatsApp session is active and ready to sync messages."
    : "Scan the QR below with WhatsApp on your phone to connect this CRM workspace.";

  const instructionTitle = status?.connected ? "Connection ready" : "How to connect";
  const shouldShowQrPanel = !status?.connected && (Boolean(qr?.qr) || Boolean(status?.hasQr) || loading);

  if (compact) {
    return (
      <div className="rounded-[28px] border border-white/50 bg-white/40 p-4 shadow-soft">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] text-slate-500">WhatsApp</p>
            <h3 className="mt-1 text-sm font-semibold text-ink">Connection</h3>
          </div>
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              status?.connected ? "bg-emerald-100 text-emerald-700" : "bg-white/70 text-slate-500"
            }`}
          >
            {loading ? "Loading..." : statusLabel(status)}
          </span>
        </div>

        {shouldShowQrPanel ? (
          <div className="mt-3 flex min-h-[148px] items-center justify-center rounded-[22px] bg-white/70 p-3 shadow-soft">
            {qr?.qr ? (
              <img alt="WhatsApp QR code" className="h-28 w-28 rounded-xl object-contain" src={qr.qr} />
            ) : (
              <p className="max-w-[160px] text-center text-xs leading-5 text-slate-400">
                {loading ? "Refreshing QR..." : "Waiting for a fresh QR from the WhatsApp session..."}
              </p>
            )}
          </div>
        ) : (
          <p className="mt-3 text-xs leading-5 text-slate-500">
            {status?.connected ? "Phone linked and ready to sync." : helperText}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="glass-panel p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-slate-500">WhatsApp</p>
          <h3 className="mt-1.5 text-xl font-semibold text-ink">Connection</h3>
          <p className="mt-1.5 text-sm text-slate-500">{helperText}</p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            status?.connected ? "bg-emerald-100 text-emerald-700" : "bg-white/70 text-slate-500"
          }`}
        >
          {loading ? "Loading..." : statusLabel(status)}
        </span>
      </div>

      <div className="mt-3 flex flex-col items-center justify-center rounded-[24px] bg-white/40 p-4 shadow-soft md:flex-row md:items-center md:justify-between">
        <div className="flex min-h-[160px] w-full max-w-[220px] items-center justify-center rounded-[20px] bg-white p-4 shadow-soft">
          {qr?.qr ? (
            <img alt="WhatsApp QR code" className="h-40 w-40 rounded-2xl object-contain" src={qr.qr} />
          ) : status?.connected ? (
            <div className="text-center text-sm text-emerald-600">
              <p className="font-semibold">WhatsApp is connected.</p>
              <p className="mt-1.5 text-emerald-500">You can start syncing and replying now.</p>
            </div>
          ) : status?.hasQr || loading ? (
            <div className="text-center text-sm text-slate-400">
              {loading ? "Refreshing QR..." : "Waiting for a fresh QR from the backend session."}
            </div>
          ) : (
            <div className="text-center text-sm text-slate-400">
              QR code not ready yet. Keep this page open while the backend connects.
            </div>
          )}
        </div>

        <div className="mt-4 max-w-sm md:mt-0 md:pl-5">
          <p className="text-sm font-medium text-slate-600">{instructionTitle}</p>
          <div className="mt-2 space-y-1.5 text-sm text-slate-500">
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
