import { useState } from "react";
import logo from "../../asset/rezeki_dashboard_logo_glass.png";
import { CUSTOMER_STATUSES, CUSTOMER_STATUS_LABELS, type CustomerStatus, type WhatsAppQr, type WhatsAppStatus } from "../lib/api";
import { supabase } from "../lib/supabase";
import { WhatsAppConnectCard } from "./WhatsAppConnectCard";

type SidebarProps = {
  activeView: "inbox" | "pipeline" | "broadcast";
  activeStatusFilter: CustomerStatus | null;
  token: string;
  counts: {
    inbox: number;
  };
  stats: {
    statusCounts: Record<CustomerStatus, number>;
    currentThreadMessages: number;
    activeContact: string;
  };
  onChangeView: (view: "inbox" | "pipeline" | "broadcast") => void;
  onStatusFilterChange: (status: CustomerStatus | null) => void;
  userEmail: string;
  onLogout: () => void;
  onDisconnectWhatsApp: () => void;
  whatsAppStatus: WhatsAppStatus | null;
  whatsAppQr: WhatsAppQr | null;
  loadingWhatsApp: boolean;
  disconnectingWhatsApp: boolean;
};

function getStatusIcon(status: CustomerStatus) {
  switch (status) {
    case "new_lead":
      return (
        <svg fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" viewBox="0 0 24 24" width="14">
          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <line x1="19" x2="19" y1="8" y2="14" />
          <line x1="22" x2="16" y1="11" y2="11" />
        </svg>
      );
    case "interested":
      return (
        <svg fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" viewBox="0 0 24 24" width="14">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      );
    case "processing":
      return (
        <svg fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" viewBox="0 0 24 24" width="14">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      );
    case "closed_won":
      return (
        <svg fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" viewBox="0 0 24 24" width="14">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case "closed_lost":
      return (
        <svg fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" viewBox="0 0 24 24" width="14">
          <circle cx="12" cy="12" r="10" />
          <line x1="15" x2="9" y1="9" y2="15" />
          <line x1="9" x2="15" y1="9" y2="15" />
        </svg>
      );
    default:
      return null;
  }
}

const menu = [{ key: "inbox", label: "Inbox" }];

export function Sidebar({
  activeView,
  activeStatusFilter,
  token,
  counts,
  stats,
  onChangeView,
  onStatusFilterChange,
  userEmail,
  onLogout,
  onDisconnectWhatsApp,
  whatsAppStatus,
  whatsAppQr,
  loadingWhatsApp,
  disconnectingWhatsApp
}: SidebarProps) {
  const [isWorkspaceCollapsed, setIsWorkspaceCollapsed] = useState(true);
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
    <aside className="glass-panel flex min-w-0 flex-col gap-4 self-start p-3 xl:sticky xl:top-6">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <img
            alt="Rezeki Dashboard logo"
            className="h-24 w-auto object-contain"
            src={logo}
          />
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-whatsapp-muted">Workspace</p>
          </div>
        </div>

        <div className="rounded-xl border border-whatsapp-line bg-[#f8f5f2] p-2.5">
          <button
            className="flex w-full items-center justify-between gap-3 text-left"
            onClick={() => setIsWorkspaceCollapsed((current) => !current)}
            type="button"
          >
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.22em] text-whatsapp-muted">Workspace</p>
              <p className="mt-1 truncate text-xs font-medium text-ink sm:text-sm">
                {activeStatusFilter ? CUSTOMER_STATUS_LABELS[activeStatusFilter] : menu.find((item) => item.key === activeView)?.label || "Inbox"}
              </p>
            </div>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-whatsapp-muted shadow-soft">
              <svg className={`h-4 w-4 transition ${isWorkspaceCollapsed ? "" : "rotate-180"}`} fill="none" viewBox="0 0 24 24">
                <path d="m6 9 6 6 6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
              </svg>
            </span>
          </button>

          <div className={isWorkspaceCollapsed ? "hidden" : "mt-2 block"}>
            <div className="grid grid-cols-2 gap-1">
              {menu.map((item) => (
                <button
                  key={item.key}
                  className={`relative col-span-2 min-w-0 rounded-lg border px-2.5 py-2 pr-9 text-left text-[11px] font-semibold transition-all duration-300 ${
                    activeView === item.key && !activeStatusFilter
                      ? "border-transparent bg-[#e9edef] text-whatsapp-deep"
                      : "border-transparent bg-white text-whatsapp-muted hover:bg-[#f5f6f6]"
                  }`}
                  onClick={() => {
                    onChangeView(item.key as "inbox" | "pipeline" | "broadcast");
                    onStatusFilterChange(null);
                  }}
                  type="button"
                >
                  <div className="flex items-center gap-2">
                    <div className={`flex h-6 w-6 items-center justify-center rounded-lg ${activeView === item.key && !activeStatusFilter ? "bg-white text-whatsapp-dark" : "bg-whatsapp-soft text-whatsapp-muted"}`}>
                      <svg fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="15">
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                        <polyline points="22,6 12,13 2,6" />
                      </svg>
                    </div>
                    <span className="block truncate leading-4 font-bold tracking-tight">{item.label}</span>
                  </div>
                  <span className={`absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-1.5 py-0.5 text-[9px] font-bold shadow-soft transition-all duration-300 ${activeView === item.key && !activeStatusFilter ? "bg-whatsapp-dark text-white" : "bg-whatsapp-soft text-whatsapp-muted"}`}>
                    {counts.inbox}
                  </span>
                </button>
              ))}

              {CUSTOMER_STATUSES.map((status) => (
                <button
                  key={status}
                  className={`group relative flex flex-col items-start rounded-lg border p-2 transition-all duration-300 ${
                    activeStatusFilter === status
                      ? "border-transparent bg-[#e9edef] text-whatsapp-deep"
                      : "border-transparent bg-white hover:bg-[#f5f6f6] shadow-sm"
                  }`}
                  onClick={() => onStatusFilterChange(activeStatusFilter === status ? null : status)}
                  type="button"
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-colors ${activeStatusFilter === status ? "bg-white text-whatsapp-dark" : "bg-whatsapp-soft text-whatsapp-muted group-hover:bg-white group-hover:text-whatsapp-dark"}`}>
                      {getStatusIcon(status)}
                    </div>
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold shadow-sm transition-all duration-300 ${activeStatusFilter === status ? "bg-whatsapp-dark text-white" : "bg-whatsapp-soft text-whatsapp-muted group-hover:bg-white"}`}>
                      {stats.statusCounts[status]}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[8px] font-bold uppercase tracking-[0.12em] text-whatsapp-muted group-hover:text-whatsapp-deep">{CUSTOMER_STATUS_LABELS[status]}</p>
                </button>
              ))}

              <div className="rounded-lg border border-whatsapp-line bg-white p-2 shadow-sm">
                <div className="flex items-center gap-2">
                  <div className="flex h-5 w-5 items-center justify-center rounded-md bg-whatsapp-soft text-whatsapp-muted">
                    <svg fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="14">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  </div>
                  <p className="text-[8px] font-bold uppercase tracking-[0.12em] text-whatsapp-muted">Thread</p>
                </div>
                <p className="mt-1 text-base font-bold text-ink leading-none">{stats.currentThreadMessages}</p>
              </div>

              <div className="rounded-lg border border-whatsapp-line bg-white p-2 shadow-sm">
                <div className="flex items-center gap-2">
                  <div className="flex h-5 w-5 items-center justify-center rounded-md bg-whatsapp-soft text-whatsapp-muted">
                    <svg fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="14">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </div>
                  <p className="text-[8px] font-bold uppercase tracking-[0.12em] text-whatsapp-muted">Active</p>
                </div>
                <p className="mt-1 truncate text-[11px] font-bold text-ink leading-none">{stats.activeContact}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4 xl:mt-auto xl:border-t xl:border-whatsapp-line/80 xl:pt-4">
        <WhatsAppConnectCard
          compact
          disconnecting={disconnectingWhatsApp}
          loading={loadingWhatsApp}
          onDisconnect={onDisconnectWhatsApp}
          qr={whatsAppQr}
          status={whatsAppStatus}
          token={token}
        />

        <div className="flex flex-col rounded-xl border border-whatsapp-line bg-white p-4 shadow-soft">
          <p className="text-xs uppercase tracking-[0.25em] text-whatsapp-muted">Signed in</p>
          <p className="mt-2 break-all text-sm font-medium text-ink">{userEmail}</p>
          <div className="mt-3 flex items-center gap-3">
            <button
              aria-label={showPasswordForm ? "Hide change password form" : "Show change password form"}
              className="icon-hover-trigger flex w-fit appearance-none items-center justify-center gap-0 overflow-visible border-0 bg-transparent px-0 py-0 shadow-none outline-none ring-0 text-whatsapp-muted transition hover:bg-transparent hover:text-whatsapp-deep focus:bg-transparent"
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
              <span className="icon-hover-label">
                Change password
              </span>
            </button>

            <button
              aria-label="Logout"
              className="icon-hover-trigger flex w-fit appearance-none items-center justify-center gap-0 overflow-visible border-0 bg-transparent px-0 py-0 shadow-none outline-none ring-0 text-whatsapp-muted transition hover:bg-transparent hover:text-whatsapp-deep focus:bg-transparent"
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
              <span className="icon-hover-label">
                Logout
              </span>
            </button>
          </div>

          {showPasswordForm ? (
            <div className="mt-4 space-y-3 border-t border-whatsapp-line pt-4">
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
                <button className="primary-button px-4 py-2" disabled={passwordSaving} onClick={handleChangePassword} type="button">
                  {passwordSaving ? "Saving..." : "Update password"}
                </button>
                <button
                  className="secondary-button px-4 py-2"
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
            <p className="mt-3 text-xs text-whatsapp-dark">{passwordSuccess}</p>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
