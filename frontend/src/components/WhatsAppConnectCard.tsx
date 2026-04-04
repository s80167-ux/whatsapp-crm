import { useEffect, useState } from "react";
import { api, type WhatsAppProfile, type WhatsAppQr, type WhatsAppStatus } from "../lib/api";

type WhatsAppConnectCardProps = {
  status: WhatsAppStatus | null;
  qr: WhatsAppQr | null;
  loading: boolean;
  token: string;
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

function formatPhone(value: string | null) {
  if (!value) {
    return "Unavailable";
  }

  return value.startsWith("+") ? value : `+${value}`;
}

function formatPrice(price: number, currency: string) {
  if (!Number.isFinite(price)) {
    return currency || "Price unavailable";
  }

  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency || "MYR",
    maximumFractionDigits: 2
  }).format(price);
}

export function WhatsAppConnectCard({
  status,
  qr,
  loading,
  token,
  compact = false,
  onDisconnect,
  disconnecting = false
}: WhatsAppConnectCardProps) {
  const [showProfilePanel, setShowProfilePanel] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profile, setProfile] = useState<WhatsAppProfile | null>(null);
  const [syncDays, setSyncDays] = useState<number>(7);
  const [savingSync, setSavingSync] = useState(false);
  const [clearingDb, setClearingDb] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api.getWhatsAppSettings(token)
      .then((data) => {
        if (!cancelled) setSyncDays(data.history_sync_days);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSyncDaysChange(newDays: number) {
    setSyncDays(newDays);
    setSavingSync(true);
    try {
      await api.updateWhatsAppSettings(newDays, token);
    } catch (e) {
      console.error(e);
    } finally {
      setSavingSync(false);
    }
  }

  async function handleClearDatabase(e: React.MouseEvent) {
    e.stopPropagation();
    console.log("Handle clear database triggered");
    
    const firstConfirm = window.confirm("Are you sure you want to completely erase all messages and customer conversations? This action is irreversible!");
    if (!firstConfirm) return;

    const secondConfirm = window.confirm("FINAL WARNING: This will permanently delete ALL history. Type OK to proceed.");
    if (!secondConfirm) return;

    console.log("Clear database confirmed, calling API...");
    setClearingDb(true);
    try {
      await api.clearDatabase(token);
      console.log("Database wiped successfully");
      alert("Database wiped successfully. You can now start fresh.");
      window.location.reload();
    } catch (e) {
      console.error("Clear database failed:", e);
      alert("Failed to wipe database: " + String(e));
    } finally {
      setClearingDb(false);
    }
  }

  const helperText = status?.connected
    ? "Your WhatsApp session is active and ready to sync messages."
    : "Scan the QR below with WhatsApp on your phone to connect this CRM workspace.";

  const instructionTitle = status?.connected ? "Connection ready" : "How to connect";
  const shouldShowQrPanel = !status?.connected && (Boolean(qr?.qr) || Boolean(status?.hasQr) || loading);
  const canDisconnect = Boolean(onDisconnect) && Boolean(status?.connected || disconnecting);
  const canViewProfile = Boolean(status?.connected && token);
  const disconnectLabel = disconnecting ? "Disconnecting WhatsApp" : "Disconnect WhatsApp";

  useEffect(() => {
    if (!showProfilePanel || !canViewProfile) {
      return;
    }

    let cancelled = false;

    async function loadProfile() {
      setProfileLoading(true);
      setProfileError("");

      try {
        const data = await api.getWhatsAppProfile(token);
        if (!cancelled) {
          setProfile(data);
        }
      } catch (error) {
        if (!cancelled) {
          setProfileError(error instanceof Error ? error.message : "Failed to load WhatsApp profile.");
        }
      } finally {
        if (!cancelled) {
          setProfileLoading(false);
        }
      }
    }

    void loadProfile();

    return () => {
      cancelled = true;
    };
  }, [canViewProfile, showProfilePanel, token]);

  useEffect(() => {
    if (!status?.connected) {
      setShowProfilePanel(false);
      setProfile(null);
      setProfileError("");
    }
  }, [status?.connected]);

  const profileIconButton = canViewProfile ? (
    <button
      aria-label={showProfilePanel ? "Hide WhatsApp profile" : "Show WhatsApp profile"}
      className={`flex h-10 w-10 appearance-none items-center justify-center border-0 bg-transparent p-0 text-emerald-900/72 shadow-none outline-none ring-0 transition hover:bg-transparent hover:text-emerald-950 focus:bg-transparent ${showProfilePanel ? "text-emerald-950" : ""}`}
      onClick={() => setShowProfilePanel((current) => !current)}
      title={showProfilePanel ? "Hide WhatsApp profile" : "Show WhatsApp profile"}
      type="button"
    >
      <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
        <path
          d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 1 1 14 0"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      </svg>
    </button>
  ) : null;

  const disconnectIconButton = canDisconnect ? (
    <button
      aria-label={disconnectLabel}
      className="flex h-10 w-10 appearance-none items-center justify-center border-0 bg-transparent p-0 text-emerald-900/72 shadow-none outline-none ring-0 transition hover:bg-transparent hover:text-rose-700 focus:bg-transparent disabled:cursor-not-allowed disabled:opacity-50"
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

  const profilePanel = showProfilePanel ? (
    <div className="mt-3 rounded-[24px] border border-white/60 bg-white/78 p-3 shadow-soft">
      {profileLoading ? (
        <p className="text-sm text-emerald-900/55">Loading WhatsApp profile...</p>
      ) : profileError ? (
        <p className="text-sm text-rose-500">{profileError}</p>
      ) : profile ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            {profile.profilePictureUrl ? (
              <img
                alt={profile.username || profile.phone || "WhatsApp profile"}
                className="h-14 w-14 rounded-2xl object-cover shadow-soft"
                src={profile.profilePictureUrl}
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-lg font-semibold text-white shadow-soft">
                {(profile.username || profile.phone || "W").slice(0, 1).toUpperCase()}
              </div>
            )}

            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{profile.username || "WhatsApp account"}</p>
              <p className="mt-1 break-all text-xs text-emerald-900/55">{formatPhone(profile.phone)}</p>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="min-w-0 rounded-[18px] bg-emerald-50/80 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-900/50">Username</p>
              <p className="mt-1 break-words text-sm font-medium text-ink">{profile.username || "Unavailable"}</p>
            </div>
            <div className="min-w-0 rounded-[18px] bg-emerald-50/80 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-900/50">Number</p>
              <p className="mt-1 break-all text-sm font-medium text-ink">{formatPhone(profile.phone)}</p>
            </div>
          </div>

          {profile.businessProfile ? (
            <div className="rounded-[18px] bg-emerald-50/80 p-3">
              <div className="grid gap-2 md:grid-cols-2">
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-900/50">Category</p>
                  <p className="mt-1 break-words text-sm font-medium text-ink">{profile.businessProfile.category || "Unavailable"}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-900/50">Email</p>
                  <p className="mt-1 break-all text-sm font-medium text-ink">{profile.businessProfile.email || "Unavailable"}</p>
                </div>
              </div>
              <div className="mt-2">
                <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-900/50">Shop description</p>
                <p className="mt-1 break-words text-sm text-emerald-950/70">{profile.businessProfile.description || "Unavailable"}</p>
              </div>
              <div className="mt-2">
                <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-900/50">Address</p>
                <p className="mt-1 break-words text-sm text-emerald-950/70">{profile.businessProfile.address || "Unavailable"}</p>
              </div>
              <div className="mt-2">
                <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-900/50">Website</p>
                <p className="mt-1 break-all text-sm text-emerald-950/70">
                  {profile.businessProfile.website.length ? profile.businessProfile.website.join(", ") : "Unavailable"}
                </p>
              </div>
            </div>
          ) : null}

          <div className="rounded-[18px] bg-emerald-50/80 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-900/50">Catalogue / Shop</p>
              <span className="rounded-full bg-white/80 px-2 py-1 text-[10px] font-semibold text-emerald-900/60">
                {profile.catalog?.products.length || 0} items
              </span>
            </div>

            {profile.catalog?.products.length ? (
              <div className="mt-3 space-y-2">
                {profile.catalog.products.map((product) => (
                  <div key={product.id} className="flex gap-3 rounded-[18px] border border-white/60 bg-white/72 p-2.5">
                    {product.imageUrl ? (
                      <img alt={product.name} className="h-14 w-14 rounded-2xl object-cover" src={product.imageUrl} />
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-[10px] font-semibold uppercase text-emerald-900/55">
                        Shop
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">{product.name}</p>
                      <p className="mt-1 text-xs text-emerald-900/55">{formatPrice(product.price, product.currency)}</p>
                      {product.description ? <p className="mt-1 line-clamp-2 text-xs text-emerald-950/65">{product.description}</p> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-emerald-950/62">No catalogue or shop items are available for this WhatsApp account.</p>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-emerald-900/55">No WhatsApp profile data is available yet.</p>
      )}
    </div>
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
            {profileIconButton}
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

        {profilePanel}

        <div className="mt-4 border-t border-emerald-900/10 pt-3">
          <button
            className="text-[10px] font-semibold uppercase tracking-wider text-emerald-900/40 hover:text-emerald-900/60 transition-colors"
            onClick={() => setShowAdvanced(!showAdvanced)}
            type="button"
          >
            {showAdvanced ? "Hide Advanced Settings" : "Show Advanced Settings"}
          </button>

          {showAdvanced && (
            <div className="mt-3 space-y-4">
              <div className="border-t border-emerald-900/10 pt-3">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-medium text-emerald-950/72" htmlFor="sync-days-compact">Sync window</label>
                  <select
                    id="sync-days-compact"
                    className="rounded-lg border border-emerald-200 bg-white/70 px-2 py-1 text-[10px] text-emerald-900 shadow-sm outline-none transition-colors focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400"
                    disabled={savingSync}
                    onChange={(e) => handleSyncDaysChange(Number(e.target.value))}
                    value={syncDays}
                  >
                    <option value={1}>1 Day (Yesterday)</option>
                    <option value={7}>1 Week (Recent)</option>
                    <option value={30}>1 Month</option>
                    <option value={90}>3 Months</option>
                    <option value={180}>6 Months</option>
                  </select>
                </div>
                <p className="mt-1.5 text-[9px] text-emerald-950/50 leading-tight">
                  Timeframe for fetching past messages during handshake.
                </p>
              </div>

              <div className="flex items-center justify-between border-t border-rose-900/10 pt-3">
                <div>
                  <p className="text-[10px] font-medium text-rose-950/72">Danger Zone</p>
                  <p className="text-[9px] text-rose-950/50">Wipe messages & sync fresh</p>
                </div>
                <button
                  className="rounded-lg bg-rose-100 px-2 py-1 text-[10px] font-semibold text-rose-700 transition hover:bg-rose-200 disabled:opacity-50"
                  onClick={handleClearDatabase}
                  disabled={clearingDb}
                >
                  {clearingDb ? "Clearing..." : "Clear"}
                </button>
              </div>
            </div>
          )}
        </div>

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
          {profileIconButton}
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

      {profilePanel}

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
          
          <div className="mt-5 border-t border-emerald-900/10 pt-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-emerald-950/72" htmlFor="sync-days">Sync previous chats</label>
              <select
                id="sync-days"
                className="rounded-lg border border-emerald-200 bg-white/70 px-2.5 py-1.5 text-sm text-emerald-900 shadow-sm outline-none transition-colors focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400"
                disabled={savingSync}
                onChange={(e) => handleSyncDaysChange(Number(e.target.value))}
                value={syncDays}
              >
                <option value={1}>1 Day (Yesterday onward)</option>
                <option value={7}>1 Week (Recent)</option>
                <option value={30}>1 Month</option>
                <option value={90}>3 Months</option>
                <option value={180}>6 Months</option>
                <option value={3650}>All Time</option>
              </select>
            </div>
            <p className="mt-2 text-xs text-emerald-950/50">
              When you link a new device or reconnect, we will fetch past messages within this timeframe.
            </p>
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-rose-900/10 pt-4">
            <div>
              <p className="text-sm font-medium text-rose-950/72">Danger Zone</p>
              <p className="text-xs text-rose-950/50">Wipe all messages & sync fresh</p>
            </div>
            <button 
              className="rounded-lg bg-rose-100 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-200 disabled:opacity-50"
              onClick={handleClearDatabase}
              disabled={clearingDb}
            >
              {clearingDb ? "Clearing..." : "Clear Database"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
