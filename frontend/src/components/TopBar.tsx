import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, type UserProfile, type WhatsAppQr, type WhatsAppStatus } from "../lib/api";
import { supabase } from "../lib/supabase";
import { WhatsAppConnectCard } from "./WhatsAppConnectCard";

type DashboardTab = "inbox" | "contacts" | "sales";

type NavigationItem = {
  key: DashboardTab | "analytics" | "settings";
  label: string;
  disabled?: boolean;
};

const navItems: NavigationItem[] = [
  { key: "inbox", label: "Inbox" },
  { key: "contacts", label: "Contacts" },
  { key: "sales", label: "Sales" },
  { key: "settings", label: "Settings", disabled: true }
];

type TopBarProps = {
  activeTab: DashboardTab;
  activeWhatsAppNumber?: string | null;
  connectingNewWhatsApp: boolean;
  disconnectingWhatsApp: boolean;
  loadingWhatsApp: boolean;
  onChangeTab: (tab: DashboardTab) => void;
  onCleanupWhatsAppAccounts: () => Promise<void> | void;
  connectActionLabel?: string;
  onConnectNewWhatsApp: () => void;
  onDisconnectWhatsApp: () => void;
  onLogout: () => void;
  selectedWhatsAppAccountId?: string | null;
  token: string;
  userEmail: string;
  whatsAppQr: WhatsAppQr | null;
  whatsAppStatus: WhatsAppStatus | null;
};

