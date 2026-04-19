import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, type WhatsAppProfile, type WhatsAppQr, type WhatsAppStatus } from "../lib/api";

type WhatsAppConnectCardProps = {
  activeWhatsAppNumber?: string | null;
  status: WhatsAppStatus | null;
  qr: WhatsAppQr | null;
  loading: boolean;
  token: string;
  selectedWhatsAppAccountId?: string | null;
  compact?: boolean;
  onCleanupAccounts?: () => Promise<void> | void;
  onDisconnect?: () => void;
  onConnectNew?: () => void;
  connectActionLabel?: string;
  connectingNew?: boolean;
  disconnecting?: boolean;
};

function statusLabel(status: WhatsAppStatus | null) {
  const state = String(status?.state || "").trim().toLowerCase();

  if (status?.connected || state === "open") {
    return "🟢 Connected";
  }

  if (state === "qr") {
    return "🟡 Awaiting QR";
  }

  if (state === "connecting") {
    return "🟡 Connecting";
  }

  if (state === "disconnecting") {
    return "🟠 Disconnecting";
  }

  return "🔴 Not connected";
}

function compactStatusTitle(status: WhatsAppStatus | null) {
  const state = String(status?.state || "").trim().toLowerCase();

  if (status?.connected || state === "open") {
    return "🟢 Connected";
  }

  if (state === "qr") {
    return "🟡 Awaiting QR";
  }

  if (state === "connecting") {
    return "🟡 Connecting";
  }

  if (state === "disconnecting") {
    return "🟠 Disconnecting";
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

function getQrPlaceholderLabel(status: WhatsAppStatus | null, loading: boolean) {
  const state = String(status?.state || "").trim().toLowerCase();

  if (loading || state === "connecting") {
    return "Preparing QR...";
  }

  if (state === "qr" || status?.hasQr) {
    return "Waiting for QR image...";
  }

  return "QR not ready";
}

export function WhatsAppConnectCard({
  activeWhatsAppNumber = null,
  status,
  qr,
  loading,
  token,
  selectedWhatsAppAccountId = null,
  compact = false,
  onCleanupAccounts,
  onDisconnect,
  onConnectNew,
  connectActionLabel,
  connectingNew = false,
  disconnecting = false
}: WhatsAppConnectCardProps) {
  const qrButtonRef = useRef<HTMLButtonElement | null>(null);
  const profileButtonRef = useRef<HTMLButtonElement | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const qrOverlayRef = useRef<HTMLDivElement | null>(null);
  const profilePanelRef = useRef<HTMLDivElement | null>(null);
  const settingsPanelRef = useRef<HTMLDivElement | null>(null);
  const [showProfilePanel, setShowProfilePanel] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profile, setProfile] = useState<WhatsAppProfile | null>(null);
  const [syncDays, setSyncDays] = useState<number>(7);
  const [savingSync, setSavingSync] = useState(false);
  const [clearingDb, setClearingDb] = useState(false);
  const [cleaningAccounts, setCleaningAccounts] = useState(false);
  const [resyncingContactNames, setResyncingContactNames] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showQrOverlay, setShowQrOverlay] = useState(false);
  const [qrOverlayPosition, setQrOverlayPosition] = useState<{ left: number; top: number } | null>(null);
  const [profileOverlayPosition, setProfileOverlayPosition] = useState<{ left: number; top: number } | null>(null);
  const [settingsOverlayPosition, setSettingsOverlayPosition] = useState<{ left: number; top: number } | null>(null);

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

  async function handleCleanupAccounts(e: React.MouseEvent) {
    e.stopPropagation();

    if (!onCleanupAccounts || cleaningAccounts) {
      return;
    }

    setCleaningAccounts(true);
    try {
      await onCleanupAccounts();
    } finally {
      setCleaningAccounts(false);
    }
  }

  async function handleResyncContactNames(e: React.MouseEvent) {
    e.stopPropagation();

    if (resyncingContactNames) {
      return;
    }

    setResyncingContactNames(true);
    try {
      const summary = await api.resyncContactNames(token, selectedWhatsAppAccountId);
      alert(
        `Contact name resync complete.\n\nProcessed contacts: ${summary.processedContacts}\nProcessed chats: ${summary.processedChats}\nCached identities: ${summary.cachedIdentityCount}\nUpserted candidates: ${summary.upsertedCandidates}`
      );
      window.location.reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to resync contact names.");
    } finally {
      setResyncingContactNames(false);
    }
  }

  const shouldShowQrPanel = !status?.connected && (Boolean(qr?.qr) || Boolean(status?.hasQr) || loading);
  const canDisconnect = Boolean(onDisconnect) && Boolean(status?.connected || disconnecting);
  const canConnectNew = Boolean(onConnectNew);
  const canViewProfile = Boolean(status?.connected && token);
  const disconnectLabel = disconnecting ? "Disconnecting WhatsApp" : "Disconnect WhatsApp";
  const connectLabel = connectActionLabel || (connectingNew ? "Starting new connection" : "Connect another number");
  const activeNumberLabel = activeWhatsAppNumber ? formatPhone(activeWhatsAppNumber) : null;
  const qrPlaceholderLabel = getQrPlaceholderLabel(status, loading);

  useEffect(() => {
    if (!showProfilePanel || !canViewProfile) {
      return;
    }

    let cancelled = false;

    async function loadProfile() {
      setProfileLoading(true);
      setProfileError("");

      try {
        const data = await api.getWhatsAppProfile(token, selectedWhatsAppAccountId);
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
  }, [canViewProfile, selectedWhatsAppAccountId, showProfilePanel, token]);

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

  useEffect(() => {
    if (!showProfilePanel) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && profilePanelRef.current && !profilePanelRef.current.contains(target)) {
        setShowProfilePanel(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [showProfilePanel]);

  useEffect(() => {
    if (!showAdvanced) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && settingsPanelRef.current && !settingsPanelRef.current.contains(target)) {
        setShowAdvanced(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [showAdvanced]);

  useLayoutEffect(() => {
    if (!compact || !showQrOverlay) {
      setQrOverlayPosition(null);
      return;
    }

    const gutter = 12;
    const dropdownGap = 10;

    const updatePosition = () => {
      if (!qrButtonRef.current) {
        return;
      }

      const rect = qrButtonRef.current.getBoundingClientRect();
      const overlayWidth = qrOverlayRef.current?.offsetWidth ?? 240;
      const overlayHeight = qrOverlayRef.current?.offsetHeight ?? 0;

      const maxLeft = Math.max(gutter, window.innerWidth - overlayWidth - gutter);
      const desiredLeft = rect.right - overlayWidth;
      const left = Math.min(Math.max(desiredLeft, gutter), maxLeft);

      const desiredTop = rect.bottom + dropdownGap;
      const maxTop = overlayHeight ? Math.max(gutter, window.innerHeight - overlayHeight - gutter) : desiredTop;
      const top = Math.min(Math.max(desiredTop, gutter), maxTop);

      setQrOverlayPosition({ left, top });
    };

    updatePosition();

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [compact, showQrOverlay]);

  useLayoutEffect(() => {
    if (!compact || !showProfilePanel) {
      setProfileOverlayPosition(null);
      return;
    }

    const gutter = 12;
    const dropdownGap = 10;

    const updatePosition = () => {
      if (!profileButtonRef.current) {
        return;
      }

      const rect = profileButtonRef.current.getBoundingClientRect();
      const overlayWidth = profilePanelRef.current?.offsetWidth ?? 420;
      const overlayHeight = profilePanelRef.current?.offsetHeight ?? 0;

      const maxLeft = Math.max(gutter, window.innerWidth - overlayWidth - gutter);
      const desiredLeft = rect.right - overlayWidth;
      const left = Math.min(Math.max(desiredLeft, gutter), maxLeft);

      const desiredTop = rect.bottom + dropdownGap;
      const maxTop = overlayHeight ? Math.max(gutter, window.innerHeight - overlayHeight - gutter) : desiredTop;
      const top = Math.min(Math.max(desiredTop, gutter), maxTop);

      setProfileOverlayPosition({ left, top });
    };

    updatePosition();

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [compact, showProfilePanel]);

  useLayoutEffect(() => {
    if (!compact || !showAdvanced) {
      setSettingsOverlayPosition(null);
      return;
    }

    const gutter = 12;
    const dropdownGap = 10;

    const updatePosition = () => {
      if (!settingsButtonRef.current) {
        return;
      }

      const rect = settingsButtonRef.current.getBoundingClientRect();
      const overlayWidth = settingsPanelRef.current?.offsetWidth ?? 320;
      const overlayHeight = settingsPanelRef.current?.offsetHeight ?? 0;

      const maxLeft = Math.max(gutter, window.innerWidth - overlayWidth - gutter);
      const desiredLeft = rect.right - overlayWidth;
      const left = Math.min(Math.max(desiredLeft, gutter), maxLeft);

      const desiredTop = rect.bottom + dropdownGap;
      const maxTop = overlayHeight ? Math.max(gutter, window.innerHeight - overlayHeight - gutter) : desiredTop;
      const top = Math.min(Math.max(desiredTop, gutter), maxTop);

      setSettingsOverlayPosition({ left, top });
    };

    updatePosition();

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [compact, showAdvanced]);

  const profileIconButton = canViewProfile ? (
    <button
      aria-label={showProfilePanel ? "Hide WhatsApp profile" : "Show WhatsApp profile"}
      className={`icon-hover-trigger flex ${compact ? "h-8 w-8" : "h-10 w-10"} appearance-none items-center justify-center border-0 bg-transparent p-0 text-whatsapp-muted shadow-none outline-none ring-0 transition hover:bg-transparent hover:text-whatsapp-deep focus:bg-transparent ${showProfilePanel ? "text-whatsapp-deep" : ""}`}
      ref={profileButtonRef}
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
      <span className="block text-[10px] font-normal text-gray-500 sm:hidden">Profile</span>
      <span className="icon-hover-label hidden sm:inline">{showProfilePanel ? "Hide WhatsApp profile" : "Show WhatsApp profile"}</span>
    </button>
  ) : null;

  const disconnectIconButton = canDisconnect ? (
    <button
      aria-label={disconnectLabel}
      className={`icon-hover-trigger flex ${compact ? "h-8 w-8" : "h-10 w-10"} appearance-none items-center justify-center border-0 bg-transparent p-0 text-whatsapp-muted shadow-none outline-none ring-0 transition hover:bg-transparent hover:text-rose-700 focus:bg-transparent disabled:cursor-not-allowed disabled:opacity-50`}
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
      <span className="block text-[10px] font-normal text-gray-500 sm:hidden">Disconnect</span>
      <span className="icon-hover-label hidden sm:inline">{disconnectLabel}</span>
    </button>
  ) : null;

  const connectIconButton = canConnectNew ? (
    <button
      aria-label={connectLabel}
      className={`icon-hover-trigger flex ${compact ? "h-8 w-8" : "h-10 w-10"} appearance-none items-center justify-center border-0 bg-transparent p-0 text-whatsapp-muted shadow-none outline-none ring-0 transition hover:bg-transparent hover:text-whatsapp-deep focus:bg-transparent disabled:cursor-not-allowed disabled:opacity-50`}
      disabled={connectingNew}
      onClick={onConnectNew}
      type="button"
    >
      <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
        <path d="M12 5v14M5 12h14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
      </svg>
      <span className="block text-[10px] font-normal text-gray-500 sm:hidden">Connect</span>
      <span className="icon-hover-label hidden sm:inline">{connectLabel}</span>
    </button>
  ) : null;

  const settingsIconButton = (
    <button
      aria-label={showAdvanced ? "Hide WhatsApp settings" : "Show WhatsApp settings"}
      className={`icon-hover-trigger flex h-8 w-8 appearance-none items-center justify-center border-0 bg-transparent p-0 text-whatsapp-muted shadow-none outline-none ring-0 transition hover:bg-transparent hover:text-whatsapp-deep focus:bg-transparent ${showAdvanced ? "text-whatsapp-deep" : ""}`}
      ref={settingsButtonRef}
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
      <span className="block text-[10px] font-normal text-gray-500 sm:hidden">Settings</span>
      <span className="icon-hover-label hidden sm:inline">{showAdvanced ? "Hide WhatsApp settings" : "Show WhatsApp settings"}</span>
    </button>
  );

  const qrIconButton = shouldShowQrPanel ? (
    <button
      aria-label={showQrOverlay ? "Hide WhatsApp QR code" : "Show WhatsApp QR code"}
      className={`icon-hover-trigger flex h-8 w-8 appearance-none items-center justify-center border-0 bg-transparent p-0 text-whatsapp-muted shadow-none outline-none ring-0 transition hover:bg-transparent hover:text-whatsapp-deep focus:bg-transparent ${showQrOverlay ? "text-whatsapp-deep" : ""}`}
      onClick={() => setShowQrOverlay((current) => !current)}
      ref={qrButtonRef}
      type="button"
    >
      <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
        <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
        <path d="M14 14h2v2h-2zM18 14h2v6h-6v-2h4zM14 18h2v2h-2z" fill="currentColor" />
      </svg>
      <span className="block text-[10px] font-normal text-gray-500 sm:hidden">QR</span>
      <span className="icon-hover-label hidden sm:inline">{showQrOverlay ? "Hide WhatsApp QR code" : "Show WhatsApp QR code"}</span>
    </button>
  ) : null;

  const profilePanelContent = (
    <div ref={profilePanelRef} className="whatsapp-popover mt-3 w-full max-w-[420px] max-h-[calc(100dvh-24px)]">
      <div className="whatsapp-popover-content scrollbar-hidden max-h-[calc(100dvh-24px)] space-y-3 overflow-y-auto overscroll-contain">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="whatsapp-popover-kicker">Profile</p>
            <h4 className="whatsapp-popover-title">WhatsApp profile</h4>
            <p className="whatsapp-popover-subtitle truncate">Review the connected account and catalog details.</p>
          </div>
          <span className="whatsapp-popover-pill">{status?.connected ? "Connected" : "Offline"}</span>
        </div>

        {profileLoading ? (
          <div className="whatsapp-popover-card px-3 py-3">
            <p className="text-sm text-whatsapp-muted">Loading WhatsApp profile...</p>
          </div>
        ) : profileError ? (
          <div className="whatsapp-popover-card border-rose-200 bg-rose-50 px-3 py-3">
            <p className="text-sm leading-5 text-rose-700">{profileError}</p>
          </div>
        ) : profile ? (
          <div className="space-y-3">
            <div className="whatsapp-popover-card flex items-center gap-3 p-3">
              {profile.profilePictureUrl ? (
                <img
                  alt={profile.username || profile.phone || "WhatsApp profile"}
                  className="h-14 w-14 rounded-[16px] object-cover shadow-[0_10px_22px_rgba(15,23,42,0.1)]"
                  src={profile.profilePictureUrl}
                />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-[16px] bg-whatsapp-dark text-lg font-semibold text-white shadow-[0_10px_22px_rgba(15,23,42,0.1)]">
                  {(profile.username || profile.phone || "W").slice(0, 1).toUpperCase()}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{profile.username || "WhatsApp account"}</p>
                <p className="mt-1 break-all text-xs text-whatsapp-muted">{formatPhone(profile.phone)}</p>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="whatsapp-popover-card px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-[0.18em] text-whatsapp-muted">Username</p>
                <p className="mt-1 break-words text-sm font-medium text-ink">{profile.username || "Unavailable"}</p>
              </div>
              <div className="whatsapp-popover-card px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-[0.18em] text-whatsapp-muted">Number</p>
                <p className="mt-1 break-all text-sm font-medium text-ink">{formatPhone(profile.phone)}</p>
              </div>
            </div>

            {profile.businessProfile ? (
              <div className="whatsapp-popover-card space-y-3 p-3">
                <div className="grid gap-2 md:grid-cols-2">
                  <div className="whatsapp-popover-card-muted min-w-0 px-3 py-2.5">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-whatsapp-muted">Category</p>
                    <p className="mt-1 break-words text-sm font-medium text-ink">{profile.businessProfile.category || "Unavailable"}</p>
                  </div>
                  <div className="whatsapp-popover-card-muted min-w-0 px-3 py-2.5">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-whatsapp-muted">Email</p>
                    <p className="mt-1 break-all text-sm font-medium text-ink">{profile.businessProfile.email || "Unavailable"}</p>
                  </div>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-whatsapp-muted">Shop description</p>
                  <p className="mt-1 break-words text-sm leading-5 text-ink/80">{profile.businessProfile.description || "Unavailable"}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-whatsapp-muted">Address</p>
                  <p className="mt-1 break-words text-sm leading-5 text-ink/80">{profile.businessProfile.address || "Unavailable"}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.18em] text-whatsapp-muted">Website</p>
                  <p className="mt-1 break-all text-sm leading-5 text-ink/80">
                    {profile.businessProfile.website.length ? profile.businessProfile.website.join(", ") : "Unavailable"}
                  </p>
                </div>
              </div>
            ) : null}

            <div className="whatsapp-popover-card space-y-3 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] uppercase tracking-[0.18em] text-whatsapp-muted">Catalogue / Shop</p>
                <span className="whatsapp-popover-pill">{profile.catalog?.products.length || 0} items</span>
              </div>

              {profile.catalog?.products.length ? (
                <div className="space-y-2">
                  {profile.catalog.products.map((product) => (
                    <div key={product.id} className="flex gap-3 rounded-[16px] border border-white/50 bg-white/72 p-2.5 shadow-[0_8px_18px_rgba(15,23,42,0.05)]">
                      {product.imageUrl ? (
                        <img alt={product.name} className="h-14 w-14 rounded-[12px] object-cover" src={product.imageUrl} />
                      ) : (
                        <div className="flex h-14 w-14 items-center justify-center rounded-[12px] bg-whatsapp-soft text-[10px] font-semibold uppercase text-whatsapp-muted">
                          Shop
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-ink">{product.name}</p>
                        <p className="mt-1 text-xs text-whatsapp-muted">{formatPrice(product.price, product.currency)}</p>
                        {product.description ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink/80">{product.description}</p> : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-whatsapp-muted">No catalogue or shop items are available for this WhatsApp account.</p>
              )}
            </div>
          </div>
        ) : (
          <div className="whatsapp-popover-card px-3 py-3">
            <p className="text-sm text-whatsapp-muted">No WhatsApp profile data is available yet.</p>
          </div>
        )}
      </div>
    </div>
  );

  const settingsPanelContent = (
    <div ref={settingsPanelRef} className="whatsapp-popover mt-2 w-full max-w-[320px] lg:mt-1.5">
      <div className="whatsapp-popover-content space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="whatsapp-popover-kicker">Maintenance</p>
            <h4 className="whatsapp-popover-title">WhatsApp settings</h4>
            <p className="whatsapp-popover-subtitle">Adjust message sync depth and cleanup options.</p>
          </div>
          <span className="whatsapp-popover-pill">Advanced</span>
        </div>

        <div className="whatsapp-popover-card space-y-2 px-3 py-3">
          <div className="flex items-center justify-between gap-2">
            <label className="text-[10px] font-semibold uppercase tracking-[0.18em] text-whatsapp-muted" htmlFor="sync-days-compact">
              Sync window
            </label>
            <select
              id="sync-days-compact"
              className="rounded-[12px] border border-whatsapp-line bg-white px-2.5 py-1.5 text-[10px] text-whatsapp-deep outline-none transition-colors focus:border-whatsapp-dark focus:ring-1 focus:ring-whatsapp-green/20"
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
          <p className="text-[10px] leading-4 text-whatsapp-muted">Timeframe for fetching past messages during handshake.</p>
        </div>

        <div className="whatsapp-popover-card px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-whatsapp-muted">Contact names</p>
              <p className="mt-1 text-[10px] leading-4 text-whatsapp-muted">Re-read cached WhatsApp identities and restore missing contact names.</p>
            </div>
            <button
              className="rounded-[12px] bg-whatsapp-dark px-3 py-2 text-[10px] font-semibold text-white transition hover:bg-whatsapp-deep disabled:opacity-50"
              onClick={handleResyncContactNames}
              disabled={resyncingContactNames}
            >
              {resyncingContactNames ? "Resyncing..." : "Resync names"}
            </button>
          </div>
        </div>

        <div className="whatsapp-popover-card border-rose-200 bg-rose-50 px-3 py-3">
          <div className="mb-3 flex items-center justify-between gap-3 border-b border-rose-200/70 pb-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700">Session cleanup</p>
              <p className="mt-1 text-[10px] leading-4 text-amber-700/90">Remove abandoned and duplicate inbox sources.</p>
            </div>
            <button
              className="rounded-[12px] bg-amber-500 px-3 py-2 text-[10px] font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
              onClick={handleCleanupAccounts}
              disabled={!onCleanupAccounts || cleaningAccounts}
            >
              {cleaningAccounts ? "Cleaning..." : "Clean"}
            </button>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-700">Danger Zone</p>
              <p className="mt-1 text-[10px] leading-4 text-rose-600">Wipe messages and start fresh.</p>
            </div>
            <button
              className="rounded-[12px] bg-rose-600 px-3 py-2 text-[10px] font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50"
              onClick={handleClearDatabase}
              disabled={clearingDb}
            >
              {clearingDb ? "Clearing..." : "Clear"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const profilePanel = showProfilePanel
    ? compact
      ? createPortal(
          <>
            <div aria-hidden="true" className="frost-float-backdrop fixed inset-0 z-[44]" onClick={() => setShowProfilePanel(false)} />
            <div
              className="fixed z-[45] w-[calc(100vw-24px)] max-w-[420px]"
              onClick={(event) => event.stopPropagation()}
              style={profileOverlayPosition ? { left: profileOverlayPosition.left, top: profileOverlayPosition.top } : undefined}
            >
              {profilePanelContent}
            </div>
          </>,
          document.body
        )
      : profilePanelContent
    : null;

  const settingsPanel = showAdvanced
    ? compact
      ? createPortal(
          <>
            <div aria-hidden="true" className="frost-float-backdrop fixed inset-0 z-[44]" onClick={() => setShowAdvanced(false)} />
            <div
              className="fixed z-[45] w-[calc(100vw-24px)] max-w-[320px]"
              onClick={(event) => event.stopPropagation()}
              style={settingsOverlayPosition ? { left: settingsOverlayPosition.left, top: settingsOverlayPosition.top } : undefined}
            >
              {settingsPanelContent}
            </div>
          </>,
          document.body
        )
      : settingsPanelContent
    : null;

  if (compact) {
    return (
      <div className="relative overflow-visible px-1 py-1 sm:px-1.5 sm:py-1 lg:min-w-[210px] lg:px-1.5 lg:py-0.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-[0.2em] text-whatsapp-muted">WhatsApp</p>
            <div className="mt-1 flex min-w-0 items-baseline gap-2">
              <p className="truncate text-sm font-semibold leading-5 text-ink">{compactStatusTitle(status)}</p>
              {activeNumberLabel ? (
                <p className="truncate text-[11px] font-medium text-whatsapp-muted">{activeNumberLabel}</p>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {connectIconButton}
            {profileIconButton}
            {qrIconButton}
            {settingsIconButton}
            {disconnectIconButton}
          </div>
        </div>

        {showQrOverlay ? (
          createPortal(
            <>
              <div
                aria-hidden="true"
                className="frost-float-backdrop fixed inset-0 z-[44]"
                onClick={() => setShowQrOverlay(false)}
              />
              <div
                ref={qrOverlayRef}
                className="frost-float qr-float fixed z-[45] w-[220px] overflow-hidden rounded-[18px] p-1 sm:w-[240px]"
                onClick={(event) => event.stopPropagation()}
                style={qrOverlayPosition ? { left: qrOverlayPosition.left, top: qrOverlayPosition.top } : undefined}
              >
                <div className="relative flex items-center justify-between gap-2 px-0.5 pt-0.5">
                  <div className="flex items-center gap-2">
                    <span className="h-1 w-1 rounded-full bg-whatsapp-green/45 shadow-[0_0_0_4px_rgba(18,140,126,0.03)]" />
                    <p className="text-[9px] font-medium uppercase tracking-[0.22em] text-whatsapp-muted/60">WhatsApp QR</p>
                  </div>
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

                <div className="relative mt-1.5 flex justify-center">
                  {qr?.qr ? (
                    <div className="rounded-[14px] bg-white/14 p-0.5">
                      <img alt="WhatsApp QR code" className="h-44 w-44 max-w-full rounded-[11px] bg-white/97 p-1 object-contain" src={qr.qr} />
                    </div>
                  ) : (
                    <div className="flex h-44 w-44 max-w-full items-center justify-center rounded-[11px] border border-dashed border-white/15 bg-white/14 px-3 text-center text-[11px] leading-4 text-whatsapp-muted">
                      {qrPlaceholderLabel}
                    </div>
                  )}
                </div>
              </div>
            </>,
            document.body
          )
        ) : null}

        {profilePanel}

        {settingsPanel}

      </div>
    );
  }

  return (
    <div className="glass-panel p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-whatsapp-muted">WhatsApp</p>
          <h3 className="mt-1.5 text-xl font-semibold text-ink">{status?.connected ? "🟢 Connected" : "🔴 Not connected"}</h3>
          {activeNumberLabel ? (
            <p className="mt-1 text-sm font-medium text-whatsapp-muted">{activeNumberLabel}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {connectIconButton}
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
              {qrPlaceholderLabel}
            </div>
          ) : (
            <div className="text-center text-sm text-whatsapp-muted">
              {qrPlaceholderLabel}
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
              className="w-full rounded-xl bg-rose-600 py-3 text-base font-bold text-white shadow transition active:bg-rose-700 disabled:opacity-60 disabled:cursor-not-allowed"
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
