import { useState } from "react";
import logo from "../../asset/rezeki_dashboard_logo_glass.png";
import { CUSTOMER_STATUSES, CUSTOMER_STATUS_LABELS, type CustomerStatus } from "../lib/api";

type SidebarProps = {
  activeView: "inbox" | "pipeline" | "broadcast";
  activeStatusFilter: CustomerStatus | null;
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

function getStatusCardClasses(status: CustomerStatus, active: boolean) {
  switch (status) {
    case "new_lead":
      return active
        ? "border-yellow-200 bg-yellow-50 text-yellow-800"
        : "border-yellow-100 bg-white text-yellow-700 hover:bg-yellow-50";
    case "interested":
      return active
        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
        : "border-emerald-100 bg-white text-emerald-700 hover:bg-emerald-50";
    case "processing":
      return active
        ? "border-blue-200 bg-blue-50 text-blue-800"
        : "border-blue-100 bg-white text-blue-700 hover:bg-blue-50";
    case "closed_won":
      return active
        ? "border-slate-300 bg-slate-100 text-slate-900"
        : "border-slate-200 bg-white text-slate-800 hover:bg-slate-50";
    case "closed_lost":
      return active
        ? "border-rose-200 bg-rose-50 text-rose-800"
        : "border-rose-100 bg-white text-rose-700 hover:bg-rose-50";
    default:
      return active
        ? "border-transparent bg-[#e9edef] text-whatsapp-deep"
        : "border-transparent bg-white text-whatsapp-muted hover:bg-[#f5f6f6] shadow-sm";
  }
}

function getStatusIconClasses(status: CustomerStatus, active: boolean) {
  switch (status) {
    case "new_lead":
      return active ? "bg-yellow-100 text-yellow-700" : "bg-yellow-50 text-yellow-700";
    case "interested":
      return active ? "bg-emerald-100 text-emerald-700" : "bg-emerald-50 text-emerald-700";
    case "processing":
      return active ? "bg-blue-100 text-blue-700" : "bg-blue-50 text-blue-700";
    case "closed_won":
      return active ? "bg-slate-200 text-slate-800" : "bg-slate-100 text-slate-800";
    case "closed_lost":
      return active ? "bg-rose-100 text-rose-700" : "bg-rose-50 text-rose-700";
    default:
      return active ? "bg-white text-whatsapp-dark" : "bg-whatsapp-soft text-whatsapp-muted group-hover:bg-white group-hover:text-whatsapp-dark";
  }
}

function getStatusCountClasses(status: CustomerStatus, active: boolean) {
  switch (status) {
    case "new_lead":
      return active ? "bg-yellow-600 text-white" : "bg-yellow-100 text-yellow-800";
    case "interested":
      return active ? "bg-emerald-600 text-white" : "bg-emerald-100 text-emerald-800";
    case "processing":
      return active ? "bg-blue-600 text-white" : "bg-blue-100 text-blue-800";
    case "closed_won":
      return active ? "bg-slate-800 text-white" : "bg-slate-200 text-slate-800";
    case "closed_lost":
      return active ? "bg-rose-600 text-white" : "bg-rose-100 text-rose-800";
    default:
      return active ? "bg-whatsapp-dark text-white" : "bg-whatsapp-soft text-whatsapp-muted group-hover:bg-white";
  }
}

export function Sidebar({
  activeView,
  activeStatusFilter,
  counts,
  stats,
  onChangeView,
  onStatusFilterChange
}: SidebarProps) {
  return (
    <aside className="glass-panel flex min-w-0 flex-col gap-4 self-start p-3 xl:sticky xl:top-6">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 xl:flex-col xl:items-start">
          <img
            alt="Rezeki Dashboard logo"
            className="h-20 w-auto object-contain sm:h-24"
            src={logo}
          />
          <div className="min-w-0 xl:w-full">
            <p className="text-[11px] uppercase tracking-[0.2em] text-whatsapp-muted sm:text-xs sm:tracking-[0.26em]">
              Workspace
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-whatsapp-line bg-[#f8f5f2] p-2.5">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.22em] text-whatsapp-muted">Workspace</p>
            <p className="mt-1 truncate text-xs font-medium text-ink sm:text-sm">
              {activeStatusFilter ? CUSTOMER_STATUS_LABELS[activeStatusFilter] : menu.find((item) => item.key === activeView)?.label || "Inbox"}
            </p>
          </div>

          <div className="mt-2 block">
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
                  className={`group relative flex flex-col items-start rounded-lg border p-2 transition-all duration-300 ${getStatusCardClasses(status, activeStatusFilter === status)}`}
                  onClick={() => onStatusFilterChange(activeStatusFilter === status ? null : status)}
                  type="button"
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-colors ${getStatusIconClasses(status, activeStatusFilter === status)}`}>
                      {getStatusIcon(status)}
                    </div>
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold shadow-sm transition-all duration-300 ${getStatusCountClasses(status, activeStatusFilter === status)}`}>
                      {stats.statusCounts[status]}
                    </span>
                  </div>
                  <p className={`mt-1.5 text-[8px] font-bold uppercase tracking-[0.12em] ${activeStatusFilter === status ? "text-current" : "text-whatsapp-muted group-hover:text-current"}`}>{CUSTOMER_STATUS_LABELS[status]}</p>
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

    </aside>
  );
}
