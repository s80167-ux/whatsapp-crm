import { useState } from "react";
import { type WhatsAppQr, type WhatsAppStatus } from "../lib/api";
import { supabase } from "../lib/supabase";
import { WhatsAppConnectCard } from "./WhatsAppConnectCard";

type DashboardTab = "inbox" | "contacts";

type NavigationItem = {
  key: DashboardTab | "analytics" | "settings";
  label: string;
  disabled?: boolean;
};

const navItems: NavigationItem[] = [
  { key: "inbox", label: "Inbox" },
  { key: "contacts", label: "Contacts" },
  { key: "analytics", label: "Sales", disabled: true },
  { key: "settings", label: "Settings", disabled: true }
];

type TopBarProps = {
  activeTab: DashboardTab;
  disconnectingWhatsApp: boolean;
  loadingWhatsApp: boolean;
  onChangeTab: (tab: DashboardTab) => void;
  onDisconnectWhatsApp: () => void;
  onLogout: () => void;
  token: string;
  userEmail: string;
  whatsAppQr: WhatsAppQr | null;
  whatsAppStatus: WhatsAppStatus | null;
};

export function TopBar({
  activeTab,
  disconnectingWhatsApp,
  loadingWhatsApp,
  onChangeTab,
  onDisconnectWhatsApp,
  onLogout,
  token,
  userEmail,
  whatsAppQr,
  whatsAppStatus
}: TopBarProps) {
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);

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

  return (
    <div className="glass-panel flex flex-col gap-2 p-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4 lg:px-4 lg:py-2.5">
      <div className="flex flex-col gap-2 lg:min-w-0 lg:flex-1">
        <nav className="flex flex-wrap items-center gap-1 sm:gap-1.5">
          {navItems.map((item) => (
            <button
              aria-label={item.label}
              key={item.key}
              className={`icon-hover-trigger flex h-9 w-9 items-center justify-center rounded-lg p-0 text-sm font-semibold transition-all duration-200 sm:h-auto sm:w-auto sm:gap-2 sm:px-3 sm:py-2 lg:px-2.5 lg:py-1.5 ${
                activeTab === item.key
                  ? "bg-[#f0f2f5] text-whatsapp-deep"
                  : item.disabled
                  ? "cursor-not-allowed text-whatsapp-muted/60"
                  : "text-whatsapp-muted hover:bg-[#f5f6f6] hover:text-whatsapp-deep"
              }`}
              disabled={item.disabled}
              onClick={() => {
                if (item.key === "inbox" || item.key === "contacts") {
                  onChangeTab(item.key);
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

      <div className="w-full divide-y divide-whatsapp-line/70 sm:grid sm:grid-cols-2 sm:gap-2 sm:divide-y-0 lg:w-auto lg:min-w-[420px] lg:shrink-0">
        <WhatsAppConnectCard
          compact
          disconnecting={disconnectingWhatsApp}
          loading={loadingWhatsApp}
          onDisconnect={onDisconnectWhatsApp}
          qr={whatsAppQr}
          status={whatsAppStatus}
          token={token}
        />

        <div className="px-1 py-2 sm:p-2 lg:min-w-[200px] lg:px-2 lg:py-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.2em] text-whatsapp-muted">Signed in</p>
              <p className="mt-1 truncate text-sm font-semibold text-ink">{userEmail}</p>
            </div>
            <div className="flex items-center gap-1">
              <button
                aria-label={showPasswordForm ? "Hide change password form" : "Show change password form"}
                className="icon-hover-trigger flex h-8 w-8 appearance-none items-center justify-center border-0 bg-transparent p-0 text-whatsapp-muted shadow-none outline-none ring-0 transition hover:bg-transparent hover:text-whatsapp-deep focus:bg-transparent"
                onClick={() => {
                  setShowPasswordForm((current) => !current);
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
                <span className="icon-hover-label">Change password</span>
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
                <span className="icon-hover-label">Logout</span>
              </button>
            </div>
          </div>

          {showPasswordForm ? (
            <div className="mt-3 space-y-2 border-t border-whatsapp-line pt-3">
              <input
                className="input-glass"
                onChange={(event) => setNextPassword(event.target.value)}
                placeholder="New password"
                type="password"
                value={nextPassword}
              />
              <input
                className="input-glass"
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Confirm new password"
                type="password"
                value={confirmPassword}
              />
              {passwordError ? <p className="text-xs text-rose-500">{passwordError}</p> : null}
              {passwordSuccess ? <p className="text-xs text-whatsapp-dark">{passwordSuccess}</p> : null}
              <div className="flex gap-2">
                <button className="primary-button px-3 py-2 text-xs" disabled={passwordSaving} onClick={handleChangePassword} type="button">
                  {passwordSaving ? "Saving..." : "Update"}
                </button>
                <button
                  className="secondary-button px-3 py-2 text-xs"
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
          ) : passwordSuccess ? (
            <p className="mt-3 border-t border-whatsapp-line pt-3 text-xs text-whatsapp-dark">{passwordSuccess}</p>
          ) : null}
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