export function TopBar({
  activeTab,
  activeWhatsAppNumber = null,
  connectingNewWhatsApp,
  disconnectingWhatsApp,
  loadingWhatsApp,
  onChangeTab,
  onCleanupWhatsAppAccounts,
  connectActionLabel,
  onConnectNewWhatsApp,
  onDisconnectWhatsApp,
  onLogout,
  selectedWhatsAppAccountId = null,
  token,
  userEmail,
  whatsAppQr,
  whatsAppStatus
}: TopBarProps) {
  const passwordPanelRef = useRef<HTMLDivElement | null>(null);
  const passwordButtonRef = useRef<HTMLButtonElement | null>(null);
  const profilePanelRef = useRef<HTMLDivElement | null>(null);
  const profileButtonRef = useRef<HTMLButtonElement | null>(null);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [showProfilePanel, setShowProfilePanel] = useState(false);
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [passwordPanelPosition, setPasswordPanelPosition] = useState<{ left: number; top: number } | null>(null);
  const [profilePanelPosition, setProfilePanelPosition] = useState<{ left: number; top: number } | null>(null);

  async function handleChangePassword() {
    const trimmedPassword = nextPassword.trim();

    setPasswordError("");
    setPasswordSuccess("");

    if (trimmedPassword.length < 6) {
      setPasswordError("Password must be at least 6 characters.");
      return;
    }

    if (trimmedPassword !== confirmPassword.trim()) {
      setPasswordError("Passwords do not match.");
      return;
    }

    setPasswordSaving(true);

    try {
      const { error } = await supabase.auth.updateUser({ password: trimmedPassword });

      if (error) {
        throw error;
      }

      setNextPassword("");
      setConfirmPassword("");
      setPasswordSuccess("Password updated successfully.");
      setShowPasswordForm(false);
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : "Failed to update password.");
    } finally {
      setPasswordSaving(false);
    }
  }

  useEffect(() => {
    if (!showPasswordForm) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && passwordPanelRef.current && !passwordPanelRef.current.contains(target)) {
        setShowPasswordForm(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [showPasswordForm]);

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

  useLayoutEffect(() => {
    if (!showPasswordForm) {
      setPasswordPanelPosition(null);
      return;
    }

    const gutter = 12;
    const dropdownGap = 10;

    const updatePosition = () => {
      if (!passwordButtonRef.current) {
        return;
      }

      const rect = passwordButtonRef.current.getBoundingClientRect();
      const overlayWidth = passwordPanelRef.current?.offsetWidth ?? 360;
      const overlayHeight = passwordPanelRef.current?.offsetHeight ?? 0;

      const maxLeft = Math.max(gutter, window.innerWidth - overlayWidth - gutter);
      const desiredLeft = rect.right - overlayWidth;
      const left = Math.min(Math.max(desiredLeft, gutter), maxLeft);

      const desiredTop = rect.bottom + dropdownGap;
      const maxTop = overlayHeight ? Math.max(gutter, window.innerHeight - overlayHeight - gutter) : desiredTop;
      const top = Math.min(Math.max(desiredTop, gutter), maxTop);

      setPasswordPanelPosition({ left, top });
    };

    updatePosition();

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [showPasswordForm]);

  useLayoutEffect(() => {
    if (!showProfilePanel) {
      setProfilePanelPosition(null);
      return;
    }

    const gutter = 12;
    const dropdownGap = 10;

    const updatePosition = () => {
      if (!profileButtonRef.current) {
        return;
      }

      const rect = profileButtonRef.current.getBoundingClientRect();
      const overlayWidth = profilePanelRef.current?.offsetWidth ?? 360;
      const overlayHeight = profilePanelRef.current?.offsetHeight ?? 0;

      const maxLeft = Math.max(gutter, window.innerWidth - overlayWidth - gutter);
      const desiredLeft = rect.right - overlayWidth;
      const left = Math.min(Math.max(desiredLeft, gutter), maxLeft);

      const desiredTop = rect.bottom + dropdownGap;
      const maxTop = overlayHeight ? Math.max(gutter, window.innerHeight - overlayHeight - gutter) : desiredTop;
      const top = Math.min(Math.max(desiredTop, gutter), maxTop);

      setProfilePanelPosition({ left, top });
    };

    updatePosition();

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [showProfilePanel]);

  useEffect(() => {
    if (!showProfilePanel) {
      return;
    }

    let cancelled = false;

    async function loadProfile() {
      setProfileLoading(true);
      setProfileError("");

      try {
        const nextProfile = await api.getMyProfile(token);
        if (!cancelled) {
          setProfile(nextProfile);
        }
      } catch (error) {
        if (!cancelled) {
          setProfileError(error instanceof Error ? error.message : "Failed to load profile.");
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
  }, [showProfilePanel, token]);

  const profileDisplayName = profile?.full_name?.trim() || userEmail.split("@")[0] || "User";
  const profileInitial = profileDisplayName.slice(0, 1).toUpperCase();
  const profileLastSeen = profile?.last_sign_in_at
    ? new Date(profile.last_sign_in_at).toLocaleString([], {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      })
    : "Unavailable";

  return (
    <div className="glass-panel flex flex-col gap-1.5 p-2 lg:flex-row lg:items-start lg:justify-between lg:gap-4 lg:px-4 lg:py-2.5">
      <div className="flex flex-col gap-1.5 lg:min-w-0 lg:flex-1">
        <nav className="flex flex-wrap items-center gap-1 sm:gap-1.5">
          {navItems.map((item) => (
            <button
              aria-label={item.label}
              key={item.key}
              className={`icon-hover-trigger inline-flex h-8 w-8 items-center justify-center rounded-lg p-0 text-sm font-semibold leading-none transition-all duration-200 sm:h-10 sm:w-auto sm:gap-2 sm:px-3 sm:py-0 lg:h-9 lg:px-2.5 ${
                activeTab === item.key
                  ? "bg-[#f0f2f5] text-whatsapp-deep"
                  : item.disabled
                    ? "cursor-not-allowed text-whatsapp-muted/60"
                    : "text-whatsapp-muted hover:bg-[#f5f6f6] hover:text-whatsapp-deep"
              }`}
              disabled={item.disabled}
              onClick={() => {
                if (item.key === "inbox" || item.key === "contacts" || item.key === "sales") {
                  onChangeTab(item.key as DashboardTab);
                }
              }}
              type="button"
            >
              {getItemIcon(item.label)}
              <span className="icon-hover-label sm:hidden">{item.label}</span>
              <span className="hidden sm:inline">{item.label}</span>
            </button>
          ))}
        </nav>
      </div>

      <div className="flex w-full flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-end sm:gap-3 lg:w-auto lg:shrink-0 lg:self-start">
        <div className="flex w-full items-start gap-1.5 sm:w-auto">
          <WhatsAppConnectCard
            activeWhatsAppNumber={activeWhatsAppNumber}
            compact
            connectingNew={connectingNewWhatsApp}
            connectActionLabel={connectActionLabel}
            disconnecting={disconnectingWhatsApp}
            loading={loadingWhatsApp}
            onCleanupAccounts={onCleanupWhatsAppAccounts}
            onConnectNew={onConnectNewWhatsApp}
            onDisconnect={onDisconnectWhatsApp}
            qr={whatsAppQr}
            selectedWhatsAppAccountId={selectedWhatsAppAccountId}
            status={whatsAppStatus}
            token={token}
          />
        </div>

        <div className="lg:min-w-[220px] lg:self-start">
          <div className="flex items-start justify-between gap-1.5 sm:gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase tracking-[0.2em] text-whatsapp-muted">Signed in</p>
              <div className="mt-0.5 flex min-w-0 flex-col items-start gap-0.5 sm:mt-1 sm:flex-row sm:items-baseline sm:gap-2">
                <p className="truncate text-[15px] font-semibold text-ink sm:text-sm">{profile?.full_name || userEmail}</p>
                {profile?.organization?.name ? (
                  <p className="truncate text-[11px] text-whatsapp-muted sm:hidden">{profile.organization.name}</p>
                ) : null}
                {profile?.organization?.name || profile?.role ? (
                  <p className="hidden truncate text-[11px] text-whatsapp-muted sm:block">
                    {[profile?.organization?.name || null, profile?.role ? profile.role.replace(/_/g, " ") : null].filter(Boolean).join(" | ")}
                  </p>
                ) : null}
              </div>
              {profile?.full_name ? <p className="truncate text-[11px] text-whatsapp-muted">{userEmail}</p> : null}
            </div>
            <div className="grid w-[84px] shrink-0 grid-cols-3 justify-items-center gap-0.5 sm:flex sm:w-auto sm.items-center sm:gap-1">
              <button
                aria-label={showProfilePanel ? "Hide profile" : "Show profile"}
                className="icon-hover-trigger flex h-8 w-8 appearance-none items-center justify-center border-0 bg-transparent p-0 text-whatsapp-muted shadow-none outline-none ring-0 transition hover:bg-transparent hover:text-whatsapp-deep focus:bg-transparent"
                ref={profileButtonRef}
                onClick={() => {
                  setShowProfilePanel((current) => !current);
                  setShowPasswordForm(false);
                  setProfileError("");
                }}
                type="button"
              >
                <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16">
                  <path
                    d="M20 21a8 8 0 1 0-16 0M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                  />
                </svg>
                <span className="hidden text-[10px] font-normal text-gray-500 sm:hidden">Profile</span>
                <span className="icon-hover-label hidden sm:inline">Profile</span>
              </button>

              <button
                aria-label={showPasswordForm ? "Hide change password form" : "Show change password form"}
                className="icon-hover-trigger flex h-8 w-8 appearance-none items-center justify-center border-0 bg-transparent p-0 text-whatsapp-muted shadow-none outline-none ring-0 transition hover:bg-transparent hover:text-whatsapp-deep focus:bg-transparent"
                ref={passwordButtonRef}
                onClick={() => {
                  setShowPasswordForm((current) => !current);
                  setShowProfilePanel(false);
                  setPasswordError("");
                  setPasswordSuccess("");
                }}
                type="button"
              >
                <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16">
                  <path
                    d="M16 10V7a4 4 0 1 0-8 0v3M7 21h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2Z"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                  />
                </svg>
                <span className="hidden text-[10px] font-normal text-gray-500 sm:hidden">Change</span>
                <span className="icon-hover-label hidden sm:inline">Change password</span>
              </button>

              <button
                aria-label="Logout"
                className="icon-hover-trigger flex h-8 w-8 appearance-none items-center justify-center border-0 bg-transparent p-0 text-whatsapp-muted shadow-none outline-none ring-0 transition hover:bg-transparent hover:text-whatsapp-deep focus:bg-transparent"
                onClick={onLogout}
                type="button"
              >
                <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16">
                  <path
                    d="M15 7V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-2M10 12h10m0 0-3-3m3 3-3 3"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                  />
                </svg>
                <span className="hidden text-[10px] font-normal text-gray-500 sm:hidden">Logout</span>
                <span className="icon-hover-label hidden sm:inline">Logout</span>
              </button>
            </div>
          </div>

          {(showProfilePanel || showPasswordForm)
            ? createPortal(
                <>
                  <div
                    aria-hidden="true"
                    className="frost-float-backdrop fixed inset-0 z-[44]"
                    onClick={() => {
                      setShowPasswordForm(false);
                      setShowProfilePanel(false);
                    }}
                  />
                  {showProfilePanel ? (
                    <div
                      ref={profilePanelRef}
                      className="whatsapp-popover fixed z-[45] w-[calc(100vw-24px)] max-w-[360px]"
                      onClick={(event) => event.stopPropagation()}
                      style={profilePanelPosition ? { left: profilePanelPosition.left, top: profilePanelPosition.top } : undefined}
                    >
                      <div className="whatsapp-popover-content space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="whatsapp-popover-kicker">Account profile</p>
                            <h4 className="whatsapp-popover-title">Dashboard account</h4>
                            <p className="whatsapp-popover-subtitle truncate">Loaded from public.profiles.</p>
                          </div>
                          <span className="whatsapp-popover-pill">Synced</span>
                        </div>

                        {profileLoading ? (
                          <p className="text-sm text-whatsapp-muted">Loading profile...</p>
                        ) : profileError ? (
                          <p className="whatsapp-popover-card border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">{profileError}</p>
                        ) : (
                          <>
                            <div className="flex items-center gap-3 rounded-[18px] border border-white/70 bg-white/80 p-3">
                              {profile?.avatar_url ? (
                                <img alt={profileDisplayName} className="h-12 w-12 rounded-2xl object-cover" src={profile.avatar_url} />
                              ) : (
                                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#e7f5ee] text-base font-semibold text-whatsapp-deep">
                                  {profileInitial}
                                </div>
                              )}
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-ink">{profileDisplayName}</p>
                                <p className="truncate text-xs text-whatsapp-muted">{profile?.email || userEmail}</p>
                              </div>
                            </div>

                            <div className="grid gap-2 sm:grid-cols-2">
                              <div className="whatsapp-popover-card px-3 py-2.5">
                                <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-whatsapp-muted">Profile ID</p>
                                <p className="mt-1.5 break-all text-[13px] font-medium leading-5 text-ink">{profile?.id || "Unavailable"}</p>
                              </div>
                              <div className="whatsapp-popover-card px-3 py-2.5">
                                <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-whatsapp-muted">Last sign in</p>
                                <p className="mt-1.5 text-[13px] font-medium leading-5 text-ink">{profileLastSeen}</p>
                              </div>
                              <div className="whatsapp-popover-card px-3 py-2.5">
                                <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-whatsapp-muted">Role</p>
                                <p className="mt-1.5 text-[13px] font-medium capitalize leading-5 text-ink">{(profile?.role || "user").replace(/_/g, " ")}</p>
                              </div>
                              <div className="whatsapp-popover-card px-3 py-2.5">
                                <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-whatsapp-muted">Organization</p>
                                <p className="mt-1.5 text-[13px] font-medium leading-5 text-ink">{profile?.organization?.name || "Default Organization"}</p>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  ) : null}
                  <div
                    ref={passwordPanelRef}
                    className="whatsapp-popover fixed z-[45] w-[calc(100vw-24px)] max-w-[360px]"
                    onClick={(event) => event.stopPropagation()}
                    style={passwordPanelPosition ? { left: passwordPanelPosition.left, top: passwordPanelPosition.top } : undefined}
                  >
                    <div className="whatsapp-popover-content space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="whatsapp-popover-kicker">Security</p>
                          <h4 className="whatsapp-popover-title">Change password</h4>
                          <p className="whatsapp-popover-subtitle truncate">Update the password for {userEmail}.</p>
                        </div>
                        <span className="whatsapp-popover-pill">Protected</span>
                      </div>

                      <div className="space-y-2">
                        <input
                          className="input-glass rounded-[14px] border-white/10 bg-white/85"
                          onChange={(event) => setNextPassword(event.target.value)}
                          placeholder="New password"
                          type="password"
                          value={nextPassword}
                        />
                        <input
                          className="input-glass rounded-[14px] border-white/10 bg-white/85"
                          onChange={(event) => setConfirmPassword(event.target.value)}
                          placeholder="Confirm new password"
                          type="password"
                          value={confirmPassword}
                        />
                      </div>

                      {passwordError ? (
                        <p className="whatsapp-popover-card border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">{passwordError}</p>
                      ) : null}

                      {passwordSuccess ? (
                        <p className="whatsapp-popover-card px-3 py-2 text-xs leading-5 text-whatsapp-dark">{passwordSuccess}</p>
                      ) : null}

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          className="primary-button w-full justify-center rounded-[14px] py-3 text-sm font-semibold"
                          disabled={passwordSaving}
                          onClick={handleChangePassword}
                          type="button"
                        >
                          {passwordSaving ? "Saving..." : "Update password"}
                        </button>
                        <button
                          className="secondary-button w-full rounded-[14px] px-3 py-3 text-sm font-semibold"
                          onClick={() => {
                            setShowPasswordForm(false);
                            setNextPassword("");
                            setConfirmPassword("");
                            setPasswordError("");
                            setPasswordSuccess("");
                          }}
                          type="button"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                </>,
                document.body
              )
            : passwordSuccess ? (
                <p className="whatsapp-popover mt-3 w-full max-w-[360px] px-3 py-2 text-xs text-whatsapp-dark">{passwordSuccess}</p>
              )
            : null}
        </div>
      </div>
    </div>
  );
}

function getItemIcon(label: string) {
  switch (label) {
    case "Inbox":
      return (
        <svg fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
      );
    case "Contacts":
      return (
        <svg fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case "Sales":
      return (
        <svg fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16">
          <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
          <path d="M14 2v6h6" />
          <path d="M9 12h6" />
          <path d="M9 16h6" />
        </svg>
      );
    case "Settings":
      return (
        <svg fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33 1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      );
    default:
      return null;
  }
}

