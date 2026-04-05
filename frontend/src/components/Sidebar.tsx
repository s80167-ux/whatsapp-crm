import { useState } from "react";
import logoGlass from "../../asset/rezeki_dashboard_logo_glass.png";
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
    <aside className="glass-panel flex flex-col justify-between self-start border border-white/70 bg-white/58 p-3 xl:sticky xl:top-6 max-h-[calc(100vh-3rem)] overflow-y-auto custom-scrollbar">
      <div>
        <div className="flex items-center gap-3">
          <img
            alt="Rezeki Dashboard logo"
            className="h-16 w-auto object-contain"
            src={logoGlass}
          />
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-emerald-800/65">Workspace</p>
          </div>
        </div>

        <div className="mt-5 rounded-[26px] border border-white/60 bg-white/52 p-3 shadow-soft">
          <button
            className="flex w-full items-center justify-between gap-3 text-left xl:hidden"
            onClick={() => setIsWorkspaceCollapsed((current) => !current)}
            type="button"
          >
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.25em] text-emerald-800/65">Workspace</p>
              <p className="mt-1 truncate text-sm font-medium text-ink">
                {activeStatusFilter ? CUSTOMER_STATUS_LABELS[activeStatusFilter] : menu.find((item) => item.key === activeView)?.label || "Inbox"}
              </p>
            </div>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/70 text-emerald-900/65 shadow-soft">
              <svg className={`h-4 w-4 transition ${isWorkspaceCollapsed ? "" : "rotate-180"}`} fill="none" viewBox="0 0 24 24">
                <path d="m6 9 6 6 6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
              </svg>
            </span>
          </button>

          <div className={`${isWorkspaceCollapsed ? "hidden" : "mt-3 block"} xl:mt-0 xl:block`}>
            <div className="grid grid-cols-2 gap-1.5">
              {menu.map((item) => (
                <button
                  key={item.key}
                  className={`relative col-span-2 min-w-0 rounded-[20px] border px-3 py-2.5 pr-10 text-left text-xs font-semibold transition-all duration-300 ${
                    activeView === item.key && !activeStatusFilter
                      ? "border-emerald-200 bg-emerald-100/90 text-emerald-950 shadow-glass translate-y-[-1px]"
                      : "border-white/45 bg-white/35 text-emerald-950/70 hover:bg-white/60"
                  }`}
                  onClick={() => {
                    onChangeView(item.key as "inbox" | "pipeline" | "broadcast");
                    onStatusFilterChange(null);
                  }}
                  type="button"
                >
                  <div className="flex items-center gap-2.5">
                    <div className={`flex h-7 w-7 items-center justify-center rounded-xl ${activeView === item.key && !activeStatusFilter ? "bg-white text-emerald-600" : "bg-emerald-950/10 text-emerald-900/40"}`}>
                      <svg fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="15">
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                        <polyline points="22,6 12,13 2,6" />
                      </svg>
                    </div>
                    <span className="block truncate leading-4 font-bold tracking-tight">{item.label}</span>
                  </div>
                  <span className={`absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full px-2 py-0.5 text-[10px] font-bold shadow-soft transition-all duration-300 ${activeView === item.key && !activeStatusFilter ? "bg-emerald-600 text-white" : "bg-emerald-950/10 text-emerald-900/60"}`}>
                    {counts.inbox}
                  </span>
                </button>
              ))}

              {CUSTOMER_STATUSES.map((status) => (
                <button
                  key={status}
                  className={`group relative flex flex-col items-start rounded-[20px] border p-2.5 transition-all duration-300 ${
                    activeStatusFilter === status
                      ? "border-emerald-200 bg-emerald-100/90 text-emerald-950 shadow-glass translate-y-[-1px]"
                      : "border-white/55 bg-white/72 hover:bg-white/95 shadow-sm hover:shadow-soft"
                  }`}
                  onClick={() => onStatusFilterChange(activeStatusFilter === status ? null : status)}
                  type="button"
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-colors ${activeStatusFilter === status ? "bg-white text-emerald-600" : "bg-emerald-50 text-emerald-900/40 group-hover:bg-white group-hover:text-emerald-600"}`}>
                      {getStatusIcon(status)}
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold shadow-sm transition-all duration-300 ${activeStatusFilter === status ? "bg-emerald-600 text-white" : "bg-emerald-50 text-emerald-900/60 group-hover:bg-emerald-100"}`}>
                      {stats.statusCounts[status]}
                    </span>
                  </div>
                  <p className="mt-2 text-[9px] font-bold uppercase tracking-[0.14em] text-emerald-900/40 group-hover:text-emerald-900/60">{CUSTOMER_STATUS_LABELS[status]}</p>
                </button>
              ))}

              <div className="rounded-[20px] border border-white/55 bg-white/72 p-2.5 shadow-sm">
                <div className="flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-50 text-emerald-900/40">
                    <svg fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="14">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  </div>
                  <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-emerald-900/40">Thread</p>
                </div>
                <p className="mt-1.5 text-lg font-bold text-ink leading-none">{stats.currentThreadMessages}</p>
              </div>

              <div className="rounded-[20px] border border-white/55 bg-white/72 p-2.5 shadow-sm">
                <div className="flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-50 text-emerald-900/40">
                    <svg fill="none" height="14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="14">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </div>
                  <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-emerald-900/40">Active</p>
                </div>
                <p className="mt-1.5 truncate text-xs font-bold text-ink leading-none">{stats.activeContact}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 pt-3 md:grid-cols-2 xl:grid-cols-1">
        <WhatsAppConnectCard
          compact
          disconnecting={disconnectingWhatsApp}
          loading={loadingWhatsApp}
          onDisconnect={onDisconnectWhatsApp}
          qr={whatsAppQr}
          status={whatsAppStatus}
          token={token}
        />

        <div className="flex flex-col rounded-[28px] border border-white/60 bg-white/62 p-4 shadow-soft">
          <p className="text-xs uppercase tracking-[0.25em] text-emerald-800/65">Signed in</p>
          <p className="mt-2 break-all text-sm font-medium text-ink">{userEmail}</p>
          <div className="mt-3 flex items-center gap-3">
            <button
              aria-label={showPasswordForm ? "Hide change password form" : "Show change password form"}
              className="icon-hover-trigger flex w-fit appearance-none items-center justify-center gap-0 overflow-visible border-0 bg-transparent px-0 py-0 shadow-none outline-none ring-0 text-emerald-900/72 transition hover:bg-transparent hover:text-emerald-950 focus:bg-transparent"
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
              className="icon-hover-trigger flex w-fit appearance-none items-center justify-center gap-0 overflow-visible border-0 bg-transparent px-0 py-0 shadow-none outline-none ring-0 text-emerald-900/72 transition hover:bg-transparent hover:text-emerald-950 focus:bg-transparent"
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
            <div className="mt-4 space-y-3 border-t border-emerald-900/10 pt-4">
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
              {passwordSuccess ? <p className="text-xs text-emerald-700">{passwordSuccess}</p> : null}
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
            <p className="mt-3 text-xs text-emerald-700">{passwordSuccess}</p>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
