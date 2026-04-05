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
  return status?.connected ? "🟢 Connected" : "🔴 Not connected";
}

function compactStatusTitle(status: WhatsAppStatus | null, loading: boolean) {
  if (status?.connected) {
    return "🟢 Connected";
  }

  return "🔴 Not connected";
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
  const [showQrOverlay, setShowQrOverlay] = useState(false);

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

  useEffect(() => {
    if (!shouldShowQrPanel) {
      setShowQrOverlay(false);
    }
  }, [shouldShowQrPanel]);

  const profileIconButton = canViewProfile ? (
    <button
      aria-label={showProfilePanel ? "Hide WhatsApp profile" : "Show WhatsApp profile"}
      className={`icon-hover-trigger flex h-10 w-10 appearance-none items-center justify-center border-0 bg-transparent p-0 text-whatsapp-muted shadow-none outline-none ring-0 transition hover:bg-transparent hover:text-whatsapp-deep focus:bg-transparent ${showProfilePanel ? "text-whatsapp-deep" : ""}`}
      onClick={() => setShowProfilePanel((current) => !current)}
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
      <span className="icon-hover-label">{showProfilePanel ? "Hide WhatsApp profile" : "Show WhatsApp profile"}</span>
    </button>
  ) : null;

  const disconnectIconButton = canDisconnect ? (
    <button
      aria-label={disconnectLabel}
      className="icon-hover-trigger flex h-10 w-10 appearance-none items-center justify-center border-0 bg-transparent p-0 text-whatsapp-muted shadow-none outline-none ring-0 transition hover:bg-transparent hover:text-rose-700 focus:bg-transparent disabled:cursor-not-allowed disabled:opacity-50"
      disabled={disconnecting}
      onClick={onDisconnect}
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
      <span className="icon-hover-label">{disconnectLabel}</span>
    </button>
  ) : null;

  const settingsIconButton = (
    <button
      aria-label={showAdvanced ? "Hide WhatsApp settings" : "Show WhatsApp settings"}
      className={`icon-hover-trigger flex h-8 w-8 appearance-none items-center justify-center border-0 bg-transparent p-0 text-whatsapp-muted shadow-none outline-none ring-0 transition hover:bg-transparent hover:text-whatsapp-deep focus:bg-transparent ${showAdvanced ? "text-whatsapp-deep" : ""}`}
      onClick={() => setShowAdvanced((current) => !current)}
      type="button"
    >
      <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
        <path
          d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33 1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      </svg>
      <span className="icon-hover-label">{showAdvanced ? "Hide WhatsApp settings" : "Show WhatsApp settings"}</span>
    </button>
  );

  const qrIconButton = shouldShowQrPanel ? (
    <button
      aria-label={showQrOverlay ? "Hide WhatsApp QR code" : "Show WhatsApp QR code"}
      className={`icon-hover-trigger flex h-8 w-8 appearance-none items-center justify-center border-0 bg-transparent p-0 text-whatsapp-muted shadow-none outline-none ring-0 transition hover:bg-transparent hover:text-whatsapp-deep focus:bg-transparent ${showQrOverlay ? "text-whatsapp-deep" : ""}`}
      onClick={() => setShowQrOverlay((current) => !current)}
      type="button"
    >
      <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
        <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
        <path d="M14 14h2v2h-2zM18 14h2v6h-6v-2h4zM14 18h2v2h-2z" fill="currentColor" />
      </svg>
      <span className="icon-hover-label">{showQrOverlay ? "Hide WhatsApp QR code" : "Show WhatsApp QR code"}</span>
    </button>
  ) : null;

  const profilePanel = showProfilePanel ? (
    <div className="mt-3 rounded-[24px] border border-whatsapp-line bg-white p-3 shadow-soft">
      {profileLoading ? (
        <p className="text-sm text-whatsapp-muted">Loading WhatsApp profile...</p>
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
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-whatsapp-dark text-lg font-semibold text-white shadow-soft">
                {(profile.username || profile.phone || "W").slice(0, 1).toUpperCase()}
              </div>
            )}

            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{profile.username || "WhatsApp account"}</p>
              <p className="mt-1 break-all text-xs text-whatsapp-muted">{formatPhone(profile.phone)}</p>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="min-w-0 rounded-[18px] border border-whatsapp-line bg-whatsapp-canvas px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.18em] text-whatsapp-muted">Username</p>
              <p className="mt-1 break-words text-sm font-medium text-ink">{profile.username || "Unavailable"}</p>
            </div>
            <div className="min-w-0 rounded-[18px] border border-whatsapp-line bg-whatsapp-canvas px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.18em] text-whatsapp-muted">Number</p>
              <p className="mt-1 break-all text-sm font-medium text-ink">{formatPhone(profile.phone)}</p>
            </div>
          </div>

          {profile.businessProfile ? (
            <div className="rounded-[18px] border border-whatsapp-line bg-whatsapp-canvas p-3">
              <div className="grid gap-2 md:grid-cols-2">
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-whatsapp-muted">Category</p>
                  <p className="mt-1 break-words text-sm font-medium text-ink">{profile.businessProfile.category || "Unavailable"}</p>
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-whatsapp-muted">Email</p>
                  <p className="mt-1 break-all text-sm font-medium text-ink">{profile.businessProfile.email || "Unavailable"}</p>
                </div>
              </div>
              <div className="mt-2">
                <p className="text-[10px] uppercase tracking-[0.18em] text-whatsapp-muted">Shop description</p>
                <p className="mt-1 break-words text-sm text-ink/80">{profile.businessProfile.description || "Unavailable"}</p>
              </div>
              <div className="mt-2">
                <p className="text-[10px] uppercase tracking-[0.18em] text-whatsapp-muted">Address</p>
                <p className="mt-1 break-words text-sm text-ink/80">{profile.businessProfile.address || "Unavailable"}</p>
              </div>
              <div className="mt-2">
                <p className="text-[10px] uppercase tracking-[0.18em] text-whatsapp-muted">Website</p>
                <p className="mt-1 break-all text-sm text-ink/80">
                  {profile.businessProfile.website.length ? profile.businessProfile.website.join(", ") : "Unavailable"}
                </p>
              </div>
            </div>
          ) : null}

          <div className="rounded-[18px] border border-whatsapp-line bg-whatsapp-canvas p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] uppercase tracking-[0.18em] text-whatsapp-muted">Catalogue / Shop</p>
              <span className="rounded-full border border-whatsapp-line bg-white px-2 py-1 text-[10px] font-semibold text-whatsapp-muted">
                {profile.catalog?.products.length || 0} items
              </span>
            </div>

            {profile.catalog?.products.length ? (
              <div className="mt-3 space-y-2">
                {profile.catalog.products.map((product) => (
                  <div key={product.id} className="flex gap-3 rounded-[18px] border border-whatsapp-line bg-white p-2.5">
                    {product.imageUrl ? (
                      <img alt={product.name} className="h-14 w-14 rounded-2xl object-cover" src={product.imageUrl} />
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-whatsapp-soft text-[10px] font-semibold uppercase text-whatsapp-muted">
                        Shop
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">{product.name}</p>
                      <p className="mt-1 text-xs text-whatsapp-muted">{formatPrice(product.price, product.currency)}</p>
                      {product.description ? <p className="mt-1 line-clamp-2 text-xs text-ink/80">{product.description}</p> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm text-whatsapp-muted">No catalogue or shop items are available for this WhatsApp account.</p>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-whatsapp-muted">No WhatsApp profile data is available yet.</p>
      )}
    </div>
  ) : null;

  if (compact) {
    return (
      <div className="relative overflow-visible px-1 py-2 sm:p-2 lg:min-w-[210px] lg:px-2 lg:py-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.2em] text-whatsapp-muted">WhatsApp</p>
            <p className="mt-1 text-sm font-semibold leading-5 text-ink">{compactStatusTitle(status, loading)}</p>
          </div>
          <div className="flex items-center gap-1">
            {profileIconButton}
            {qrIconButton}
            {settingsIconButton}
            {disconnectIconButton}
          </div>
        </div>

        {showQrOverlay ? (
          <div className="absolute right-0 top-0 z-40 w-[220px] rounded-[22px] border border-whatsapp-line bg-white/95 p-3 shadow-soft backdrop-blur sm:w-[240px]">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-whatsapp-muted">WhatsApp QR</p>
              <button
                aria-label="Close WhatsApp QR code"
                className="icon-hover-trigger flex h-7 w-7 appearance-none items-center justify-center border-0 bg-transparent p-0 text-whatsapp-muted shadow-none outline-none ring-0 transition hover:bg-transparent hover:text-whatsapp-deep focus:bg-transparent"
                onClick={() => setShowQrOverlay(false)}
                type="button"
              >
                <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
                  <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
                </svg>
                <span className="icon-hover-label">Close WhatsApp QR code</span>
              </button>
            </div>

            <div className="mt-2 flex justify-center">
              {qr?.qr ? (
                <img alt="WhatsApp QR code" className="h-40 w-40 max-w-full rounded-xl bg-white p-2 object-contain" src={qr.qr} />
              ) : (
                <div className="flex h-40 w-40 max-w-full items-center justify-center rounded-xl bg-white px-3 text-center text-[11px] leading-4 text-whatsapp-muted">
                  QR not ready
                </div>
              )}
            </div>
          </div>
        ) : null}

        {profilePanel}

        {showAdvanced && (
          <div className="mt-2 border-t border-whatsapp-line pt-2 lg:mt-1.5 lg:border-t-0 lg:pt-1.5">
            <div className="space-y-3">
              <div className="border-t border-whatsapp-line pt-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-medium text-whatsapp-deep" htmlFor="sync-days-compact">Sync window</label>
                  <select
                    id="sync-days-compact"
                    className="rounded-lg border border-whatsapp-line bg-white px-2 py-1 text-[10px] text-whatsapp-deep shadow-sm outline-none transition-colors focus:border-whatsapp-dark focus:ring-1 focus:ring-whatsapp-green/20"
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
                <p className="mt-1.5 text-[9px] text-whatsapp-muted leading-tight">
                  Timeframe for fetching past messages during handshake.
                </p>
              </div>

              <div className="flex items-center justify-between border-t border-rose-900/10 pt-2.5">
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
          </div>
        )}

      </div>
    );
  }

  return (
    <div className="glass-panel p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-whatsapp-muted">WhatsApp</p>
          <h3 className="mt-1.5 text-xl font-semibold text-ink">{status?.connected ? "🟢 Connected" : "🔴 Not connected"}</h3>
        </div>
        <div className="flex items-center gap-2">
          {profileIconButton}
          {disconnectIconButton}
        </div>
      </div>

      {profilePanel}

      <div className="mt-3 flex flex-col items-center justify-center p-2 md:flex-row md:items-center md:justify-between">
        <div className="flex min-h-[220px] w-full max-w-[240px] items-center justify-center p-2">
          {qr?.qr ? (
            <img alt="WhatsApp QR code" className="h-48 w-48 max-w-full rounded-2xl bg-white p-2 object-contain" src={qr.qr} />
          ) : status?.connected ? (
            <div className="text-center text-sm font-medium text-whatsapp-dark" />
          ) : status?.hasQr || loading ? (
            <div className="text-center text-sm text-whatsapp-muted">
              QR not ready
            </div>
          ) : (
            <div className="text-center text-sm text-whatsapp-muted">
              QR not ready
            </div>
          )}
        </div>

        <div className="mt-4 max-w-sm md:mt-0 md:pl-5">
          <div className="mt-5 border-t border-whatsapp-line pt-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-whatsapp-deep" htmlFor="sync-days">Sync previous chats</label>
              <select
                id="sync-days"
                className="rounded-lg border border-whatsapp-line bg-white px-2.5 py-1.5 text-sm text-whatsapp-deep shadow-sm outline-none transition-colors focus:border-whatsapp-dark focus:ring-1 focus:ring-whatsapp-green/20"
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
            <p className="mt-2 text-xs text-whatsapp-muted">
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
